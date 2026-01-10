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

    // Calculate first day of current month
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    firstDayOfMonth.setHours(0, 0, 0, 0);

    const orgFilter = addOrgFilter(req);

    const [todayPurchases, totalPending, purchaseCount, thisMonth, totalAmount] = await Promise.all([
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
      Purchase.countDocuments(orgFilter),
      Purchase.aggregate([
        {
          $match: {
            ...orgFilter,
            purchaseDate: { $gte: firstDayOfMonth }
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
          $match: orgFilter
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
      todayPurchases: todayPurchases[0]?.total || 0,
      totalPending: totalPending[0]?.total || 0,
      totalPurchases: purchaseCount,
      thisMonth: thisMonth[0]?.total || 0,
      totalAmount: totalAmount[0]?.total || 0,
      pendingPayment: totalPending[0]?.total || 0
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

      // Calculate GST for item (pass 'purchase' context to use purchase price)
      const itemWithGST = calculateItemGST({
        ...item,
        purchasePrice: item.purchasePrice
      }, taxType, 'purchase');

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
        batchNo: batch.batchNo,
        expiryDate: batch.expiryDate,
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

// @route   PUT /api/purchases/:id
// @desc    Edit purchase (quantity, supplier, rate, etc.)
// @access  Private
router.put('/:id', async (req, res) => {
  let session = null;

  try {
    const { supplier: supplierId, items, ...purchaseData } = req.body;

    // Get existing purchase with full details
    const oldPurchase = await Purchase.findOne(addOrgFilter(req, { _id: req.params.id }))
      .populate('items.product')
      .populate('items.batch');

    if (!oldPurchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    // CRITICAL: Cannot edit purchase if it has returns
    if (oldPurchase.isReturned) {
      return res.status(400).json({
        message: 'Cannot edit purchase with returns. This would cause accounting inconsistencies.'
      });
    }

    // Validate supplier if changed
    let supplier = null;
    if (supplierId && supplierId !== oldPurchase.supplier.toString()) {
      supplier = await Supplier.findOne(addOrgFilter(req, { _id: supplierId }));
      if (!supplier) {
        return res.status(404).json({ message: 'Supplier not found' });
      }
    } else {
      supplier = await Supplier.findById(oldPurchase.supplier);
      if (!supplier) {
        return res.status(404).json({
          message: 'Original supplier not found. It may have been deleted. Please select a new supplier.'
        });
      }
    }

    // Validate items array
    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Please add at least one item' });
    }

    // Check that products are not changed (only quantities and other fields can change)
    for (let i = 0; i < items.length; i++) {
      const newItem = items[i];
      const oldItem = oldPurchase.items[i];

      if (!oldItem || newItem.product.toString() !== oldItem.product._id.toString()) {
        return res.status(400).json({
          message: 'Cannot change products in purchase. Only quantity, rate, and other details can be edited.'
        });
      }
    }

    if (items.length !== oldPurchase.items.length) {
      return res.status(400).json({
        message: 'Cannot add or remove items. Only edit existing items.'
      });
    }

    // Get shop settings for tax type determination
    const shopSettings = await ShopSettings.findOne(addOrgFilter(req));
    const taxType = determineTaxType(shopSettings?.state, supplier.state);

    // IMPORTANT: Preserve old charges if not provided in request
    const freight = purchaseData.freight !== undefined ? purchaseData.freight : oldPurchase.freight;
    const packaging = purchaseData.packaging !== undefined ? purchaseData.packaging : oldPurchase.packaging;
    const otherCharges = purchaseData.otherCharges !== undefined ? purchaseData.otherCharges : oldPurchase.otherCharges;
    const discount = purchaseData.discount !== undefined ? purchaseData.discount : oldPurchase.discount;

    // Validate charges are not negative BEFORE any database writes
    if (freight < 0) {
      return res.status(400).json({ message: 'Freight charges cannot be negative' });
    }
    if (packaging < 0) {
      return res.status(400).json({ message: 'Packaging charges cannot be negative' });
    }
    if (otherCharges < 0) {
      return res.status(400).json({ message: 'Other charges cannot be negative' });
    }
    if (discount < 0) {
      return res.status(400).json({ message: 'Discount cannot be negative' });
    }

    // Process each item, validate, and prepare batch updates (WITHOUT saving yet)
    const Batch = (await import('../models/Batch.js')).default;
    const processedItems = [];
    const inventoryAdjustments = [];
    const batchUpdates = []; // Store batch updates to apply later

    for (let i = 0; i < items.length; i++) {
      const newItemData = items[i];
      const oldItem = oldPurchase.items[i];
      const product = oldItem.product;

      // Validate product still exists
      if (!product || !product._id) {
        return res.status(400).json({
          message: `Product for item #${i + 1} not found. It may have been deleted. Cannot edit this purchase.`
        });
      }

      // Validate quantities are positive
      if (newItemData.quantity <= 0) {
        return res.status(400).json({
          message: `Quantity for item #${i + 1} (${product.name}) must be greater than 0`
        });
      }
      if (newItemData.freeQuantity && newItemData.freeQuantity < 0) {
        return res.status(400).json({
          message: `Free quantity for item #${i + 1} (${product.name}) cannot be negative`
        });
      }

      // Validate prices are not negative
      if (newItemData.purchasePrice !== undefined && newItemData.purchasePrice < 0) {
        return res.status(400).json({
          message: `Purchase price for item #${i + 1} (${product.name}) cannot be negative`
        });
      }
      if (newItemData.sellingPrice !== undefined && newItemData.sellingPrice < 0) {
        return res.status(400).json({
          message: `Selling price for item #${i + 1} (${product.name}) cannot be negative`
        });
      }
      if (newItemData.mrp !== undefined && newItemData.mrp < 0) {
        return res.status(400).json({
          message: `MRP for item #${i + 1} (${product.name}) cannot be negative`
        });
      }

      // Calculate quantity difference (including free quantity)
      const oldTotalQty = oldItem.quantity + (oldItem.freeQuantity || 0);
      const newTotalQty = newItemData.quantity + (newItemData.freeQuantity || 0);
      const qtyDifference = newTotalQty - oldTotalQty;

      // Calculate GST for item
      const itemWithGST = calculateItemGST({
        ...newItemData,
        purchasePrice: newItemData.purchasePrice
      }, taxType, 'purchase');

      // Fetch batch (read-only, no save yet)
      const batch = await Batch.findById(oldItem.batch);
      if (!batch) {
        return res.status(404).json({ message: `Batch not found for item #${i + 1}` });
      }

      // Calculate new batch values
      const newBatchQuantity = batch.quantity + qtyDifference;
      const newBatchPurchasePrice = newItemData.purchasePrice !== undefined ? newItemData.purchasePrice : batch.purchasePrice;
      const newBatchSellingPrice = newItemData.sellingPrice !== undefined ? newItemData.sellingPrice : batch.sellingPrice;
      const newBatchMrp = newItemData.mrp !== undefined ? newItemData.mrp : batch.mrp;
      const newBatchGstRate = itemWithGST.gstRate !== undefined ? itemWithGST.gstRate : batch.gstRate;

      // Calculate new expiry date
      let newBatchExpiryDate = batch.expiryDate;
      if (newItemData.expiryDate) {
        const newExpiry = new Date(newItemData.expiryDate);
        const oldExpiry = oldItem.expiryDate ? new Date(oldItem.expiryDate) : null;
        if (!oldExpiry || newExpiry.getTime() !== oldExpiry.getTime()) {
          newBatchExpiryDate = newExpiry;
        }
      }

      // Determine new batch active status
      let newBatchIsActive = batch.isActive;
      let newBatchDepletedAt = batch.depletedAt;

      if (newBatchQuantity > 0) {
        newBatchIsActive = true;
        newBatchDepletedAt = null;
      } else if (newBatchQuantity === 0) {
        newBatchIsActive = false;
        newBatchDepletedAt = new Date();
      } else {
        // Negative quantity - keep active
        newBatchIsActive = true;
        newBatchDepletedAt = null;
        console.warn(`Warning: Batch ${batch.batchNo} will have negative inventory: ${newBatchQuantity}`);
      }

      // Store batch update to apply later
      batchUpdates.push({
        batch,
        quantity: newBatchQuantity,
        purchasePrice: newBatchPurchasePrice,
        sellingPrice: newBatchSellingPrice,
        mrp: newBatchMrp,
        gstRate: newBatchGstRate,
        expiryDate: newBatchExpiryDate,
        isActive: newBatchIsActive,
        depletedAt: newBatchDepletedAt
      });

      // Track inventory adjustment
      inventoryAdjustments.push({
        product: product._id,
        productName: product.name,
        batch: batch._id,
        batchNo: batch.batchNo,
        oldQuantity: oldTotalQty,
        newQuantity: newTotalQty,
        difference: qtyDifference
      });

      processedItems.push({
        ...itemWithGST,
        product: product._id,
        productName: product.name,
        batch: batch._id,
        batchNo: batch.batchNo,
        expiryDate: newBatchExpiryDate,
        hsnCode: product.hsnCode || newItemData.hsnCode,
        unit: product.unit
      });
    }

    // Calculate new totals BEFORE any writes

    const totals = calculateTotals(
      processedItems,
      {
        freight,
        packaging,
        otherCharges
      },
      discount
    );

    // Calculate balance amount
    // IMPORTANT: Use old paidAmount if not provided (preserve existing payment)
    const paidAmount = purchaseData.paidAmount !== undefined
      ? purchaseData.paidAmount
      : oldPurchase.paidAmount;

    // Validate payment amount
    if (paidAmount < 0) {
      return res.status(400).json({ message: 'Paid amount cannot be negative' });
    }
    if (paidAmount > totals.grandTotal) {
      return res.status(400).json({
        message: `Paid amount (₹${paidAmount}) cannot exceed grand total (₹${totals.grandTotal})`
      });
    }

    const balanceAmount = totals.grandTotal - paidAmount;
    const paymentStatus = balanceAmount <= 0 ? 'PAID' : (paidAmount > 0 ? 'PARTIAL' : 'UNPAID');

    // ========================================
    // ALL VALIDATIONS PASSED - START TRANSACTION AND DATABASE WRITES
    // ========================================

    // Start MongoDB session for transaction support
    session = await Purchase.startSession();
    session.startTransaction();

    // Apply all batch updates
    for (const batchUpdate of batchUpdates) {
      batchUpdate.batch.quantity = batchUpdate.quantity;
      batchUpdate.batch.purchasePrice = batchUpdate.purchasePrice;
      batchUpdate.batch.sellingPrice = batchUpdate.sellingPrice;
      batchUpdate.batch.mrp = batchUpdate.mrp;
      batchUpdate.batch.gstRate = batchUpdate.gstRate;
      batchUpdate.batch.expiryDate = batchUpdate.expiryDate;
      batchUpdate.batch.isActive = batchUpdate.isActive;
      batchUpdate.batch.depletedAt = batchUpdate.depletedAt;

      await batchUpdate.batch.save({ session });
    }

    // Update product stock quantities
    const { updateProductTotalStock } = await import('../utils/inventoryManager.js');
    for (const adjustment of inventoryAdjustments) {
      await updateProductTotalStock(
        adjustment.product,
        req.user._id,
        req.organizationId || req.user.organizationId,
        session
      );
    }

    // Calculate supplier ledger adjustment
    const supplierChanged = oldPurchase.supplier.toString() !== supplier._id.toString();

    if (supplierChanged) {
      // Different suppliers - update both separately
      const oldSupplier = await Supplier.findById(oldPurchase.supplier);

      // Reverse old supplier ledger
      if (oldSupplier) {
        oldSupplier.currentBalance -= oldPurchase.balanceAmount;
        oldSupplier.totalPurchases -= oldPurchase.grandTotal;
        await oldSupplier.save({ session });
      }

      // Update new supplier ledger
      supplier.currentBalance += balanceAmount;
      supplier.totalPurchases += totals.grandTotal;
      await supplier.save({ session });
    } else {
      // Same supplier - calculate net change
      const balanceChange = balanceAmount - oldPurchase.balanceAmount;
      const totalChange = totals.grandTotal - oldPurchase.grandTotal;

      supplier.currentBalance += balanceChange;
      supplier.totalPurchases += totalChange;
      await supplier.save({ session });
    }

    // Delete old ledger entries
    const LedgerModel = (await import('../models/Ledger.js')).default;
    if (oldPurchase.ledgerEntries && oldPurchase.ledgerEntries.length > 0) {
      await LedgerModel.deleteMany({ _id: { $in: oldPurchase.ledgerEntries } }, { session });
    }

    // Save old values for audit trail BEFORE updating
    const auditData = {
      oldGrandTotal: oldPurchase.grandTotal,
      oldBalanceAmount: oldPurchase.balanceAmount,
      oldSupplier: oldPurchase.supplierName,
      inventoryAdjustments
    };

    // Update purchase document
    oldPurchase.supplier = supplier._id;
    oldPurchase.supplierName = supplier.name;
    oldPurchase.supplierGstin = supplier.gstin;
    oldPurchase.supplierInvoiceNo = purchaseData.billNumber !== undefined ? purchaseData.billNumber : oldPurchase.supplierInvoiceNo;
    oldPurchase.supplierInvoiceDate = purchaseData.billDate !== undefined ? purchaseData.billDate : oldPurchase.supplierInvoiceDate;
    oldPurchase.purchaseDate = purchaseData.purchaseDate !== undefined ? purchaseData.purchaseDate : oldPurchase.purchaseDate;
    oldPurchase.dueDate = purchaseData.dueDate !== undefined ? purchaseData.dueDate : oldPurchase.dueDate;
    oldPurchase.freight = freight;
    oldPurchase.packaging = packaging;
    oldPurchase.otherCharges = otherCharges;
    oldPurchase.discount = discount;
    oldPurchase.paymentMethod = purchaseData.paymentMethod !== undefined ? purchaseData.paymentMethod : oldPurchase.paymentMethod;
    oldPurchase.paymentTerms = purchaseData.paymentTerms !== undefined ? purchaseData.paymentTerms : oldPurchase.paymentTerms;
    oldPurchase.notes = purchaseData.notes !== undefined ? purchaseData.notes : oldPurchase.notes;
    oldPurchase.items = processedItems;
    oldPurchase.taxType = taxType;
    oldPurchase.subtotal = totals.subtotal;
    oldPurchase.totalTax = totals.totalTax;
    oldPurchase.totalCGST = totals.totalCGST;
    oldPurchase.totalSGST = totals.totalSGST;
    oldPurchase.totalIGST = totals.totalIGST;
    oldPurchase.grandTotal = totals.grandTotal;
    oldPurchase.roundOff = totals.roundOff;
    oldPurchase.paymentStatus = paymentStatus;
    oldPurchase.paidAmount = paidAmount;
    oldPurchase.balanceAmount = balanceAmount;

    // Create new ledger entries
    const ledgerEntries = await postPurchaseToLedger(
      oldPurchase,
      req.user._id,
      req.organizationId || req.user.organizationId,
      session
    );
    oldPurchase.ledgerEntries = ledgerEntries.map(entry => entry._id);

    // Add audit trail
    if (!oldPurchase.editHistory) {
      oldPurchase.editHistory = [];
    }
    oldPurchase.editHistory.push({
      editedBy: req.user._id,
      editedAt: new Date(),
      changes: {
        ...auditData,
        newGrandTotal: totals.grandTotal,
        newBalanceAmount: balanceAmount,
        newSupplier: supplier.name
      }
    });

    await oldPurchase.save({ session });

    // Commit the transaction - all changes saved atomically
    await session.commitTransaction();

    res.json({
      success: true,
      purchase: oldPurchase,
      message: 'Purchase updated successfully',
      warnings: inventoryAdjustments
        .filter(adj => adj.difference < 0 && (adj.newQuantity < 0))
        .map(adj => `Warning: ${adj.productName} has negative inventory`)
    });
  } catch (error) {
    // Rollback the transaction on any error - no changes saved
    if (session) {
      await session.abortTransaction();
    }
    console.error('Purchase edit error:', error);
    res.status(500).json({ message: error.message });
  } finally {
    // End the session if it was created
    if (session) {
      session.endSession();
    }
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
