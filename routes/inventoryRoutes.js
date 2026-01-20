import express from 'express';
import Batch from '../models/Batch.js';
import Product from '../models/Product.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation, addOrgFilter } from '../middleware/tenantIsolation.js';
import {
  getAvailableBatches,
  getNearExpiryBatches,
  getExpiredBatches,
  getLowStockProducts
} from '../utils/inventoryManager.js';

const router = express.Router();

router.use(protect);
router.use(tenantIsolation);

// @route   GET /api/inventory/batches
// @desc    Get all batches with product info (optimized for inventory page)
// @access  Private
router.get('/batches', async (req, res) => {
  try {
    const batches = await Batch.find({
      organizationId: req.organizationId,
      isActive: true
    })
      .select('batchNo expiryDate quantity mrp sellingPrice purchasePrice gstRate product supplier') // Only needed fields
      .populate('product', 'name genericName unit') // Only needed product fields
      .populate('supplier', 'name')
      .lean() // Convert to plain JS objects (faster, less memory)
      .sort({ expiryDate: 1, createdAt: -1 }); // Sort by expiry date, then newest first

    // Transform to match frontend expectations
    const batchesWithProductInfo = batches.map(batch => ({
      _id: batch._id,
      batchNo: batch.batchNo,
      expiryDate: batch.expiryDate,
      quantity: batch.quantity,
      mrp: batch.mrp,
      sellingPrice: batch.sellingPrice,
      purchasePrice: batch.purchasePrice,
      gstRate: batch.gstRate,
      product: batch.product,
      productInfo: batch.product // Add productInfo field for compatibility
    }));

    res.json(batchesWithProductInfo);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/inventory/batches/product/:productId
// @desc    Get available batches for a product (FIFO sorted)
// @access  Private
router.get('/batches/product/:productId', async (req, res) => {
  try {
    const batches = await getAvailableBatches(req.params.productId, req.user._id, req.organizationId);
    res.json(batches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/inventory/batches/:id
// @desc    Get single batch details
// @access  Private
router.get('/batches/:id', async (req, res) => {
  try {
    const batch = await Batch.findOne({
      _id: req.params.id,
      organizationId: req.organizationId
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
router.get('/alerts/near-expiry', async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 3;
    const batches = await getNearExpiryBatches(req.organizationId, months);
    res.json(batches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/inventory/alerts/expired
// @desc    Get expired batches
// @access  Private
router.get('/alerts/expired', async (req, res) => {
  try {
    const batches = await getExpiredBatches(req.organizationId);
    res.json(batches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/inventory/alerts/low-stock
// @desc    Get products with low stock
// @access  Private
router.get('/alerts/low-stock', async (req, res) => {
  try {
    const products = await getLowStockProducts(req.organizationId);
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/inventory/stats
// @desc    Get inventory statistics
// @access  Private
router.get('/stats', async (req, res) => {
  try {
    const [totalProducts, totalBatches, nearExpiry, expired, lowStock, inventoryValue] = await Promise.all([
      Product.countDocuments({ organizationId: req.organizationId, isActive: true }),
      Batch.countDocuments({ organizationId: req.organizationId, isActive: true, quantity: { $gt: 0 } }),
      getNearExpiryBatches(req.user._id, 3),
      getExpiredBatches(req.user._id),
      getLowStockProducts(req.user._id),
      Batch.aggregate([
        {
          $match: {
            organizationId: req.organizationId,
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
      totalValue: inventoryValue[0]?.value || 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/inventory/valuation
// @desc    Get inventory valuation report
// @access  Private
router.get('/valuation', async (req, res) => {
  try {
    const batches = await Batch.find({
      organizationId: req.organizationId,
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
router.put('/batches/:id', async (req, res) => {
  try {
    const batch = await Batch.findOne({
      _id: req.params.id,
      organizationId: req.organizationId
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
