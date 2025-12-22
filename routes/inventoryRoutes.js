import express from 'express';
import Batch from '../models/Batch.js';
import Product from '../models/Product.js';
import { protect } from '../middleware/auth.js';
import {
  getAvailableBatches,
  getNearExpiryBatches,
  getExpiredBatches,
  getLowStockProducts
} from '../utils/inventoryManager.js';

const router = express.Router();

// @route   GET /api/inventory/batches/product/:productId
// @desc    Get available batches for a product (FIFO sorted)
// @access  Private
router.get('/batches/product/:productId', protect, async (req, res) => {
  try {
    const batches = await getAvailableBatches(req.params.productId, req.user._id, req.user.organizationId);
    res.json(batches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/inventory/batches/:id
// @desc    Get single batch details
// @access  Private
router.get('/batches/:id', protect, async (req, res) => {
  try {
    const batch = await Batch.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('product', 'name genericName manufacturer')
      .populate('supplier', 'name')
      .populate('purchaseInvoice', 'purchaseNumber');

    if (!batch) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    res.json(batch);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/inventory/alerts/near-expiry
// @desc    Get batches near expiry (within 3 months by default)
// @access  Private
router.get('/alerts/near-expiry', protect, async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 3;
    const batches = await getNearExpiryBatches(req.user._id, months);
    res.json(batches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/inventory/alerts/expired
// @desc    Get expired batches
// @access  Private
router.get('/alerts/expired', protect, async (req, res) => {
  try {
    const batches = await getExpiredBatches(req.user._id);
    res.json(batches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/inventory/alerts/low-stock
// @desc    Get products with low stock
// @access  Private
router.get('/alerts/low-stock', protect, async (req, res) => {
  try {
    const products = await getLowStockProducts(req.user._id);
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/inventory/stats
// @desc    Get inventory statistics
// @access  Private
router.get('/stats', protect, async (req, res) => {
  try {
    const [totalProducts, totalBatches, nearExpiry, expired, lowStock, inventoryValue] = await Promise.all([
      Product.countDocuments({ userId: req.user._id, isActive: true }),
      Batch.countDocuments({ userId: req.user._id, isActive: true, quantity: { $gt: 0 } }),
      getNearExpiryBatches(req.user._id, 3),
      getExpiredBatches(req.user._id),
      getLowStockProducts(req.user._id),
      Batch.aggregate([
        {
          $match: {
            userId: req.user._id,
            isActive: true,
            quantity: { $gt: 0 }
          }
        },
        {
          $group: {
            _id: null,
            value: {
              $sum: {
                $multiply: ['$quantity', '$purchasePrice']
              }
            }
          }
        }
      ])
    ]);

    res.json({
      totalProducts,
      totalBatches,
      nearExpiryCount: nearExpiry.length,
      expiredCount: expired.length,
      lowStockCount: lowStock.length,
      inventoryValue: inventoryValue[0]?.value || 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/inventory/valuation
// @desc    Get inventory valuation report
// @access  Private
router.get('/valuation', protect, async (req, res) => {
  try {
    const batches = await Batch.find({
      userId: req.user._id,
      isActive: true,
      quantity: { $gt: 0 }
    }).populate('product', 'name genericName category');

    const valuation = batches.map(batch => ({
      product: batch.product,
      batchNo: batch.batchNo,
      expiryDate: batch.expiryDate,
      quantity: batch.quantity,
      purchasePrice: batch.purchasePrice,
      sellingPrice: batch.sellingPrice,
      mrp: batch.mrp,
      purchaseValue: batch.quantity * batch.purchasePrice,
      sellingValue: batch.quantity * batch.sellingPrice,
      potentialProfit: batch.quantity * (batch.sellingPrice - batch.purchasePrice)
    }));

    const totals = valuation.reduce((acc, item) => ({
      totalPurchaseValue: acc.totalPurchaseValue + item.purchaseValue,
      totalSellingValue: acc.totalSellingValue + item.sellingValue,
      totalPotentialProfit: acc.totalPotentialProfit + item.potentialProfit
    }), {
      totalPurchaseValue: 0,
      totalSellingValue: 0,
      totalPotentialProfit: 0
    });

    res.json({
      batches: valuation,
      ...totals
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/inventory/batches/:id
// @desc    Update batch details (price, rack, etc.)
// @access  Private
router.put('/batches/:id', protect, async (req, res) => {
  try {
    const batch = await Batch.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!batch) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    // Only allow updating certain fields
    const allowedUpdates = ['sellingPrice', 'mrp', 'rack'];
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        batch[field] = req.body[field];
      }
    });

    await batch.save();
    res.json(batch);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
