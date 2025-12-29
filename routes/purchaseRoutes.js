import express from 'express';
import Purchase from '../models/Purchase.js';
import Supplier from '../models/Supplier.js';
import Product from '../models/Product.js';
import ShopSettings from '../models/ShopSettings.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation, addOrgFilter } from '../middleware/tenantIsolation.js';
import { calculateItemGST, calculateTotals, determineTaxType } from '../utils/gstCalculations.js';
import { findOrCreateBatchForPurchase } from '../utils/inventoryManager.js';
import { postPurchaseToLedger } from '../utils/ledgerHelper.js';

const router = express.Router();

// Apply authentication and tenant isolation to all routes
router.use(protect);
router.use(tenantIsolation);

// @route   GET /api/purchases
// @desc    Get all purchases
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, supplier, paymentStatus } = req.query;
    let query = addOrgFilter(req);

    if (startDate && endDate) {
      query.purchaseDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (supplier) query.supplier = supplier;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    const purchases = await Purchase.find(query)
      .populate('supplier', 'name gstin phone')
      .sort({ createdAt: -1 });

    res.json(purchases);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/purchases/stats
// @desc    Get purchase statistics
// @access  Private
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const orgFilter = addOrgFilter(req);

    const [todayPurchases, totalPending, purchaseCount] = await Promise.all([
      Purchase.aggregate([
        {
          $match: {
            ...orgFilter,
            purchaseDate: { $gte: today }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$grandTotal' }
          }
        }
      ]),
      Purchase.aggregate([
        {
          $match: {
            ...orgFilter,
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
      Purchase.countDocuments(orgFilter)
    ]);

    res.json({
      todayPurchases: todayPurchases[0]?.total || 0,
      totalPending: totalPending[0]?.total || 0,
      totalPurchases: purchaseCount
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/purchases/:id
// @desc    Get single purchase
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const purchase = await Purchase.findOne(addOrgFilter(req, { _id: req.params.id }))
      .populate('supplier')
      .populate('items.product')
      .populate('items.batch');

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    res.json(purchase);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/purchases
// @desc    Create purchase entry
// @access  Private
router.post('/', async (req, res) => {
  try {
    const { supplier: supplierId, items, ...purchaseData } = req.body;

    // Validate supplier
    if (!supplierId || supplierId === '') {
      return res.status(400).json({ message: 'Please select a supplier' });
    }

    const supplier = await Supplier.findOne(addOrgFilter(req, { _id: supplierId }));

    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    // Validate items array
    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Please add at least one item to the purchase' });
    }

    // Get shop settings for tax type determination
    const shopSettings = await ShopSettings.findOne(addOrgFilter(req));
    const taxType = determineTaxType(shopSettings?.state, supplier.state);

    // Process each item
    const processedItems = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Validate product is selected
      if (!item.product || item.product === '') {
        return res.status(400).json({ message: `Please select a product for item #${i + 1}` });
      }

      // Validate quantity
      if (!item.quantity || item.quantity <= 0) {
        return res.status(400).json({ message: `Please enter a valid quantity for item #${i + 1}` });
      }

      // Validate product exists
      const product = await Product.findOne(addOrgFilter(req, { _id: item.product }));

      if (!product) {
        return res.status(400).json({ message: `Product not found for item #${i + 1}. Please select a valid product.` });
      }

      // Calculate GST for item
      const itemWithGST = calculateItemGST({
        ...item,
        purchasePrice: item.purchasePrice
      }, taxType);

      // Create or update batch
      const batch = await findOrCreateBatchForPurchase(
        {
          ...item,
          ...itemWithGST
        },
        req.user._id,
        req.organizationId || req.user.organizationId,
        supplierId,
        null // Purchase ID will be updated later
      );

      processedItems.push({
        ...itemWithGST,
        product: product._id,
        productName: product.name,
        batch: batch._id,
        hsnCode: product.hsnCode || item.hsnCode,
        unit: product.unit
      });
    }

    // Calculate totals
    const totals = calculateTotals(
      processedItems,
      {
        freight: purchaseData.freight || 0,
        packaging: purchaseData.packaging || 0,
        otherCharges: purchaseData.otherCharges || 0
      },
      purchaseData.discount || 0
    );

    // Calculate balance amount
    const paidAmount = purchaseData.paidAmount || 0;
    const balanceAmount = totals.grandTotal - paidAmount;
    const paymentStatus = balanceAmount <= 0 ? 'PAID' : (paidAmount > 0 ? 'PARTIAL' : 'UNPAID');

    // Create purchase
    const purchase = await Purchase.create({
      userId: req.user._id,
      organizationId: req.organizationId || req.user.organizationId,
      supplier: supplier._id,
      supplierName: supplier.name,
      supplierGstin: supplier.gstin,
      supplierInvoiceNo: purchaseData.billNumber,
      supplierInvoiceDate: purchaseData.billDate,
      purchaseDate: purchaseData.purchaseDate,
      dueDate: purchaseData.dueDate,
      freight: purchaseData.freightCharges || purchaseData.freight || 0,
      packaging: purchaseData.packagingCharges || purchaseData.packaging || 0,
      otherCharges: purchaseData.otherCharges || 0,
      discount: purchaseData.discount || 0,
      paymentMethod: purchaseData.paymentMode || purchaseData.paymentMethod,
      paymentTerms: purchaseData.paymentTerms,
      notes: purchaseData.notes,
      items: processedItems,
      taxType,
      ...totals,
      paymentStatus,
      paidAmount,
      balanceAmount
    });

    // Update batch references with purchase ID
    for (const item of processedItems) {
      const Batch = (await import('../models/Batch.js')).default;
      await Batch.findByIdAndUpdate(item.batch, {
        purchaseInvoice: purchase._id
      });
    }

    // Update supplier totals
    supplier.currentBalance += balanceAmount;
    supplier.totalPurchases += totals.grandTotal;
    await supplier.save();

    // Post to ledger (double entry accounting)
    const ledgerEntries = await postPurchaseToLedger(purchase, req.user._id, req.organizationId || req.user.organizationId);
    purchase.ledgerEntries = ledgerEntries.map(entry => entry._id);
    await purchase.save();

    res.status(201).json(purchase);
  } catch (error) {
    console.error('Purchase creation error:', error);
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/purchases/:id/payment
// @desc    Update payment status
// @access  Private
router.put('/:id/payment', protect, async (req, res) => {
  try {
    const { paymentMethod, paidAmount, paymentDetails } = req.body;

    const purchase = await Purchase.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    const oldBalance = purchase.balanceAmount;
    const newPaidAmount = purchase.paidAmount + (paidAmount || 0);
    const newBalance = purchase.grandTotal - newPaidAmount;

    purchase.paidAmount = newPaidAmount;
    purchase.balanceAmount = newBalance;
    purchase.paymentStatus = newBalance <= 0 ? 'PAID' : (newPaidAmount > 0 ? 'PARTIAL' : 'UNPAID');

    if (paymentMethod) purchase.paymentMethod = paymentMethod;
    if (paymentDetails) purchase.paymentDetails = paymentDetails;

    await purchase.save();

    // Update supplier balance
    const supplier = await Supplier.findById(purchase.supplier);
    if (supplier) {
      supplier.currentBalance = supplier.currentBalance - oldBalance + newBalance;
      await supplier.save();
    }

    res.json(purchase);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE /api/purchases/:id
// @desc    Delete purchase (with validations)
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const purchase = await Purchase.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    // Check if purchase has returns
    if (purchase.isReturned) {
      return res.status(400).json({
        message: 'Cannot delete purchase with returns. Delete returns first.'
      });
    }

    // Warning: This would require reversing inventory and ledger entries
    // For now, we'll just mark it as a soft delete or prevent deletion
    return res.status(400).json({
      message: 'Purchase deletion not allowed. Please create a purchase return instead.'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
