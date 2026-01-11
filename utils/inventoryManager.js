import Batch from '../models/Batch.js';
import Product from '../models/Product.js';

/**
 * Get available batches for a product using FIFO
 * @param {String} productId
 * @param {String} userId
 * @returns {Array} - Array of batches sorted by FIFO (expiry date, then creation date)
 */
export const getAvailableBatches = async (productId, userId, organizationId) => {
  return await Batch.find({
    userId,
    organizationId,
    product: productId,
    quantity: { $gt: 0 },
    isActive: true,
    expiryDate: { $gt: new Date() } // Only non-expired batches
  }).sort({ expiryDate: 1, createdAt: 1 }); // FIFO: earliest expiry first
};

/**
 * Get batches for sale with FIFO logic
 * @param {String} productId
 * @param {String} userId
 * @param {String} organizationId
 * @param {Number} requestedQuantity
 * @returns {Array} - Array of { batch, quantity } objects
 */
export const getBatchesForSale = async (productId, userId, organizationId, requestedQuantity) => {
  const availableBatches = await getAvailableBatches(productId, userId, organizationId);

  if (availableBatches.length === 0) {
    throw new Error('No stock available');
  }

  const result = [];
  let remainingQuantity = requestedQuantity;

  for (const batch of availableBatches) {
    if (remainingQuantity <= 0) break;

    const quantityFromBatch = Math.min(batch.quantity, remainingQuantity);
    result.push({
      batch: batch._id,
      batchNo: batch.batchNo,
      expiryDate: batch.expiryDate,
      quantity: quantityFromBatch,
      sellingPrice: batch.sellingPrice,
      purchasePrice: batch.purchasePrice,
      mrp: batch.mrp,
      gstRate: batch.gstRate
    });

    remainingQuantity -= quantityFromBatch;
  }

  if (remainingQuantity > 0) {
    throw new Error(`Insufficient stock. Available: ${requestedQuantity - remainingQuantity}, Requested: ${requestedQuantity}`);
  }

  return result;
};

/**
 * Deduct stock from batches (for sales)
 * @param {String} batchId
 * @param {Number} quantity
 * @param {Object} session - MongoDB session for transaction support (optional)
 */
export const deductBatchStock = async (batchId, quantity, session = null) => {
  const batch = await Batch.findById(batchId);

  if (!batch) {
    throw new Error('Batch not found');
  }

  if (batch.quantity < quantity) {
    throw new Error('Insufficient stock in batch');
  }

  batch.quantity -= quantity;

  if (batch.quantity === 0) {
    batch.isActive = false;
    batch.depletedAt = new Date();
  }

  const saveOptions = session ? { session } : {};
  await batch.save(saveOptions);

  // Update product total quantity
  await updateProductTotalStock(batch.product, batch.userId, batch.organizationId, session);

  return batch;
};

/**
 * Add stock to batch (for purchase or sales return)
 * @param {String} batchId
 * @param {Number} quantity
 * @param {Object} session - MongoDB session for transaction support (optional)
 */
export const addBatchStock = async (batchId, quantity, session = null) => {
  const batch = await Batch.findById(batchId);

  if (!batch) {
    throw new Error('Batch not found');
  }

  batch.quantity += quantity;

  if (batch.quantity > 0 && !batch.isActive) {
    batch.isActive = true;
    batch.depletedAt = null;
  }

  const saveOptions = session ? { session } : {};
  await batch.save(saveOptions);

  // Update product total quantity
  await updateProductTotalStock(batch.product, batch.userId, batch.organizationId, session);

  return batch;
};

/**
 * Create new batch (from purchase)
 * @param {Object} batchData
 * @returns {Object} - Created batch
 */
export const createBatch = async (batchData) => {
  const batch = await Batch.create(batchData);

  // Update product total quantity
  await updateProductTotalStock(batch.product, batch.userId, batch.organizationId);

  return batch;
};

/**
 * Update product's total stock quantity from all batches
 * @param {String} productId
 * @param {String} organizationId
 * @param {Object} session - MongoDB session for transaction support (optional)
 */
export const updateProductTotalStock = async (productId, userId, organizationId, session = null) => {
  const queryOptions = {
    organizationId,
    userId,
    product: productId,
    isActive: true
  };

  const batches = session
    ? await Batch.find(queryOptions).session(session)
    : await Batch.find(queryOptions);

  const totalStock = batches.reduce((sum, batch) => sum + batch.quantity, 0);

  const updateOptions = session ? { session } : {};
  await Product.findByIdAndUpdate(productId, {
    stockQuantity: totalStock
  }, updateOptions);

  return totalStock;
};

/**
 * Get near-expiry items (within specified months)
 * @param {String} userId
 * @param {Number} months - Default 3 months
 * @returns {Array} - Batches near expiry
 */
export const getNearExpiryBatches = async (userId, months = 3) => {
  const today = new Date();
  const futureDate = new Date();
  futureDate.setMonth(futureDate.getMonth() + months);

  return await Batch.find({
    userId,
    isActive: true,
    quantity: { $gt: 0 },
    expiryDate: {
      $gte: today,
      $lte: futureDate
    }
  })
    .populate('product', 'name genericName')
    .sort({ expiryDate: 1 });
};

/**
 * Get expired batches
 * @param {String} userId
 * @returns {Array} - Expired batches
 */
export const getExpiredBatches = async (userId) => {
  return await Batch.find({
    userId,
    expiryDate: { $lt: new Date() },
    quantity: { $gt: 0 }
  })
    .populate('product', 'name genericName')
    .sort({ expiryDate: -1 });
};

/**
 * Get low stock products
 * @param {String} userId
 * @returns {Array} - Products below minimum stock level
 */
export const getLowStockProducts = async (userId) => {
  return await Product.find({
    userId,
    isActive: true,
    $expr: { $lt: ['$stockQuantity', '$minStockLevel'] }
  }).sort({ stockQuantity: 1 });
};

/**
 * Calculate COGS (Cost of Goods Sold) for invoice items
 * @param {Array} items - Invoice items with batch references
 * @returns {Number} - Total COGS
 */
export const calculateCOGS = async (items) => {
  let totalCOGS = 0;

  for (const item of items) {
    const batch = await Batch.findById(item.batch);
    if (batch) {
      totalCOGS += batch.purchasePrice * item.quantity;
    }
  }

  return totalCOGS;
};

/**
 * Check if batch can be restocked (for returns)
 * @param {String} batchId
 * @returns {Boolean}
 */
export const canRestockBatch = async (batchId) => {
  const batch = await Batch.findById(batchId);

  if (!batch) return false;

  // Don't restock expired batches
  if (batch.expiryDate < new Date()) return false;

  return true;
};

/**
 * Get batch details
 * @param {String} batchId
 * @returns {Object} - Batch object
 */
export const getBatchDetails = async (batchId) => {
  return await Batch.findById(batchId).populate('product supplier');
};

/**
 * Find or create batch for purchase
 * @param {Object} purchaseItem - Item from purchase
 * @param {String} userId
 * @param {String} organizationId
 * @param {String} supplierId
 * @param {String} purchaseId
 * @returns {Object} - Batch object
 */
export const findOrCreateBatchForPurchase = async (purchaseItem, userId, organizationId, supplierId, purchaseId) => {
  // Build query conditionally - only match existing batch if batchNo is provided
  let batch = null;

  if (purchaseItem.batchNo) {
    batch = await Batch.findOne({
      organizationId,
      userId,
      product: purchaseItem.product,
      batchNo: purchaseItem.batchNo,
      expiryDate: purchaseItem.expiryDate
    });
  }

  if (batch) {
    // Add to existing batch
    batch.quantity += purchaseItem.quantity + (purchaseItem.freeQuantity || 0);
    await batch.save();
  } else {
    // Create new batch - auto-generate batch number if not provided
    const batchNo = purchaseItem.batchNo || `AUTO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Default expiry date to 1 year from now if not provided
    const finalExpiryDate = purchaseItem.expiryDate
      ? new Date(purchaseItem.expiryDate)
      : new Date(new Date().setFullYear(new Date().getFullYear() + 1));

    batch = await createBatch({
      organizationId,
      userId,
      product: purchaseItem.product,
      batchNo: batchNo,
      expiryDate: finalExpiryDate,
      manufacturingDate: purchaseItem.manufacturingDate || null,
      mrp: purchaseItem.mrp || 0,
      purchasePrice: purchaseItem.purchasePrice || 0,
      sellingPrice: purchaseItem.sellingPrice || 0,
      gstRate: purchaseItem.gstRate || 0,
      quantity: purchaseItem.quantity + (purchaseItem.freeQuantity || 0),
      purchaseInvoice: purchaseId,
      supplier: supplierId,
      rack: purchaseItem.rack || ''
    });
  }

  return batch;
};

export default {
  getAvailableBatches,
  getBatchesForSale,
  deductBatchStock,
  addBatchStock,
  createBatch,
  updateProductTotalStock,
  getNearExpiryBatches,
  getExpiredBatches,
  getLowStockProducts,
  calculateCOGS,
  canRestockBatch,
  getBatchDetails,
  findOrCreateBatchForPurchase
};
