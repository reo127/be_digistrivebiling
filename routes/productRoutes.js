import express from 'express';
import Product from '../models/Product.js';
import { protect } from '../middleware/auth.js';
import tenantIsolation, { addOrgFilter } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/requireSuperAdmin.js';

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
    const product = await Product.create({
      ...req.body,
      organizationId: req.organizationId,
      userId: req.user._id
    });
    res.status(201).json(product);
  } catch (error) {
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
