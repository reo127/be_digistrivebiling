import express from 'express';
import Invoice from '../models/Invoice.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import ShopSettings from '../models/ShopSettings.js';
import Batch from '../models/Batch.js';
import { protect } from '../middleware/auth.js';
import { calculateItemGST, calculateTotals, determineTaxType } from '../utils/gstCalculations.js';
import { getBatchesForSale, deductBatchStock, calculateCOGS } from '../utils/inventoryManager.js';
import { postSalesToLedger } from '../utils/ledgerHelper.js';

const router = express.Router();

// @route   GET /api/invoices
// @desc    Get all invoices
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { startDate, endDate, paymentStatus, customer } = req.query;
    let query = { userId: req.user._id };

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
router.get('/stats', protect, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todaySales, totalOutstanding, invoiceCount] = await Promise.all([
      Invoice.aggregate([
        {
          $match: {
            userId: req.user._id,
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
            userId: req.user._id,
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
      Invoice.countDocuments({ userId: req.user._id })
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
router.get('/:id', protect, async (req, res) => {
  try {
    const invoice = await Invoice.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('customer').populate('items.product').populate('items.batch');

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
router.post('/', protect, async (req, res) => {
  try {
    const { items, customer: customerId, ...invoiceData } = req.body;

    // Get shop settings for tax type determination
    const shopSettings = await ShopSettings.findOne({ userId: req.user._id });

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
      customer = await Customer.findOne({
        _id: customerId,
        userId: req.user._id
      });

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

    // Process items with FIFO batch selection
    const processedItems = [];

    for (const item of items) {
      // Validate product
      const product = await Product.findOne({
        _id: item.product,
        userId: req.user._id
      });

      if (!product) {
        throw new Error(`Product not found: ${item.product}`);
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
        const batch = await Batch.findOne({
          _id: item.batch,
          userId: req.user._id,
          product: product._id,
          isActive: true
        });

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
        }, taxType);

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
        const batchesForSale = await getBatchesForSale(product._id, req.user._id, item.quantity);

        for (const batchSale of batchesForSale) {
          // Calculate GST for this portion
          const itemWithGST = calculateItemGST({
            quantity: batchSale.quantity,
            sellingPrice: item.sellingPrice || batchSale.sellingPrice,
            discount: item.discount || 0,
            gstRate: batchSale.gstRate
          }, taxType);

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
    const ledgerEntries = await postSalesToLedger(invoice, req.user._id);
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
router.put('/:id/payment', protect, async (req, res) => {
  try {
    const { paymentStatus, paymentMethod, paidAmount, paymentDetails } = req.body;

    const invoice = await Invoice.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

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
