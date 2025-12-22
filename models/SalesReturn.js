import mongoose from 'mongoose';

const salesReturnItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: String,
  batch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch'
    // Optional for backwards compatibility with old invoices
  },
  batchNo: String,
  expiryDate: Date,
  hsnCode: String,
  quantity: {
    type: Number,
    required: true
  },
  unit: String,
  sellingPrice: {
    type: Number,
    required: true
  },
  gstRate: {
    type: Number,
    required: true
  },
  taxableAmount: Number,
  cgst: Number,
  sgst: Number,
  igst: Number,
  totalAmount: Number,
  // Check if item can be restocked
  canRestock: {
    type: Boolean,
    default: true
  },
  restocked: {
    type: Boolean,
    default: false
  }
});

const salesReturnSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  creditNoteNumber: {
    type: String
    // Unique constraint is on compound index (organizationId + creditNoteNumber)
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer'
  },
  customerName: {
    type: String,
    required: true
  },
  customerPhone: String,
  customerGstin: String,
  // Reference to original invoice
  originalInvoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    required: true
  },
  originalInvoiceNumber: String,
  returnDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  reason: {
    type: String,
    enum: ['DAMAGED', 'EXPIRED', 'WRONG_ITEM', 'NOT_NEEDED', 'SIDE_EFFECTS', 'OTHER'],
    required: true
  },
  reasonDescription: String,
  items: [salesReturnItemSchema],
  taxType: {
    type: String,
    enum: ['CGST_SGST', 'IGST'],
    required: true
  },
  subtotal: {
    type: Number,
    required: true
  },
  totalTax: {
    type: Number,
    required: true
  },
  totalCGST: {
    type: Number,
    default: 0
  },
  totalSGST: {
    type: Number,
    default: 0
  },
  totalIGST: {
    type: Number,
    default: 0
  },
  roundOff: {
    type: Number,
    default: 0
  },
  grandTotal: {
    type: Number,
    required: true
  },
  refundStatus: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'ADJUSTED'],
    default: 'PENDING'
  },
  refundMethod: {
    type: String,
    enum: ['CASH', 'UPI', 'BANK_TRANSFER', 'STORE_CREDIT']
  },
  refundedAmount: {
    type: Number,
    default: 0
  },
  notes: String,
  // For accounting
  ledgerEntries: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ledger'
  }]
}, {
  timestamps: true
});

// Indexes for multi-tenant queries
salesReturnSchema.index({ organizationId: 1, returnDate: -1 });
salesReturnSchema.index({ organizationId: 1, creditNoteNumber: 1 }, { unique: true }); // UNIQUE per organization
salesReturnSchema.index({ organizationId: 1, customer: 1 });

// Auto-increment credit note number using atomic counter (per organization)
salesReturnSchema.pre('save', async function (next) {
  if (this.isNew && !this.creditNoteNumber) {
    const Counter = mongoose.model('Counter');

    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const yearMonth = `${year}${month}`;

    // Get next sequence number atomically - NO RACE CONDITION!
    const sequence = await Counter.getNextSequence(
      this.organizationId,
      'salesReturn',
      yearMonth
    );

    this.creditNoteNumber = `CN-${yearMonth}-${String(sequence).padStart(4, '0')}`;
  }
  next();
});

const SalesReturn = mongoose.model('SalesReturn', salesReturnSchema);
export default SalesReturn;
