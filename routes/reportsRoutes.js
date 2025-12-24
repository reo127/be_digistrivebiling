import express from 'express';
import Invoice from '../models/Invoice.js';
import Purchase from '../models/Purchase.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation, addOrgFilter } from '../middleware/tenantIsolation.js';
import mongoose from 'mongoose';

const router = express.Router();

router.use(protect);
router.use(tenantIsolation);

// Helper function to ensure item has all calculated fields
const ensureItemCalculations = (item, invoice) => {
  // Convert to plain object if it's a Mongoose document
  const calculatedItem = item.toObject ? { ...item.toObject() } : { ...item };

  // If taxableAmount is missing or 0, calculate it
  if (!calculatedItem.taxableAmount || calculatedItem.taxableAmount === 0) {
    const baseAmount = calculatedItem.quantity * calculatedItem.sellingPrice;
    calculatedItem.taxableAmount = baseAmount - (calculatedItem.discountAmount || 0);
  }

  // If tax amounts are missing, calculate them
  if ((!calculatedItem.cgst && !calculatedItem.sgst && !calculatedItem.igst) ||
      (calculatedItem.cgst === 0 && calculatedItem.sgst === 0 && calculatedItem.igst === 0)) {
    const taxRate = calculatedItem.gstRate || 0;
    const taxableAmt = calculatedItem.taxableAmount;
    const totalTaxAmount = (taxableAmt * taxRate) / 100;

    // Determine if it's CGST+SGST or IGST based on invoice taxType
    if (invoice.taxType === 'IGST') {
      calculatedItem.igst = totalTaxAmount;
      calculatedItem.cgst = 0;
      calculatedItem.sgst = 0;
    } else {
      // CGST_SGST - split equally
      calculatedItem.cgst = totalTaxAmount / 2;
      calculatedItem.sgst = totalTaxAmount / 2;
      calculatedItem.igst = 0;
    }
    calculatedItem.taxAmount = totalTaxAmount;
  }

  // Ensure taxAmount is calculated
  if (!calculatedItem.taxAmount || calculatedItem.taxAmount === 0) {
    calculatedItem.taxAmount = (calculatedItem.cgst || 0) + (calculatedItem.sgst || 0) + (calculatedItem.igst || 0);
  }

  // Ensure totalAmount is calculated
  if (!calculatedItem.totalAmount || calculatedItem.totalAmount === 0) {
    calculatedItem.totalAmount = calculatedItem.taxableAmount + calculatedItem.taxAmount;
  }

  return calculatedItem;
};

// @route   GET /api/reports/gstr1
// @desc    Get GSTR-1 report data (Outward Supplies)
// @access  Private
router.get('/gstr1', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    const query = {
      organizationId: req.organizationId,
      invoiceDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    };

    const invoices = await Invoice.find(query)
      .populate('customer', 'name gstin state')
      .populate('items.product', 'name hsnCode')
      .sort({ invoiceDate: 1 });

    console.log('📊 Total invoices found:', invoices.length);
    if (invoices.length > 0) {
      console.log('📋 Sample invoice structure:');
      console.log('  - Invoice Number:', invoices[0].invoiceNumber);
      console.log('  - Items count:', invoices[0].items?.length || 0);
      console.log('  - Subtotal:', invoices[0].subtotal);
      console.log('  - Total Tax:', invoices[0].totalTax);
      console.log('  - Grand Total:', invoices[0].grandTotal);
      if (invoices[0].items?.[0]) {
        console.log('  - Sample item fields:', {
          productName: invoices[0].items[0].productName,
          quantity: invoices[0].items[0].quantity,
          sellingPrice: invoices[0].items[0].sellingPrice,
          gstRate: invoices[0].items[0].gstRate,
          taxableAmount: invoices[0].items[0].taxableAmount,
          cgst: invoices[0].items[0].cgst,
          sgst: invoices[0].items[0].sgst,
          igst: invoices[0].items[0].igst,
          taxAmount: invoices[0].items[0].taxAmount,
          totalAmount: invoices[0].items[0].totalAmount
        });
      }
    }

    // Group by tax type and rate
    const b2bInvoices = invoices.filter(inv => inv.customer && inv.customer.gstin);
    const b2cLargeInvoices = invoices.filter(inv => (!inv.customer?.gstin || !inv.customer) && inv.grandTotal > 250000);
    const b2cSmallInvoices = invoices.filter(inv => (!inv.customer?.gstin || !inv.customer) && inv.grandTotal <= 250000);

    console.log('📊 B2B:', b2bInvoices.length, 'B2C Large:', b2cLargeInvoices.length, 'B2C Small:', b2cSmallInvoices.length);

    // Calculate totals by GST rate
    const gstRateTotals = {};
    invoices.forEach(invoice => {
      if (!invoice.items || invoice.items.length === 0) {
        console.log('⚠️ Invoice has no items:', invoice.invoiceNumber);
        return;
      }
      invoice.items.forEach(item => {
        // Ensure item has all calculated fields
        const calculatedItem = ensureItemCalculations(item, invoice);

        const rate = calculatedItem.gstRate;
        if (!gstRateTotals[rate]) {
          gstRateTotals[rate] = {
            taxableValue: 0,
            cgst: 0,
            sgst: 0,
            igst: 0,
            totalTax: 0
          };
        }
        gstRateTotals[rate].taxableValue += calculatedItem.taxableAmount || 0;
        gstRateTotals[rate].cgst += calculatedItem.cgst || 0;
        gstRateTotals[rate].sgst += calculatedItem.sgst || 0;
        gstRateTotals[rate].igst += calculatedItem.igst || 0;
        gstRateTotals[rate].totalTax += calculatedItem.taxAmount || 0;
      });
    });

    console.log('📋 GST Rate Totals:', gstRateTotals);

    // Summary
    const summary = {
      totalInvoices: invoices.length,
      totalTaxableValue: invoices.reduce((sum, inv) => sum + inv.subtotal, 0),
      totalCGST: invoices.reduce((sum, inv) => sum + (inv.totalCGST || 0), 0),
      totalSGST: invoices.reduce((sum, inv) => sum + (inv.totalSGST || 0), 0),
      totalIGST: invoices.reduce((sum, inv) => sum + (inv.totalIGST || 0), 0),
      totalTax: invoices.reduce((sum, inv) => sum + inv.totalTax, 0),
      totalInvoiceValue: invoices.reduce((sum, inv) => sum + inv.grandTotal, 0),
      b2bCount: b2bInvoices.length,
      b2cLargeCount: b2cLargeInvoices.length,
      b2cSmallCount: b2cSmallInvoices.length
    };

    console.log('📈 Summary being sent:', summary);

    res.json({
      summary,
      gstRateTotals,
      b2bInvoices: b2bInvoices.map(inv => ({
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        customerName: inv.customerName,
        gstin: inv.customer?.gstin,
        placeOfSupply: inv.customer?.state,
        invoiceValue: inv.grandTotal,
        taxableValue: inv.subtotal,
        cgst: inv.totalCGST || 0,
        sgst: inv.totalSGST || 0,
        igst: inv.totalIGST || 0,
        gstRate: inv.items[0]?.gstRate || 0,
        cessRate: 0,
        cessAmount: 0,
        items: (inv.items || []).map(item => ensureItemCalculations(item, inv)) // Calculate items
      })),
      b2cLarge: b2cLargeInvoices.map(inv => ({
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        customerName: inv.customerName,
        placeOfSupply: inv.customerState,
        invoiceValue: inv.grandTotal,
        taxableValue: inv.subtotal,
        cgst: inv.totalCGST || 0,
        sgst: inv.totalSGST || 0,
        igst: inv.totalIGST || 0,
        gstRate: inv.items[0]?.gstRate || 0,
        cessRate: 0,
        cessAmount: 0,
        items: (inv.items || []).map(item => ensureItemCalculations(item, inv)) // Calculate items
      })),
      b2cSmall: b2cSmallInvoices.map(inv => ({
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        customerName: inv.customerName,
        placeOfSupply: inv.customerState,
        invoiceValue: inv.grandTotal,
        taxableValue: inv.subtotal,
        cgst: inv.totalCGST || 0,
        sgst: inv.totalSGST || 0,
        igst: inv.totalIGST || 0,
        gstRate: inv.items[0]?.gstRate || 0,
        cessRate: 0,
        cessAmount: 0,
        items: (inv.items || []).map(item => ensureItemCalculations(item, inv)) // Calculate items
      })),
      b2cSmallSummary: {
        count: b2cSmallInvoices.length,
        taxableValue: b2cSmallInvoices.reduce((sum, inv) => sum + inv.subtotal, 0),
        totalTax: b2cSmallInvoices.reduce((sum, inv) => sum + inv.totalTax, 0),
        invoiceValue: b2cSmallInvoices.reduce((sum, inv) => sum + inv.grandTotal, 0)
      }
    });
  } catch (error) {
    console.error('GSTR-1 report error:', error);
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/reports/gstr3b
// @desc    Get GSTR-3B report data (Summary Return)
// @access  Private
router.get('/gstr3b', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    const query = {
      organizationId: req.organizationId,
      invoiceDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    };

    const purchaseQuery = {
      organizationId: req.organizationId,
      purchaseDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    };

    const [invoices, purchases] = await Promise.all([
      Invoice.find(query),
      Purchase.find(purchaseQuery)
    ]);

    // Outward Supplies (Sales)
    const outwardSupplies = {
      taxableValue: invoices.reduce((sum, inv) => sum + inv.subtotal, 0),
      cgst: invoices.reduce((sum, inv) => sum + (inv.totalCGST || 0), 0),
      sgst: invoices.reduce((sum, inv) => sum + (inv.totalSGST || 0), 0),
      igst: invoices.reduce((sum, inv) => sum + (inv.totalIGST || 0), 0),
      cess: 0
    };

    // Inward Supplies (Purchases) - ITC Eligible
    const inwardSupplies = {
      taxableValue: purchases.reduce((sum, pur) => sum + pur.subtotal, 0),
      cgst: purchases.reduce((sum, pur) => sum + (pur.totalCGST || 0), 0),
      sgst: purchases.reduce((sum, pur) => sum + (pur.totalSGST || 0), 0),
      igst: purchases.reduce((sum, pur) => sum + (pur.totalIGST || 0), 0),
      cess: 0
    };

    // Net Tax Liability
    const netTaxLiability = {
      cgst: outwardSupplies.cgst - inwardSupplies.cgst,
      sgst: outwardSupplies.sgst - inwardSupplies.sgst,
      igst: outwardSupplies.igst - inwardSupplies.igst,
      cess: 0,
      total: (outwardSupplies.cgst + outwardSupplies.sgst + outwardSupplies.igst) -
             (inwardSupplies.cgst + inwardSupplies.sgst + inwardSupplies.igst)
    };

    res.json({
      outwardSupplies,
      inwardSupplies,
      itcAvailable: inwardSupplies,
      netTaxLiability,
      summary: {
        totalSales: invoices.reduce((sum, inv) => sum + inv.grandTotal, 0),
        totalPurchases: purchases.reduce((sum, pur) => sum + pur.grandTotal, 0),
        totalOutputTax: outwardSupplies.cgst + outwardSupplies.sgst + outwardSupplies.igst,
        totalInputTax: inwardSupplies.cgst + inwardSupplies.sgst + inwardSupplies.igst,
        netTaxPayable: netTaxLiability.total
      }
    });
  } catch (error) {
    console.error('GSTR-3B report error:', error);
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/reports/tax-summary
// @desc    Get Tax Summary report
// @access  Private
router.get('/tax-summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    const invoiceQuery = {
      organizationId: req.organizationId,
      invoiceDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    };

    const purchaseQuery = {
      organizationId: req.organizationId,
      purchaseDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    };

    const [invoices, purchases] = await Promise.all([
      Invoice.find(invoiceQuery),
      Purchase.find(purchaseQuery)
    ]);

    // Sales Tax by Rate
    const salesTaxByRate = {};
    invoices.forEach(invoice => {
      invoice.items.forEach(item => {
        const rate = item.gstRate;
        if (!salesTaxByRate[rate]) {
          salesTaxByRate[rate] = {
            taxableValue: 0,
            cgst: 0,
            sgst: 0,
            igst: 0,
            totalTax: 0,
            count: 0
          };
        }
        salesTaxByRate[rate].taxableValue += item.taxableAmount || 0;
        salesTaxByRate[rate].cgst += item.cgst || 0;
        salesTaxByRate[rate].sgst += item.sgst || 0;
        salesTaxByRate[rate].igst += item.igst || 0;
        salesTaxByRate[rate].totalTax += item.taxAmount || 0;
        salesTaxByRate[rate].count++;
      });
    });

    // Purchase Tax by Rate
    const purchaseTaxByRate = {};
    purchases.forEach(purchase => {
      purchase.items.forEach(item => {
        const rate = item.gstRate;
        if (!purchaseTaxByRate[rate]) {
          purchaseTaxByRate[rate] = {
            taxableValue: 0,
            cgst: 0,
            sgst: 0,
            igst: 0,
            totalTax: 0,
            count: 0
          };
        }
        purchaseTaxByRate[rate].taxableValue += item.taxableAmount || 0;
        purchaseTaxByRate[rate].cgst += item.cgst || 0;
        purchaseTaxByRate[rate].sgst += item.sgst || 0;
        purchaseTaxByRate[rate].igst += item.igst || 0;
        purchaseTaxByRate[rate].totalTax += item.taxAmount || 0;
        purchaseTaxByRate[rate].count++;
      });
    });

    const totalSalesTax = invoices.reduce((sum, inv) => sum + inv.totalTax, 0);
    const totalPurchaseTax = purchases.reduce((sum, pur) => sum + pur.totalTax, 0);

    res.json({
      salesTaxByRate,
      purchaseTaxByRate,
      summary: {
        totalSales: invoices.reduce((sum, inv) => sum + inv.grandTotal, 0),
        totalSalesTax,
        totalPurchases: purchases.reduce((sum, pur) => sum + pur.grandTotal, 0),
        totalPurchaseTax,
        netTaxLiability: totalSalesTax - totalPurchaseTax
      }
    });
  } catch (error) {
    console.error('Tax summary report error:', error);
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/reports/hsn-summary
// @desc    Get HSN Summary report
// @access  Private
router.get('/hsn-summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    const query = {
      organizationId: req.organizationId,
      invoiceDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    };

    const invoices = await Invoice.find(query);

    // Group by HSN Code
    const hsnSummary = {};
    invoices.forEach(invoice => {
      invoice.items.forEach(item => {
        const hsn = item.hsnCode || 'N/A';
        if (!hsnSummary[hsn]) {
          hsnSummary[hsn] = {
            hsnCode: hsn,
            description: item.productName,
            uqc: item.unit || 'PCS',
            totalQuantity: 0,
            totalValue: 0,
            taxableValue: 0,
            cgst: 0,
            sgst: 0,
            igst: 0,
            totalTax: 0,
            gstRate: item.gstRate
          };
        }
        hsnSummary[hsn].totalQuantity += item.quantity;
        hsnSummary[hsn].totalValue += item.totalAmount || 0;
        hsnSummary[hsn].taxableValue += item.taxableAmount || 0;
        hsnSummary[hsn].cgst += item.cgst || 0;
        hsnSummary[hsn].sgst += item.sgst || 0;
        hsnSummary[hsn].igst += item.igst || 0;
        hsnSummary[hsn].totalTax += item.taxAmount || 0;
      });
    });

    const hsnList = Object.values(hsnSummary).sort((a, b) => a.hsnCode.localeCompare(b.hsnCode));

    const summary = {
      totalHSNCodes: hsnList.length,
      totalQuantity: hsnList.reduce((sum, hsn) => sum + hsn.totalQuantity, 0),
      totalTaxableValue: hsnList.reduce((sum, hsn) => sum + hsn.taxableValue, 0),
      totalTax: hsnList.reduce((sum, hsn) => sum + hsn.totalTax, 0),
      totalValue: hsnList.reduce((sum, hsn) => sum + hsn.totalValue, 0)
    };

    res.json({
      hsnList,
      summary
    });
  } catch (error) {
    console.error('HSN summary report error:', error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
