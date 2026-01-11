import express from 'express';
import Invoice from '../models/Invoice.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import ShopSettings from '../models/ShopSettings.js';
import Batch from '../models/Batch.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation, addOrgFilter } from '../middleware/tenantIsolation.js';
import { calculateItemGST, calculateTotals, determineTaxType } from '../utils/gstCalculations.js';
import { getBatchesForSale, deductBatchStock, addBatchStock, calculateCOGS } from '../utils/inventoryManager.js';
import { postSalesToLedger } from '../utils/ledgerHelper.js';
import Ledger from '../models/Ledger.js';

const router = express.Router();

// Apply authentication and tenant isolation to all routes
router.use(protect);
router.use(tenantIsolation);

// @route   GET /api/invoices
// @desc    Get all invoices
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, paymentStatus, customer } = req.query;
    let query = addOrgFilter(req); // Use organizationId filter

    if (startDate && endDate) {
      query.invoiceDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    if (customer) {
      query.customer = customer;
    }

    const invoices = await Invoice.find(query)
      .populate('customer', 'name phone')
      .sort({ createdAt: -1 });

    res.json(invoices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/invoices/stats
// @desc    Get invoice statistics
// @access  Private
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate first day of current month
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    firstDayOfMonth.setHours(0, 0, 0, 0);

    const orgFilter = addOrgFilter(req); // Use organizationId filter

    const [todaySales, totalOutstanding, invoiceCount, monthlyRevenue] = await Promise.all([
      Invoice.aggregate([
        {
          $match: {
            ...orgFilter,
            invoiceDate: { $gte: today }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$grandTotal' }
          }
        }
      ]),
      Invoice.aggregate([
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
      Invoice.countDocuments(orgFilter),
      Invoice.aggregate([
        {
          $match: {
            ...orgFilter,
            invoiceDate: { $gte: firstDayOfMonth }
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
      todaySales: todaySales[0]?.total || 0,
      totalOutstanding: totalOutstanding[0]?.total || 0,
      totalInvoices: invoiceCount,
      monthlyRevenue: monthlyRevenue[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/invoices/:id
// @desc    Get single invoice
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const query = addOrgFilter(req, { _id: req.params.id });
    const invoice = await Invoice.findOne(query)
      .populate('customer')
      .populate('items.product')
      .populate('items.batch');

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    res.json(invoice);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/invoices
// @desc    Create invoice with FIFO batch selection
// @access  Private
router.post('/', async (req, res) => {
  try {
    const { items, customer: customerId, ...invoiceData } = req.body;

    // Get shop settings for tax type determination
    const shopSettings = await ShopSettings.findOne(addOrgFilter(req));

    // Determine tax type based on customer state
    let taxType = invoiceData.taxType || 'CGST_SGST';
    let customerData = {
      customerName: invoiceData.customerName,
      customerPhone: invoiceData.customerPhone,
      customerAddress: invoiceData.customerAddress,
      customerCity: invoiceData.customerCity,
      customerState: invoiceData.customerState,
      customerGstin: invoiceData.customerGstin
    };

    // Get customer details if provided
    let customer = null;
    if (customerId) {
      customer = await Customer.findOne(addOrgFilter(req, { _id: customerId }));

      if (customer) {
        customerData = {
          customer: customer._id,
          customerName: customer.name,
          customerPhone: customer.phone,
          customerAddress: customer.address,
          customerCity: customer.city,
          customerState: customer.state,
          customerGstin: customer.gstin
        };

        // Determine tax type based on customer state
        if (shopSettings && customer.state) {
          taxType = determineTaxType(shopSettings.state, customer.state);
        }
      }
    }

    // Validate items array
    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Please add at least one item to the invoice' });
    }

    // Process items with FIFO batch selection
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

      // Check total available stock
      if (product.stockQuantity < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stockQuantity}, Requested: ${item.quantity}`);
      }

      // FIFO batch selection - two modes:
      // Mode 1: User selects specific batch (item.batch provided)
      // Mode 2: Automatic FIFO selection (item.batch not provided)

      if (item.batch) {
        // Manual batch selection
        const batch = await Batch.findOne(addOrgFilter(req, {
          _id: item.batch,
          product: product._id,
          isActive: true
        }));

        if (!batch) {
          throw new Error(`Batch not found or inactive for ${product.name}`);
        }

        if (batch.quantity < item.quantity) {
          throw new Error(`Insufficient stock in selected batch for ${product.name}`);
        }

        // Calculate GST for this item
        const itemWithGST = calculateItemGST({
          quantity: item.quantity,
          sellingPrice: item.sellingPrice || batch.sellingPrice,
          discount: item.discount || 0,
          gstRate: batch.gstRate
        }, taxType, 'invoice');

        // Deduct from batch
        await deductBatchStock(batch._id, item.quantity);

        processedItems.push({
          product: product._id,
          productName: product.name,
          batch: batch._id,
          batchNo: batch.batchNo,
          expiryDate: batch.expiryDate,
          hsnCode: product.hsnCode,
          quantity: item.quantity,
          unit: product.unit,
          mrp: batch.mrp,
          purchasePrice: batch.purchasePrice, // For COGS
          sellingPrice: item.sellingPrice || batch.sellingPrice,
          ...itemWithGST
        });

      } else {
        // Automatic FIFO selection
        const batchesForSale = await getBatchesForSale(product._id, req.user._id, req.user.organizationId, item.quantity);

        for (const batchSale of batchesForSale) {
          // Calculate GST for this portion
          const itemWithGST = calculateItemGST({
            quantity: batchSale.quantity,
            sellingPrice: item.sellingPrice || batchSale.sellingPrice,
            discount: item.discount || 0,
            gstRate: batchSale.gstRate
          }, taxType, 'invoice');

          // Deduct from batch
          await deductBatchStock(batchSale.batch, batchSale.quantity);

          processedItems.push({
            product: product._id,
            productName: product.name,
            batch: batchSale.batch,
            batchNo: batchSale.batchNo,
            expiryDate: batchSale.expiryDate,
            hsnCode: product.hsnCode,
            quantity: batchSale.quantity,
            unit: product.unit,
            mrp: batchSale.mrp,
            purchasePrice: batchSale.purchasePrice, // For COGS
            sellingPrice: item.sellingPrice || batchSale.sellingPrice,
            ...itemWithGST
          });
        }
      }
    }

    // Calculate invoice totals
    const totals = calculateTotals(processedItems, {}, invoiceData.discount || 0);

    // Calculate COGS (Cost of Goods Sold)
    const cogs = await calculateCOGS(processedItems);

    // Calculate payment details
    const paidAmount = invoiceData.paidAmount || 0;
    const balanceAmount = totals.grandTotal - paidAmount;
    const paymentStatus = balanceAmount <= 0 ? 'PAID' : (paidAmount > 0 ? 'PARTIAL' : 'UNPAID');

    // Check if E-way bill is required (inter-state sales > 50000)
    const eWayBillRequired = taxType === 'IGST' && totals.grandTotal > 50000;

    // Create invoice
    const invoice = await Invoice.create({
      userId: req.user._id,
      organizationId: req.organizationId || req.user.organizationId,
      ...customerData,
      items: processedItems,
      ...totals,
      taxType,
      paymentStatus,
      paymentMethod: invoiceData.paymentMethod || 'CASH',
      paidAmount,
      balanceAmount,
      paymentDetails: invoiceData.paymentDetails,
      notes: invoiceData.notes,
      invoiceDate: invoiceData.invoiceDate || new Date(),
      cogs,
      // Prescription tracking
      prescriptionRequired: invoiceData.prescriptionRequired || false,
      prescriptionNumber: invoiceData.prescriptionNumber,
      doctorName: invoiceData.doctorName,
      prescriptionDate: invoiceData.prescriptionDate,
      // E-way bill
      eWayBillRequired,
      eWayBillNumber: invoiceData.eWayBillNumber,
      eWayBillDate: invoiceData.eWayBillDate,
      transporterName: invoiceData.transporterName,
      vehicleNumber: invoiceData.vehicleNumber,
      distance: invoiceData.distance
    });

    // Update customer outstanding
    if (customer && paymentStatus !== 'PAID') {
      customer.outstandingBalance += balanceAmount;
      await customer.save();
    }

    // Post to ledger (double-entry accounting)
    const ledgerEntries = await postSalesToLedger(invoice, req.user._id, req.organizationId || req.user.organizationId);
    invoice.ledgerEntries = ledgerEntries.map(entry => entry._id);
    await invoice.save();

    res.status(201).json(invoice);
  } catch (error) {
    console.error('Invoice creation error:', error);
    res.status(500).json({ message: error.message });
  }
});
// @route   PUT /api/invoices/:id
// @desc    Edit invoice (items, quantities, prices, customer, payment, etc.)
// @access  Private
router.put('/:id', async (req, res) => {
  let session = null;

  try {
    const { items, customer: customerId, ...invoiceData } = req.body;

    // Get existing invoice with full details
    const oldInvoice = await Invoice.findOne(addOrgFilter(req, { _id: req.params.id }))
      .populate('customer')
      .populate('items.product')
      .populate('items.batch');

    if (!oldInvoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // IMPORTANT: Allow editing even with partial returns, but track returned quantities
    // Fully returned invoices should still be editable for corrections

    // Validate items array
    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Invoice must have at least one item' });
    }

    // Get shop settings for tax determination
    const shopSettings = await ShopSettings.findOne(addOrgFilter(req));
    
    // Handle customer changes
    let customer = null;
    let taxType = invoiceData.taxType || oldInvoice.taxType || 'CGST_SGST';
    let customerData = {};

    // Check if customer was explicitly provided (even if undefined/null)
    const customerProvided = 'customer' in req.body;
    const oldCustomerId = oldInvoice.customer?._id?.toString();

    if (customerProvided && customerId && customerId !== oldCustomerId) {
      // Customer changed to a different customer
      customer = await Customer.findOne(addOrgFilter(req, { _id: customerId }));
      if (!customer) {
        return res.status(404).json({ message: 'Customer not found' });
      }
      customerData = {
        customer: customer._id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerAddress: customer.address,
        customerCity: customer.city,
        customerState: customer.state,
        customerGstin: customer.gstin
      };
      if (shopSettings && customer.state) {
        taxType = determineTaxType(shopSettings.state, customer.state);
      }
    } else if (customerProvided && !customerId && oldCustomerId) {
      // Changed from customer to cash customer
      customer = null;
      customerData = {
        customerName: invoiceData.customerName || 'Cash Customer',
        customerPhone: invoiceData.customerPhone || '',
        customerAddress: invoiceData.customerAddress || '',
        customerCity: invoiceData.customerCity || '',
        customerState: invoiceData.customerState || '',
        customerGstin: invoiceData.customerGstin || ''
      };
    } else if (oldInvoice.customer && (!customerProvided || customerId === oldCustomerId)) {
      // Same customer - preserve or update details
      customer = oldInvoice.customer;
      customerData = {
        customer: customer._id,
        customerName: invoiceData.customerName !== undefined ? invoiceData.customerName : oldInvoice.customerName,
        customerPhone: invoiceData.customerPhone !== undefined ? invoiceData.customerPhone : oldInvoice.customerPhone,
        customerAddress: invoiceData.customerAddress !== undefined ? invoiceData.customerAddress : oldInvoice.customerAddress,
        customerCity: invoiceData.customerCity !== undefined ? invoiceData.customerCity : oldInvoice.customerCity,
        customerState: invoiceData.customerState !== undefined ? invoiceData.customerState : oldInvoice.customerState,
        customerGstin: invoiceData.customerGstin !== undefined ? invoiceData.customerGstin : oldInvoice.customerGstin
      };
    } else {
      // Walk-in customer (was cash, remains cash)
      customer = null;
      customerData = {
        customerName: invoiceData.customerName !== undefined ? invoiceData.customerName : oldInvoice.customerName,
        customerPhone: invoiceData.customerPhone !== undefined ? invoiceData.customerPhone : oldInvoice.customerPhone,
        customerAddress: invoiceData.customerAddress !== undefined ? invoiceData.customerAddress : oldInvoice.customerAddress,
        customerCity: invoiceData.customerCity !== undefined ? invoiceData.customerCity : oldInvoice.customerCity,
        customerState: invoiceData.customerState !== undefined ? invoiceData.customerState : oldInvoice.customerState,
        customerGstin: invoiceData.customerGstin !== undefined ? invoiceData.customerGstin : oldInvoice.customerGstin
      };
    }

    // Identify inventory changes - compare old items vs new items
    const inventoryChanges = [];
    const newItemsMap = new Map();
    
    // Build map of new items by product+batch
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = item.batch ? `${item.product}_${item.batch}` : `${item.product}_manual_${i}`;
      newItemsMap.set(key, { ...item, index: i });
    }

    // Check which old items were removed or quantity decreased
    for (const oldItem of oldInvoice.items) {
      const oldKey = oldItem.batch ? `${oldItem.product._id}_${oldItem.batch._id}` : null;
      const newItem = oldKey && newItemsMap.get(oldKey);

      if (!newItem) {
        // Item removed - add stock back to original batch
        const returnedQty = oldItem.returnedQuantity || 0;
        const availableToReturn = oldItem.quantity - returnedQty;
        
        if (availableToReturn > 0 && oldItem.batch) {
          inventoryChanges.push({
            type: 'REMOVE',
            batch: oldItem.batch._id,
            batchNo: oldItem.batch.batchNo,
            product: oldItem.product._id,
            productName: oldItem.productName,
            oldQuantity: oldItem.quantity,
            newQuantity: 0,
            change: availableToReturn,
            returnedQuantity: returnedQty
          });
        }
      } else {
        // Item exists in both - check quantity change
        const returnedQty = oldItem.returnedQuantity || 0;
        const oldAvailableQty = oldItem.quantity - returnedQty;
        const requestedQty = newItem.quantity;

        if (requestedQty < oldAvailableQty) {
          // Quantity decreased - return stock
          const returnQty = oldAvailableQty - requestedQty;
          if (oldItem.batch) {
            inventoryChanges.push({
              type: 'DECREASE',
              batch: oldItem.batch._id,
              batchNo: oldItem.batch.batchNo,
              product: oldItem.product._id,
              productName: oldItem.productName,
              oldQuantity: oldItem.quantity,
              newQuantity: requestedQty,
              change: returnQty,
              returnedQuantity: returnedQty
            });
          }
        } else if (requestedQty > oldAvailableQty) {
          // Quantity increased - need more stock (will handle in new items processing)
          inventoryChanges.push({
            type: 'INCREASE',
            batch: oldItem.batch?._id,
            product: oldItem.product._id,
            productName: oldItem.productName,
            oldQuantity: oldItem.quantity,
            newQuantity: requestedQty,
            change: requestedQty - oldAvailableQty,
            needsValidation: true
          });
        }
      }
    }

    // Process new/modified items - validate stock and calculate GST
    const processedItems = [];
    const oldItemsMap = new Map();
    
    // Build map of old items
    for (const oldItem of oldInvoice.items) {
      const key = oldItem.batch ? `${oldItem.product._id}_${oldItem.batch._id}` : null;
      if (key) oldItemsMap.set(key, oldItem);
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Validate product
      const product = await Product.findOne(addOrgFilter(req, { _id: item.product }));
      if (!product) {
        return res.status(400).json({ message: `Product not found for item #${i + 1}` });
      }

      // Validate quantity
      if (!item.quantity || item.quantity <= 0) {
        return res.status(400).json({ message: `Invalid quantity for item #${i + 1} (${product.name})` });
      }

      const itemKey = item.batch ? `${item.product}_${item.batch}` : null;
      const oldItem = itemKey && oldItemsMap.get(itemKey);

      if (!oldItem) {
        // NEW ITEM - Use FIFO batch selection (like invoice creation)
        if (item.batch) {
          // Manual batch selection
          const batch = await Batch.findOne(addOrgFilter(req, {
            _id: item.batch,
            product: product._id,
            isActive: true
          }));

          if (!batch) {
            return res.status(400).json({ message: `Batch not found for ${product.name}` });
          }

          if (batch.quantity < item.quantity) {
            return res.status(400).json({
              message: `Insufficient stock for ${product.name}. Available: ${batch.quantity}, Requested: ${item.quantity}`
            });
          }

          // Calculate GST
          const itemWithGST = calculateItemGST({
            quantity: item.quantity,
            sellingPrice: item.sellingPrice || batch.sellingPrice,
            discount: item.discount || 0,
            gstRate: batch.gstRate
          }, taxType, 'invoice');

          processedItems.push({
            product: product._id,
            productName: product.name,
            batch: batch._id,
            batchNo: batch.batchNo,
            expiryDate: batch.expiryDate,
            hsnCode: product.hsnCode,
            unit: product.unit,
            mrp: batch.mrp,
            purchasePrice: batch.purchasePrice,
            sellingPrice: item.sellingPrice || batch.sellingPrice,
            returnedQuantity: 0,
            ...itemWithGST
          });

          inventoryChanges.push({
            type: 'ADD',
            batch: batch._id,
            batchNo: batch.batchNo,
            product: product._id,
            productName: product.name,
            change: item.quantity
          });

        } else {
          // Automatic FIFO batch selection
          const batchesForSale = await getBatchesForSale(
            product._id,
            req.user._id,
            req.user.organizationId,
            item.quantity
          );

          for (const batchSale of batchesForSale) {
            const itemWithGST = calculateItemGST({
              quantity: batchSale.quantity,
              sellingPrice: item.sellingPrice || batchSale.sellingPrice,
              discount: item.discount || 0,
              gstRate: batchSale.gstRate
            }, taxType, 'invoice');

            processedItems.push({
              product: product._id,
              productName: product.name,
              batch: batchSale.batch,
              batchNo: batchSale.batchNo,
              expiryDate: batchSale.expiryDate,
              hsnCode: product.hsnCode,
              unit: product.unit,
              mrp: batchSale.mrp,
              purchasePrice: batchSale.purchasePrice,
              sellingPrice: item.sellingPrice || batchSale.sellingPrice,
              returnedQuantity: 0,
              ...itemWithGST
            });

            inventoryChanges.push({
              type: 'ADD',
              batch: batchSale.batch,
              batchNo: batchSale.batchNo,
              product: product._id,
              productName: product.name,
              change: batchSale.quantity
            });
          }
        }

      } else {
        // EXISTING ITEM - may have quantity/price changes
        const batch = await Batch.findById(oldItem.batch._id);
        if (!batch) {
          return res.status(400).json({ message: `Batch not found for ${product.name}` });
        }

        const returnedQty = oldItem.returnedQuantity || 0;
        const oldNetQuantity = oldItem.quantity - returnedQty;
        const quantityIncrease = item.quantity - oldNetQuantity;

        if (quantityIncrease > 0) {
          // Need more stock
          if (batch.quantity < quantityIncrease) {
            return res.status(400).json({
              message: `Insufficient stock for ${product.name}. Available: ${batch.quantity}, Need additional: ${quantityIncrease}`
            });
          }
        }

        // Calculate GST with new prices
        const itemWithGST = calculateItemGST({
          quantity: item.quantity,
          sellingPrice: item.sellingPrice !== undefined ? item.sellingPrice : oldItem.sellingPrice,
          discount: item.discount !== undefined ? item.discount : oldItem.discount,
          gstRate: batch.gstRate
        }, taxType, 'invoice');

        processedItems.push({
          product: product._id,
          productName: product.name,
          batch: batch._id,
          batchNo: batch.batchNo,
          expiryDate: batch.expiryDate,
          hsnCode: product.hsnCode,
          unit: product.unit,
          mrp: batch.mrp,
          purchasePrice: batch.purchasePrice,
          sellingPrice: item.sellingPrice !== undefined ? item.sellingPrice : oldItem.sellingPrice,
          returnedQuantity: returnedQty,
          ...itemWithGST
        });
      }
    }

    // Preserve other charges if not provided (default to 0 if undefined in old invoice)
    const deliveryCharges = invoiceData.deliveryCharges !== undefined ? invoiceData.deliveryCharges : (oldInvoice.deliveryCharges || 0);
    const packagingCharges = invoiceData.packagingCharges !== undefined ? invoiceData.packagingCharges : (oldInvoice.packagingCharges || 0);
    const otherCharges = invoiceData.otherCharges !== undefined ? invoiceData.otherCharges : (oldInvoice.otherCharges || 0);
    const discount = invoiceData.discount !== undefined ? invoiceData.discount : (oldInvoice.discount || 0);

    // Validate charges
    if (deliveryCharges < 0 || packagingCharges < 0 || otherCharges < 0 || discount < 0) {
      return res.status(400).json({ message: 'Charges and discount cannot be negative' });
    }

    // Calculate new totals
    const totals = calculateTotals(
      processedItems,
      { deliveryCharges, packagingCharges, otherCharges },
      discount
    );

    // Preserve paid amount, recalculate balance
    const paidAmount = invoiceData.paidAmount !== undefined ? invoiceData.paidAmount : oldInvoice.paidAmount;
    
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

    // Recalculate COGS (Cost of Goods Sold)
    const cogs = await calculateCOGS(processedItems);

    // ========================================
    // ALL VALIDATIONS PASSED - START TRANSACTION
    // ========================================

    session = await Invoice.startSession();
    session.startTransaction();

    // Apply inventory changes within transaction
    for (const change of inventoryChanges) {
      if (change.type === 'REMOVE' || change.type === 'DECREASE') {
        // Return stock to original batch
        await addBatchStock(change.batch, change.change, session);
      } else if (change.type === 'ADD' || change.type === 'INCREASE') {
        // Deduct stock from batch
        await deductBatchStock(change.batch, change.change, session);
      }
    }

    // Update customer balance if customer exists
    const customerChanged = (oldInvoice.customer?._id?.toString() !== customer?._id?.toString());
    
    if (customerChanged) {
      // Reverse old customer balance
      if (oldInvoice.customer) {
        const oldCustomer = await Customer.findById(oldInvoice.customer._id);
        if (oldCustomer) {
          oldCustomer.outstandingBalance -= oldInvoice.balanceAmount;
          await oldCustomer.save({ session });
        }
      }
      // Add new customer balance
      if (customer) {
        customer.outstandingBalance += balanceAmount;
        await customer.save({ session });
      }
    } else if (customer) {
      // Same customer - calculate net change
      const balanceChange = balanceAmount - oldInvoice.balanceAmount;
      customer.outstandingBalance += balanceChange;
      await customer.save({ session });
    }

    // Delete old ledger entries
    if (oldInvoice.ledgerEntries && oldInvoice.ledgerEntries.length > 0) {
      await Ledger.deleteMany({ _id: { $in: oldInvoice.ledgerEntries } }, { session });
    }

    // Save old values for audit trail BEFORE updating
    const auditData = {
      oldGrandTotal: oldInvoice.grandTotal,
      oldBalanceAmount: oldInvoice.balanceAmount,
      oldCustomer: oldInvoice.customerName,
      inventoryChanges
    };

    // Update invoice document
    Object.assign(oldInvoice, {
      ...customerData,
      invoiceDate: invoiceData.invoiceDate !== undefined ? invoiceData.invoiceDate : oldInvoice.invoiceDate,
      dueDate: invoiceData.dueDate !== undefined ? invoiceData.dueDate : oldInvoice.dueDate,
      deliveryCharges,
      packagingCharges,
      otherCharges,
      discount,
      paymentMethod: invoiceData.paymentMethod !== undefined ? invoiceData.paymentMethod : oldInvoice.paymentMethod,
      paymentTerms: invoiceData.paymentTerms !== undefined ? invoiceData.paymentTerms : oldInvoice.paymentTerms,
      notes: invoiceData.notes !== undefined ? invoiceData.notes : oldInvoice.notes,
      items: processedItems,
      taxType,
      subtotal: totals.subtotal,
      totalTax: totals.totalTax,
      totalCGST: totals.totalCGST,
      totalSGST: totals.totalSGST,
      totalIGST: totals.totalIGST,
      grandTotal: totals.grandTotal,
      roundOff: totals.roundOff,
      paymentStatus,
      paidAmount,
      balanceAmount,
      cogs
    });

    // Create new ledger entries
    const ledgerEntries = await postSalesToLedger(
      oldInvoice,
      req.user._id,
      req.organizationId || req.user.organizationId,
      session
    );
    oldInvoice.ledgerEntries = ledgerEntries.map(entry => entry._id);

    // Add audit trail
    if (!oldInvoice.editHistory) {
      oldInvoice.editHistory = [];
    }
    oldInvoice.editHistory.push({
      editedBy: req.user._id,
      editedAt: new Date(),
      changes: {
        ...auditData,
        newGrandTotal: totals.grandTotal,
        newBalanceAmount: balanceAmount,
        newCustomer: customerData.customerName
      }
    });

    await oldInvoice.save({ session });

    // Commit transaction
    await session.commitTransaction();

    res.json({
      success: true,
      invoice: oldInvoice,
      message: 'Invoice updated successfully',
      warnings: inventoryChanges
        .filter(c => (c.type === 'REMOVE' || c.type === 'DECREASE') && c.returnedQuantity > 0)
        .map(c => `Note: ${c.productName} had ${c.returnedQuantity} units returned`)
    });

  } catch (error) {
    if (session) {
      await session.abortTransaction();
    }
    console.error('Invoice edit error:', error);
    res.status(500).json({ message: error.message });
  } finally {
    if (session) {
      session.endSession();
    }
  }
});


// @route   PUT /api/invoices/:id/payment
// @desc    Update payment status
// @access  Private
router.put('/:id/payment', async (req, res) => {
  try {
    const { paymentStatus, paymentMethod, paidAmount, paymentDetails } = req.body;

    const invoice = await Invoice.findOne(addOrgFilter(req, { _id: req.params.id }));

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const oldBalance = invoice.balanceAmount;
    const newPaidAmount = invoice.paidAmount + (paidAmount || 0);
    const newBalance = invoice.grandTotal - newPaidAmount;

    invoice.paidAmount = newPaidAmount;
    invoice.balanceAmount = newBalance;
    invoice.paymentStatus = newBalance <= 0 ? 'PAID' : (newPaidAmount > 0 ? 'PARTIAL' : 'UNPAID');

    if (paymentMethod) invoice.paymentMethod = paymentMethod;
    if (paymentDetails) invoice.paymentDetails = paymentDetails;

    await invoice.save();

    // Update customer outstanding if customer exists
    if (invoice.customer) {
      const customer = await Customer.findById(invoice.customer);
      if (customer) {
        customer.outstandingBalance = customer.outstandingBalance - oldBalance + newBalance;
        await customer.save();
      }
    }

    res.json(invoice);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE /api/invoices/:id
// @desc    Delete invoice (return inventory, reverse balance, delete ledger)
// @access  Private
router.delete('/:id', async (req, res) => {
  let session = null;

  try {
    // Get invoice with all populated data
    const invoice = await Invoice.findOne(addOrgFilter(req, { _id: req.params.id }))
      .populate('customer')
      .populate('items.product')
      .populate('items.batch');

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Check if invoice has any returns - prevent deletion if fully/partially returned
    const hasReturns = invoice.items.some(item => (item.returnedQuantity || 0) > 0);
    if (hasReturns || invoice.isReturned || invoice.partiallyReturned) {
      return res.status(400).json({
        message: 'Cannot delete invoice with returns. Please delete the return entries first.'
      });
    }

    // Start transaction
    session = await Invoice.startSession();
    session.startTransaction();

    // Return inventory for all items
    for (const item of invoice.items) {
      if (item.batch && item.quantity > 0) {
        await addBatchStock(item.batch._id, item.quantity, session);
      }
    }

    // Reverse customer balance
    if (invoice.customer && invoice.balanceAmount > 0) {
      const customer = await Customer.findById(invoice.customer._id);
      if (customer) {
        customer.outstandingBalance -= invoice.balanceAmount;
        await customer.save({ session });
      }
    }

    // Delete ledger entries
    if (invoice.ledgerEntries && invoice.ledgerEntries.length > 0) {
      await Ledger.deleteMany({ _id: { $in: invoice.ledgerEntries } }, { session });
    }

    // Delete the invoice
    await Invoice.findByIdAndDelete(invoice._id, { session });

    // Commit transaction
    await session.commitTransaction();

    res.json({ message: 'Invoice deleted successfully' });

  } catch (error) {
    if (session) {
      await session.abortTransaction();
    }
    console.error('Invoice deletion error:', error);
    res.status(500).json({ message: error.message });
  } finally {
    if (session) {
      session.endSession();
    }
  }
});

export default router;
