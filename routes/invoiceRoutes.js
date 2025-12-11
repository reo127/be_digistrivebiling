import express from 'express';
import Invoice from '../models/Invoice.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import { protect } from '../middleware/auth.js';

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
    }).populate('customer').populate('items.product');

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    res.json(invoice);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/invoices
// @desc    Create invoice
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const { items, customer, ...invoiceData } = req.body;

    // Calculate totals and update stock
    const processedItems = await Promise.all(
      items.map(async (item) => {
        const product = await Product.findById(item.product);

        if (!product) {
          throw new Error(`Product not found: ${item.product}`);
        }

        // Check stock
        if (product.stockQuantity < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name}`);
        }

        // Calculate tax
        const itemTotal = item.sellingPrice * item.quantity;
        const taxAmount = (itemTotal * item.gstRate) / 100;

        let cgst = 0, sgst = 0, igst = 0;

        if (invoiceData.taxType === 'CGST_SGST') {
          cgst = taxAmount / 2;
          sgst = taxAmount / 2;
        } else {
          igst = taxAmount;
        }

        // Update stock
        product.stockQuantity -= item.quantity;
        await product.save();

        return {
          ...item,
          productName: product.name,
          batchNo: product.batchNo,
          expiryDate: product.expiryDate,
          hsnCode: product.hsnCode,
          unit: product.unit,
          mrp: product.mrp,
          taxAmount,
          cgst,
          sgst,
          igst,
          totalAmount: itemTotal + taxAmount
        };
      })
    );

    // Calculate invoice totals
    const subtotal = processedItems.reduce((sum, item) =>
      sum + (item.sellingPrice * item.quantity), 0);

    const totalTax = processedItems.reduce((sum, item) =>
      sum + item.taxAmount, 0);

    const totalCGST = processedItems.reduce((sum, item) =>
      sum + (item.cgst || 0), 0);

    const totalSGST = processedItems.reduce((sum, item) =>
      sum + (item.sgst || 0), 0);

    const totalIGST = processedItems.reduce((sum, item) =>
      sum + (item.igst || 0), 0);

    const grandTotal = subtotal + totalTax - (invoiceData.discount || 0);
    const roundOff = Math.round(grandTotal) - grandTotal;
    const finalTotal = Math.round(grandTotal);

    // Get customer details
    let customerData = {
      customerName: invoiceData.customerName,
      customerPhone: invoiceData.customerPhone,
      customerAddress: invoiceData.customerAddress,
      customerGstin: invoiceData.customerGstin
    };

    if (customer) {
      const customerDoc = await Customer.findById(customer);
      if (customerDoc) {
        customerData = {
          customer: customerDoc._id,
          customerName: customerDoc.name,
          customerPhone: customerDoc.phone,
          customerAddress: customerDoc.address,
          customerGstin: customerDoc.gstin
        };

        // Update customer outstanding
        if (invoiceData.paymentStatus !== 'PAID') {
          customerDoc.outstandingBalance += (invoiceData.balanceAmount || finalTotal);
          await customerDoc.save();
        }
      }
    }

    const invoice = await Invoice.create({
      userId: req.user._id,
      ...customerData,
      items: processedItems,
      subtotal,
      totalTax,
      totalCGST,
      totalSGST,
      totalIGST,
      discount: invoiceData.discount || 0,
      roundOff,
      grandTotal: finalTotal,
      taxType: invoiceData.taxType,
      paymentStatus: invoiceData.paymentStatus || 'UNPAID',
      paymentMethod: invoiceData.paymentMethod || 'CASH',
      paidAmount: invoiceData.paidAmount || 0,
      balanceAmount: invoiceData.balanceAmount || (invoiceData.paymentStatus === 'PAID' ? 0 : finalTotal),
      paymentDetails: invoiceData.paymentDetails,
      notes: invoiceData.notes,
      invoiceDate: invoiceData.invoiceDate || new Date()
    });

    res.status(201).json(invoice);
  } catch (error) {
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
