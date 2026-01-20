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

// @route   PUT /api/inventory/batches/:id/toggle-active
// @desc    Toggle batch active/inactive status
// @access  Private
router.put('/batches/:id/toggle-active', async (req, res) => {
  try {
    const batch = await Batch.findOne({
      _id: req.params.id,
      organizationId: req.organizationId
    });

    if (!batch) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    // Toggle isActive status
    batch.isActive = !batch.isActive;
    await batch.save();

    // Update product total stock (will exclude inactive batches)
    const { updateProductTotalStock } = await import('../utils/inventoryManager.js');
    await updateProductTotalStock(batch.product, batch.userId, batch.organizationId);

    res.json({
      message: `Batch ${batch.isActive ? 'activated' : 'deactivated'} successfully`,
      batch
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

// @route   DELETE /api/inventory/batches/:id
// @desc    Delete batch (hard delete) and delete product if it's the last batch
// @access  Private
router.delete('/batches/:id', async (req, res) => {
  try {
    const batch = await Batch.findOne({
      _id: req.params.id,
      organizationId: req.organizationId
    });

    if (!batch) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    // Check if batch is referenced in any invoices, purchases, or returns
    const Invoice = (await import('../models/Invoice.js')).default;
    const Purchase = (await import('../models/Purchase.js')).default;
    const SalesReturn = (await import('../models/SalesReturn.js')).default;
    const PurchaseReturn = (await import('../models/PurchaseReturn.js')).default;

    const [invoiceCount, purchaseCount, salesReturnCount, purchaseReturnCount] = await Promise.all([
      Invoice.countDocuments({ 'items.batch': batch._id }),
      Purchase.countDocuments({ 'items.batch': batch._id }),
      SalesReturn.countDocuments({ 'items.batch': batch._id }),
      PurchaseReturn.countDocuments({ 'items.batch': batch._id })
    ]);

    const totalReferences = invoiceCount + purchaseCount + salesReturnCount + purchaseReturnCount;

    if (totalReferences > 0) {
      return res.status(400).json({
        message: `Cannot delete batch. It is referenced in ${totalReferences} transaction(s) (Invoices: ${invoiceCount}, Purchases: ${purchaseCount}, Sales Returns: ${salesReturnCount}, Purchase Returns: ${purchaseReturnCount}). Please deactivate instead.`
      });
    }

    const productId = batch.product;
    const userId = batch.userId;
    const organizationId = batch.organizationId;

    // Hard delete the batch (safe because no references exist)
    await Batch.deleteOne({ _id: batch._id });

    // Check if this was the last batch for this product
    const remainingBatches = await Batch.countDocuments({
      product: productId
    });

    if (remainingBatches === 0) {
      // Delete the product if no batches remain
      await Product.deleteOne({ _id: productId });
      return res.json({
        message: 'Batch and product deleted successfully (last batch)',
        productDeleted: true
      });
    } else {
      // Update product total stock (excluding deleted batch)
      const { updateProductTotalStock } = await import('../utils/inventoryManager.js');
      await updateProductTotalStock(productId, userId, organizationId);

      return res.json({
        message: 'Batch deleted successfully',
        productDeleted: false
      });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
