import express from 'express';
import Product from '../models/Product.js';
import { protect } from '../middleware/auth.js';
import tenantIsolation, { addOrgFilter } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/requireSuperAdmin.js';
import { createBatch } from '../utils/inventoryManager.js';

const router = express.Router();

// Apply authentication and tenant isolation to all routes
router.use(protect);
router.use(tenantIsolation);

// @route   GET /api/products
// @desc    Get all products
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { search, lowStock } = req.query;
    let query = addOrgFilter(req, { isActive: true });

    if (search) {
      query.$text = { $search: search };
    }

    if (lowStock === 'true') {
      const products = await Product.find(query);
      const lowStockProducts = products.filter(p => p.stockQuantity <= p.minStockLevel);
      return res.json(lowStockProducts);
    }

    const products = await Product.find(query).sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/products/:id
// @desc    Get single product
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findOne(
      addOrgFilter(req, { _id: req.params.id })
    );

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/products
// @desc    Create product
// @access  Private (requires permission)
router.post('/', requirePermission('canManageProducts'), async (req, res) => {
  try {
    const { stockQuantity, batchNo, expiryDate, ...productData } = req.body;

    // Create product with ZERO stock initially
    const product = await Product.create({
      ...productData,
      stockQuantity: 0, // Always start with 0
      organizationId: req.organizationId,
      userId: req.user._id
    });

    // If initial stock provided, create initial batch
    if (stockQuantity && stockQuantity > 0) {
      // Auto-generate batch number if not provided
      const finalBatchNo = batchNo && batchNo.trim()
        ? batchNo.trim()
        : `AUTO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Default expiry date to 1 year from now if not provided
      const finalExpiryDate = expiryDate
        ? new Date(expiryDate)
        : new Date(new Date().setFullYear(new Date().getFullYear() + 1));

      await createBatch({
        organizationId: req.organizationId,
        userId: req.user._id,
        product: product._id,
        batchNo: finalBatchNo,
        expiryDate: finalExpiryDate,
        manufacturingDate: productData.manufacturingDate || null,
        mrp: product.mrp,
        purchasePrice: product.purchasePrice,
        sellingPrice: product.sellingPrice,
        gstRate: product.gstRate,
        quantity: stockQuantity,
        purchaseInvoice: null, // No purchase reference for initial stock
        supplier: null,
        rack: product.rack || ''
      });

      // createBatch automatically calls updateProductTotalStock
      // So product.stockQuantity will be updated to match batch quantity
    }

    // Fetch updated product (with correct stockQuantity if batch was created)
    const updatedProduct = await Product.findById(product._id);
    res.status(201).json(updatedProduct);

  } catch (error) {
    console.error('Product creation error:', error);
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/products/:id
// @desc    Update product
// @access  Private (requires permission)
router.put('/:id', requirePermission('canManageProducts'), async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      addOrgFilter(req, { _id: req.params.id }),
      req.body,
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE /api/products/:id
// @desc    Delete product (soft delete)
// @access  Private (requires permission)
router.delete('/:id', requirePermission('canManageProducts'), async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      addOrgFilter(req, { _id: req.params.id }),
      { isActive: false },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
