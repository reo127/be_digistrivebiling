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
    required: true
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
// Auto-increment credit note number using atomic counter (per organization)
// Format: CN-YYYY-OO-XXXX (OO = first 2 chars of org name, continuous sequence)
salesReturnSchema.pre('save', async function (next) {
  if (this.isNew && !this.creditNoteNumber) {
    const Counter = mongoose.model('Counter');
    const Organization = mongoose.model('Organization');

    // Get organization details
    const org = await Organization.findById(this.organizationId).select('organizationName');
    if (!org) {
      throw new Error('Organization not found');
    }

    // Extract first 2 characters of organization name (uppercase)
    const orgInitials = org.organizationName
      .trim()
      .substring(0, 2)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '') || 'XX'; // Fallback to 'XX' if no valid chars

    const date = this.returnDate || new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');

    // Get next sequence number atomically - continuous, never resets
    const sequence = await Counter.getNextSequence(
      this.organizationId,
      'salesReturn',
      String(year) // Use year only for continuous numbering
    );

    // Format: CN-2026-01-RA-0001 (for "Ramesh Medicals" in January)
    this.creditNoteNumber = `CN-${year}-${month}-${orgInitials}-${String(sequence).padStart(4, '0')}`;
  }
  next();
});

const SalesReturn = mongoose.model('SalesReturn', salesReturnSchema);
export default SalesReturn;
