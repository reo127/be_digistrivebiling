import express from 'express';
import Supplier from '../models/Supplier.js';
import { protect } from '../middleware/auth.js';
import tenantIsolation, { addOrgFilter } from '../middleware/tenantIsolation.js';
import { requirePermission } from '../middleware/requireSuperAdmin.js';
import { validateGSTIN } from '../utils/gstCalculations.js';

const router = express.Router();

// Apply authentication and tenant isolation to all routes
router.use(protect);
router.use(tenantIsolation);

// @route   GET /api/suppliers
// @desc    Get all suppliers
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { search, isActive } = req.query;
    let query = addOrgFilter(req, {});

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    let suppliers;
    if (search) {
      suppliers = await Supplier.find({
        ...query,
        $text: { $search: search }
      }).sort({ createdAt: -1 });
    } else {
      suppliers = await Supplier.find(query).sort({ createdAt: -1 });
    }

    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/suppliers/stats
// @desc    Get supplier statistics
// @access  Private
router.get('/stats', async (req, res) => {
  try {
    const [totalSuppliers, activeSuppliers, totalPayable] = await Promise.all([
      Supplier.countDocuments(addOrgFilter(req, {})),
      Supplier.countDocuments(addOrgFilter(req, { isActive: true })),
      Supplier.aggregate([
        { $match: addOrgFilter(req, { currentBalance: { $gt: 0 } }) },
        { $group: { _id: null, total: { $sum: '$currentBalance' } } }
      ])
    ]);

    res.json({
      totalSuppliers,
      activeSuppliers,
      totalPayable: totalPayable[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/suppliers/:id
// @desc    Get single supplier
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const supplier = await Supplier.findOne(
      addOrgFilter(req, { _id: req.params.id })
    );

    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    res.json(supplier);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/suppliers
// @desc    Create supplier
// @access  Private (requires permission)
router.post('/', requirePermission('canManageSuppliers'), async (req, res) => {
  try {
    const { gstin, name, phone, state } = req.body;

    // Validate required fields
    if (!name || !phone || !gstin || !state) {
      return res.status(400).json({
        message: 'Name, phone, GSTIN, and state are required'
      });
    }

    // Validate GSTIN format
    if (!validateGSTIN(gstin)) {
      return res.status(400).json({
        message: 'Invalid GSTIN format'
      });
    }

    // Check if supplier with same GSTIN already exists
    const existingSupplier = await Supplier.findOne(
      addOrgFilter(req, { gstin: gstin.toUpperCase() })
    );

    if (existingSupplier) {
      return res.status(400).json({
        message: 'Supplier with this GSTIN already exists'
      });
    }

    const supplier = await Supplier.create({
      ...req.body,
      organizationId: req.organizationId,
      userId: req.user._id,
      currentBalance: req.body.openingBalance || 0
    });

    res.status(201).json(supplier);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/suppliers/:id
// @desc    Update supplier
// @access  Private (requires permission)
router.put('/:id', requirePermission('canManageSuppliers'), async (req, res) => {
  try {
    const supplier = await Supplier.findOne(
      addOrgFilter(req, { _id: req.params.id })
    );

    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    // If GSTIN is being updated, validate it
    if (req.body.gstin && req.body.gstin !== supplier.gstin) {
      if (!validateGSTIN(req.body.gstin)) {
        return res.status(400).json({ message: 'Invalid GSTIN format' });
      }

      // Check if new GSTIN already exists
      const existingSupplier = await Supplier.findOne(
        addOrgFilter(req, {
          gstin: req.body.gstin.toUpperCase(),
          _id: { $ne: supplier._id }
        })
      );

      if (existingSupplier) {
        return res.status(400).json({
          message: 'Another supplier with this GSTIN already exists'
        });
      }
    }

    // Update supplier
    Object.keys(req.body).forEach(key => {
      if (key !== 'userId' && key !== 'organizationId' && key !== 'currentBalance' && key !== 'totalPurchases' && key !== 'totalReturns') {
        supplier[key] = req.body[key];
      }
    });

    await supplier.save();
    res.json(supplier);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE /api/suppliers/:id
// @desc    Delete/Deactivate supplier
// @access  Private (requires permission)
router.delete('/:id', requirePermission('canManageSuppliers'), async (req, res) => {
  try {
    const supplier = await Supplier.findOne(
      addOrgFilter(req, { _id: req.params.id })
    );

    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    // Check if supplier has outstanding balance
    if (supplier.currentBalance > 0) {
      return res.status(400).json({
        message: 'Cannot delete supplier with outstanding balance. Please settle all dues first.'
      });
    }

    // Soft delete - just mark as inactive
    supplier.isActive = false;
    await supplier.save();

    res.json({ message: 'Supplier deactivated successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/suppliers/:id/ledger
// @desc    Get supplier ledger
// @access  Private
router.get('/:id/ledger', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const supplier = await Supplier.findOne(
      addOrgFilter(req, { _id: req.params.id })
    );

    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    // Import dynamically to avoid circular dependency
    const { getPartyLedger } = await import('../utils/ledgerHelper.js');

    const ledgerEntries = await getPartyLedger(
      req.organizationId,
      req.user._id,
      'SUPPLIER',
      supplier._id,
      { startDate, endDate }
    );

    res.json({
      supplier,
      ledgerEntries,
      currentBalance: supplier.currentBalance
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
