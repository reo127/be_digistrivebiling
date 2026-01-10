import express from 'express';
import PurchaseReturn from '../models/PurchaseReturn.js';
import Purchase from '../models/Purchase.js';
import Supplier from '../models/Supplier.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation, addOrgFilter } from '../middleware/tenantIsolation.js';
import { calculateItemGST, calculateTotals } from '../utils/gstCalculations.js';
import { deductBatchStock } from '../utils/inventoryManager.js';
import { postPurchaseReturnToLedger } from '../utils/ledgerHelper.js';

const router = express.Router();

// Apply authentication and tenant isolation to all routes
router.use(protect);
router.use(tenantIsolation);

// @route   GET /api/purchase-returns/stats
// @desc    Get purchase return statistics
// @access  Private
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate first day of current month
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    firstDayOfMonth.setHours(0, 0, 0, 0);

    const orgFilter = addOrgFilter(req);

    const [totalReturns, totalAmount, thisMonth] = await Promise.all([
      PurchaseReturn.countDocuments(orgFilter),
      PurchaseReturn.aggregate([
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
      PurchaseReturn.aggregate([
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
      thisMonth: thisMonth[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/purchase-returns
// @desc    Get all purchase returns
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, supplier } = req.query;
    let query = addOrgFilter(req);

    if (startDate && endDate) {
      query.returnDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (supplier) query.supplier = supplier;

    const returns = await PurchaseReturn.find(query)
      .populate('supplier', 'name gstin')
      .populate('originalPurchase', 'purchaseNumber')
      .sort({ createdAt: -1 });

    res.json(returns);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/purchase-returns/:id
// @desc    Get single purchase return
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const purchaseReturn = await PurchaseReturn.findOne(addOrgFilter(req, { _id: req.params.id }))
      .populate('supplier')
      .populate('originalPurchase')
      .populate('items.product')
      .populate('items.batch');

    if (!purchaseReturn) {
      return res.status(404).json({ message: 'Purchase return not found' });
    }

    res.json(purchaseReturn);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/purchase-returns
// @desc    Create purchase return (Debit Note)
// @access  Private
router.post('/', async (req, res) => {
  try {
    const { originalPurchase: purchaseId, items, reason, reasonDescription } = req.body;

    // Validate original purchase
    const purchase = await Purchase.findOne(addOrgFilter(req, { _id: purchaseId }))
      .populate('supplier');

    if (!purchase) {
      return res.status(404).json({ message: 'Original purchase not found' });
    }

    // Process return items
    const processedItems = [];
    for (const item of items) {
      // Extract batch ID if batch is an object (frontend might send full batch object)
      const batchId = item.batch?._id || item.batch;
      const productId = item.product?._id || item.product;

      // Find original purchase item
      // Match by batch if available, otherwise match by product
      let originalItem;
      if (batchId) {
        originalItem = purchase.items.find(
          pi => pi.batch && pi.batch.toString() === batchId.toString()
        );
      } else {
        originalItem = purchase.items.find(
          pi => pi.product.toString() === productId.toString()
        );
      }

      if (!originalItem) {
        throw new Error('Item not found in original purchase');
      }

      // Validate return quantity
      if (item.quantity > originalItem.quantity) {
        throw new Error(`Cannot return more than purchased quantity for item`);
      }

      // Calculate GST for return item (pass 'purchase' context)
      const itemWithGST = calculateItemGST({
        ...item,
        purchasePrice: originalItem.purchasePrice,
        gstRate: originalItem.gstRate
      }, purchase.taxType, 'purchase');

      // Deduct from batch inventory (removing returned stock) - only if batch exists
      if (batchId) {
        await deductBatchStock(batchId, item.quantity);
      }

      processedItems.push({
        ...itemWithGST,
        product: originalItem.product,
        productName: originalItem.productName,
        batch: batchId || null,
        batchNo: originalItem.batchNo,
        expiryDate: originalItem.expiryDate,
        hsnCode: originalItem.hsnCode,
        unit: originalItem.unit
      });
    }

    // Calculate totals
    const totals = calculateTotals(processedItems, {}, 0);

    // Create purchase return
    const purchaseReturn = await PurchaseReturn.create({
      userId: req.user._id,
      organizationId: req.organizationId || req.user.organizationId,
      supplier: purchase.supplier._id,
      supplierName: purchase.supplierName,
      supplierGstin: purchase.supplierGstin,
      originalPurchase: purchase._id,
      originalPurchaseNumber: purchase.purchaseNumber,
      reason,
      reasonDescription,
      items: processedItems,
      taxType: purchase.taxType,
      ...totals
    });

    // Update original purchase
    purchase.isReturned = true;
    purchase.returnedAmount += totals.grandTotal;
    await purchase.save();

    // Update supplier balance
    const supplier = await Supplier.findById(purchase.supplier);
    if (supplier) {
      supplier.currentBalance -= totals.grandTotal;
      supplier.totalReturns += totals.grandTotal;
      await supplier.save();
    }

    // Post to ledger
    const ledgerEntries = await postPurchaseReturnToLedger(purchaseReturn, req.user._id, req.organizationId || req.user.organizationId);
    purchaseReturn.ledgerEntries = ledgerEntries.map(entry => entry._id);
    await purchaseReturn.save();

    res.status(201).json(purchaseReturn);
  } catch (error) {
    console.error('Purchase return error:', error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
