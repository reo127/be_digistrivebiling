import express from 'express';
import Invoice from '../models/Invoice.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import ShopSettings from '../models/ShopSettings.js';
import Batch from '../models/Batch.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation, addOrgFilter } from '../middleware/tenantIsolation.js';
import { calculateItemGST, calculateTotals, determineTaxType } from '../utils/gstCalculations.js';
import { getBatchesForSale, deductBatchStock, calculateCOGS } from '../utils/inventoryManager.js';
import { postSalesToLedger } from '../utils/ledgerHelper.js';

const router = express.Router();

// Apply authentication and tenant isolation to all routes
router.use(protect);
router.use(tenantIsolation);

// @route   GET /api/invoices
// @desc    Get all invoices
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, paymentStatus, customer } = req.query;
    let query = addOrgFilter(req); // Use organizationId filter

    if (startDate && endDate) {
      query.invoiceDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    if (customer) {
      query.customer = customer;
    }

    const invoices = await Invoice.find(query)
      .populate('customer', 'name phone')
      .sort({ createdAt: -1 });

    res.json(invoices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/invoices/stats
// @desc    Get invoice statistics
// @access  Private
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const orgFilter = addOrgFilter(req); // Use organizationId filter

    const [todaySales, totalOutstanding, invoiceCount] = await Promise.all([
      Invoice.aggregate([
        {
          $match: {
            ...orgFilter,
            invoiceDate: { $gte: today }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$grandTotal' }
          }
        }
      ]),
      Invoice.aggregate([
        {
          $match: {
            ...orgFilter,
            paymentStatus: { $in: ['UNPAID', 'PARTIAL'] }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$balanceAmount' }
          }
        }
      ]),
      Invoice.countDocuments(orgFilter)
    ]);

    res.json({
      todaySales: todaySales[0]?.total || 0,
      totalOutstanding: totalOutstanding[0]?.total || 0,
      totalInvoices: invoiceCount
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/invoices/:id
// @desc    Get single invoice
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const query = addOrgFilter(req, { _id: req.params.id });
    const invoice = await Invoice.findOne(query)
      .populate('customer')
      .populate('items.product')
      .populate('items.batch');

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    res.json(invoice);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/invoices
// @desc    Create invoice with FIFO batch selection
// @access  Private
router.post('/', async (req, res) => {
  try {
    const { items, customer: customerId, ...invoiceData } = req.body;

    // Get shop settings for tax type determination
    const shopSettings = await ShopSettings.findOne(addOrgFilter(req));

    // Determine tax type based on customer state
    let taxType = invoiceData.taxType || 'CGST_SGST';
    let customerData = {
      customerName: invoiceData.customerName,
      customerPhone: invoiceData.customerPhone,
      customerAddress: invoiceData.customerAddress,
      customerCity: invoiceData.customerCity,
      customerState: invoiceData.customerState,
      customerGstin: invoiceData.customerGstin
    };

    // Get customer details if provided
    let customer = null;
    if (customerId) {
      customer = await Customer.findOne(addOrgFilter(req, { _id: customerId }));

      if (customer) {
        customerData = {
          customer: customer._id,
          customerName: customer.name,
          customerPhone: customer.phone,
          customerAddress: customer.address,
          customerCity: customer.city,
          customerState: customer.state,
          customerGstin: customer.gstin
        };

        // Determine tax type based on customer state
        if (shopSettings && customer.state) {
          taxType = determineTaxType(shopSettings.state, customer.state);
        }
      }
    }

    // Validate items array
    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Please add at least one item to the invoice' });
    }

    // Process items with FIFO batch selection
    const processedItems = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Validate product is selected
      if (!item.product || item.product === '') {
        return res.status(400).json({ message: `Please select a product for item #${i + 1}` });
      }

      // Validate quantity
      if (!item.quantity || item.quantity <= 0) {
        return res.status(400).json({ message: `Please enter a valid quantity for item #${i + 1}` });
      }

      // Validate product exists
      const product = await Product.findOne(addOrgFilter(req, { _id: item.product }));

      if (!product) {
        return res.status(400).json({ message: `Product not found for item #${i + 1}. Please select a valid product.` });
      }

      // Check total available stock
      if (product.stockQuantity < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stockQuantity}, Requested: ${item.quantity}`);
      }

      // FIFO batch selection - two modes:
      // Mode 1: User selects specific batch (item.batch provided)
      // Mode 2: Automatic FIFO selection (item.batch not provided)

      if (item.batch) {
        // Manual batch selection
        const batch = await Batch.findOne(addOrgFilter(req, {
          _id: item.batch,
          product: product._id,
          isActive: true
        }));

        if (!batch) {
          throw new Error(`Batch not found or inactive for ${product.name}`);
        }

        if (batch.quantity < item.quantity) {
          throw new Error(`Insufficient stock in selected batch for ${product.name}`);
        }

        // Calculate GST for this item
        const itemWithGST = calculateItemGST({
          quantity: item.quantity,
          sellingPrice: item.sellingPrice || batch.sellingPrice,
          discount: item.discount || 0,
          gstRate: batch.gstRate
        }, taxType, 'invoice');

        // Deduct from batch
        await deductBatchStock(batch._id, item.quantity);

        processedItems.push({
          product: product._id,
          productName: product.name,
          batch: batch._id,
          batchNo: batch.batchNo,
          expiryDate: batch.expiryDate,
          hsnCode: product.hsnCode,
          quantity: item.quantity,
          unit: product.unit,
          mrp: batch.mrp,
          purchasePrice: batch.purchasePrice, // For COGS
          sellingPrice: item.sellingPrice || batch.sellingPrice,
          ...itemWithGST
        });

      } else {
        // Automatic FIFO selection
        const batchesForSale = await getBatchesForSale(product._id, req.user._id, req.user.organizationId, item.quantity);

        for (const batchSale of batchesForSale) {
          // Calculate GST for this portion
          const itemWithGST = calculateItemGST({
            quantity: batchSale.quantity,
            sellingPrice: item.sellingPrice || batchSale.sellingPrice,
            discount: item.discount || 0,
            gstRate: batchSale.gstRate
          }, taxType, 'invoice');

          // Deduct from batch
          await deductBatchStock(batchSale.batch, batchSale.quantity);

          processedItems.push({
            product: product._id,
            productName: product.name,
            batch: batchSale.batch,
            batchNo: batchSale.batchNo,
            expiryDate: batchSale.expiryDate,
            hsnCode: product.hsnCode,
            quantity: batchSale.quantity,
            unit: product.unit,
            mrp: batchSale.mrp,
            purchasePrice: batchSale.purchasePrice, // For COGS
            sellingPrice: item.sellingPrice || batchSale.sellingPrice,
            ...itemWithGST
          });
        }
      }
    }

    // Calculate invoice totals
    const totals = calculateTotals(processedItems, {}, invoiceData.discount || 0);

    // Calculate COGS (Cost of Goods Sold)
    const cogs = await calculateCOGS(processedItems);

    // Calculate payment details
    const paidAmount = invoiceData.paidAmount || 0;
    const balanceAmount = totals.grandTotal - paidAmount;
    const paymentStatus = balanceAmount <= 0 ? 'PAID' : (paidAmount > 0 ? 'PARTIAL' : 'UNPAID');

    // Check if E-way bill is required (inter-state sales > 50000)
    const eWayBillRequired = taxType === 'IGST' && totals.grandTotal > 50000;

    // Create invoice
    const invoice = await Invoice.create({
      userId: req.user._id,
      organizationId: req.organizationId || req.user.organizationId,
      ...customerData,
      items: processedItems,
      ...totals,
      taxType,
      paymentStatus,
      paymentMethod: invoiceData.paymentMethod || 'CASH',
      paidAmount,
      balanceAmount,
      paymentDetails: invoiceData.paymentDetails,
      notes: invoiceData.notes,
      invoiceDate: invoiceData.invoiceDate || new Date(),
      cogs,
      // Prescription tracking
      prescriptionRequired: invoiceData.prescriptionRequired || false,
      prescriptionNumber: invoiceData.prescriptionNumber,
      doctorName: invoiceData.doctorName,
      prescriptionDate: invoiceData.prescriptionDate,
      // E-way bill
      eWayBillRequired,
      eWayBillNumber: invoiceData.eWayBillNumber,
      eWayBillDate: invoiceData.eWayBillDate,
      transporterName: invoiceData.transporterName,
      vehicleNumber: invoiceData.vehicleNumber,
      distance: invoiceData.distance
    });

    // Update customer outstanding
    if (customer && paymentStatus !== 'PAID') {
      customer.outstandingBalance += balanceAmount;
      await customer.save();
    }

    // Post to ledger (double-entry accounting)
    const ledgerEntries = await postSalesToLedger(invoice, req.user._id, req.organizationId || req.user.organizationId);
    invoice.ledgerEntries = ledgerEntries.map(entry => entry._id);
    await invoice.save();

    res.status(201).json(invoice);
  } catch (error) {
    console.error('Invoice creation error:', error);
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/invoices/:id/payment
// @desc    Update payment status
// @access  Private
router.put('/:id/payment', async (req, res) => {
  try {
    const { paymentStatus, paymentMethod, paidAmount, paymentDetails } = req.body;

    const invoice = await Invoice.findOne(addOrgFilter(req, { _id: req.params.id }));

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const oldBalance = invoice.balanceAmount;
    const newPaidAmount = invoice.paidAmount + (paidAmount || 0);
    const newBalance = invoice.grandTotal - newPaidAmount;

    invoice.paidAmount = newPaidAmount;
    invoice.balanceAmount = newBalance;
    invoice.paymentStatus = newBalance <= 0 ? 'PAID' : (newPaidAmount > 0 ? 'PARTIAL' : 'UNPAID');

    if (paymentMethod) invoice.paymentMethod = paymentMethod;
    if (paymentDetails) invoice.paymentDetails = paymentDetails;

    await invoice.save();

    // Update customer outstanding if customer exists
    if (invoice.customer) {
      const customer = await Customer.findById(invoice.customer);
      if (customer) {
        customer.outstandingBalance = customer.outstandingBalance - oldBalance + newBalance;
        await customer.save();
      }
    }

    res.json(invoice);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
