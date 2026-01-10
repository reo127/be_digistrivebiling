import express from 'express';
import SalesReturn from '../models/SalesReturn.js';
import Invoice from '../models/Invoice.js';
import Customer from '../models/Customer.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation, addOrgFilter } from '../middleware/tenantIsolation.js';
import { calculateItemGST, calculateTotals } from '../utils/gstCalculations.js';
import { addBatchStock, canRestockBatch } from '../utils/inventoryManager.js';
import { postSalesReturnToLedger } from '../utils/ledgerHelper.js';

const router = express.Router();

// Apply authentication and tenant isolation to all routes
router.use(protect);
router.use(tenantIsolation);

// @route   GET /api/sales-returns/stats
// @desc    Get sales return statistics
// @access  Private
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate first day of current month
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    firstDayOfMonth.setHours(0, 0, 0, 0);

    const orgFilter = addOrgFilter(req);

    const [totalReturns, totalAmount, totalRefunded, thisMonth] = await Promise.all([
      SalesReturn.countDocuments(orgFilter),
      SalesReturn.aggregate([
        {
          $match: orgFilter
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$grandTotal' }
          }
        }
      ]),
      SalesReturn.aggregate([
        {
          $match: {
            ...orgFilter,
            refundStatus: 'COMPLETED'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$refundedAmount' }
          }
        }
      ]),
      SalesReturn.aggregate([
        {
          $match: {
            ...orgFilter,
            returnDate: { $gte: firstDayOfMonth }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$grandTotal' }
          }
        }
      ])
    ]);

    res.json({
      totalReturns,
      totalAmount: totalAmount[0]?.total || 0,
      totalRefunded: totalRefunded[0]?.total || 0,
      thisMonth: thisMonth[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/sales-returns
// @desc    Get all sales returns
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, customer } = req.query;
    let query = addOrgFilter(req);

    if (startDate && endDate) {
      query.returnDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (customer) query.customer = customer;

    const returns = await SalesReturn.find(query)
      .populate('customer', 'name phone')
      .populate('originalInvoice', 'invoiceNumber')
      .sort({ createdAt: -1 });

    res.json(returns);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/sales-returns/:id
// @desc    Get single sales return
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const salesReturn = await SalesReturn.findOne(addOrgFilter(req, { _id: req.params.id }))
      .populate('customer')
      .populate('originalInvoice')
      .populate('items.product')
      .populate('items.batch');

    if (!salesReturn) {
      return res.status(404).json({ message: 'Sales return not found' });
    }

    res.json(salesReturn);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/sales-returns
// @desc    Create sales return (Credit Note)
// @access  Private
router.post('/', async (req, res) => {
  try {
    const { originalInvoice: invoiceId, items, reason, reasonDescription, refundMethod } = req.body;

    // Validate original invoice
    const invoice = await Invoice.findOne(addOrgFilter(req, { _id: invoiceId }))
      .populate('customer');

    if (!invoice) {
      return res.status(404).json({ message: 'Original invoice not found' });
    }

    // Process return items
    const processedItems = [];
    for (const item of items) {
      // Find original invoice item
      // For old invoices without batch tracking, match by product
      // For new invoices with batch tracking, match by batch
      let originalItem;
      if (item.batch) {
        // New invoice - match by batch
        originalItem = invoice.items.find(
          ii => ii.batch && ii.batch.toString() === item.batch.toString()
        );
      } else {
        // Old invoice - match by product (and ensure not already fully returned)
        originalItem = invoice.items.find(
          ii => ii.product.toString() === item.product.toString() &&
            (ii.returnedQuantity || 0) < ii.quantity
        );
      }

      if (!originalItem) {
        throw new Error('Item not found in original invoice');
      }

      // Validate return quantity
      const alreadyReturned = originalItem.returnedQuantity || 0;
      if (item.quantity > (originalItem.quantity - alreadyReturned)) {
        throw new Error(`Cannot return more than sold quantity for item`);
      }

      // Calculate GST for return item (use 'invoice' context for sales returns)
      const itemWithGST = calculateItemGST({
        ...item,
        sellingPrice: originalItem.sellingPrice,
        gstRate: originalItem.gstRate
      }, invoice.taxType, 'invoice');

      // Only restock if batch exists and can be restocked
      let canRestock = false;
      let restocked = false;
      if (item.batch) {
        canRestock = await canRestockBatch(item.batch);
        if (canRestock && reason !== 'EXPIRED' && reason !== 'DAMAGED') {
          // Add back to batch inventory
          await addBatchStock(item.batch, item.quantity);
          restocked = true;
        }
      }

      processedItems.push({
        ...itemWithGST,
        product: originalItem.product,
        productName: originalItem.productName,
        batch: item.batch || null,
        batchNo: originalItem.batchNo || item.batchNo,
        expiryDate: originalItem.expiryDate,
        hsnCode: originalItem.hsnCode,
        unit: originalItem.unit,
        canRestock,
        restocked
      });

      // Update original invoice item returned quantity
      originalItem.returnedQuantity = alreadyReturned + item.quantity;
    }

    // Calculate totals
    const totals = calculateTotals(processedItems, {}, 0);

    // Create sales return
    const salesReturn = await SalesReturn.create({
      userId: req.user._id,
      organizationId: req.organizationId || req.user.organizationId,
      customer: invoice.customer?._id,
      customerName: invoice.customerName,
      customerPhone: invoice.customerPhone,
      customerGstin: invoice.customerGstin,
      originalInvoice: invoice._id,
      originalInvoiceNumber: invoice.invoiceNumber,
      reason,
      reasonDescription,
      refundMethod,
      refundStatus: refundMethod ? 'COMPLETED' : 'PENDING',
      refundedAmount: refundMethod ? totals.grandTotal : 0,
      items: processedItems,
      taxType: invoice.taxType,
      ...totals
    });

    // Update original invoice
    const allItemsFullyReturned = invoice.items.every(item => {
      const returned = item.returnedQuantity || 0;
      return returned >= item.quantity;
    });

    invoice.isReturned = allItemsFullyReturned;
    invoice.partiallyReturned = !allItemsFullyReturned && invoice.items.some(item => (item.returnedQuantity || 0) > 0);
    invoice.returnedAmount += totals.grandTotal;
    await invoice.save();

    // Update customer balance if exists
    if (invoice.customer) {
      const customer = await Customer.findById(invoice.customer);
      if (customer) {
        customer.outstandingBalance -= totals.grandTotal;
        await customer.save();
      }
    }

    // Post to ledger
    const ledgerEntries = await postSalesReturnToLedger(salesReturn, req.user._id, req.organizationId || req.user.organizationId);
    salesReturn.ledgerEntries = ledgerEntries.map(entry => entry._id);
    await salesReturn.save();

    res.status(201).json(salesReturn);
  } catch (error) {
    console.error('Sales return error:', error);
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/sales-returns/:id/refund
// @desc    Update refund status
// @access  Private
router.put('/:id/refund', async (req, res) => {
  try {
    const { refundMethod, refundedAmount } = req.body;

    const salesReturn = await SalesReturn.findOne(addOrgFilter(req, { _id: req.params.id }));

    if (!salesReturn) {
      return res.status(404).json({ message: 'Sales return not found' });
    }

    salesReturn.refundMethod = refundMethod;
    salesReturn.refundedAmount = refundedAmount || salesReturn.grandTotal;
    salesReturn.refundStatus = 'COMPLETED';

    await salesReturn.save();

    res.json(salesReturn);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
