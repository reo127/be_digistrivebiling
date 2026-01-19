import mongoose from 'mongoose';

const purchaseReturnItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: String,
  batch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch'
    // Optional for backwards compatibility
  },
  batchNo: String,
  expiryDate: Date,
  hsnCode: String,
  quantity: {
    type: Number,
    required: true
  },
  unit: String,
  purchasePrice: {
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
  totalAmount: Number
});

const purchaseReturnSchema = new mongoose.Schema({
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
  debitNoteNumber: {
    type: String
    // Unique constraint is on compound index (organizationId + debitNoteNumber)
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  supplierName: String,
  supplierGstin: String,
  // Reference to original purchase
  originalPurchase: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Purchase',
    required: true
  },
  originalPurchaseNumber: String,
  returnDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  reason: {
    type: String,
    enum: ['DAMAGED', 'EXPIRED', 'WRONG_ITEM', 'QUALITY_ISSUE', 'EXCESS_STOCK', 'OTHER'],
    required: true
  },
  reasonDescription: String,
  items: [purchaseReturnItemSchema],
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
  adjustmentStatus: {
    type: String,
    enum: ['PENDING', 'ADJUSTED', 'REFUNDED'],
    default: 'PENDING'
  },
  adjustmentMethod: {
    type: String,
    enum: ['CREDIT_NOTE', 'CASH_REFUND', 'BANK_TRANSFER', 'ADJUST_NEXT_BILL']
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
purchaseReturnSchema.index({ organizationId: 1, returnDate: -1 });
purchaseReturnSchema.index({ organizationId: 1, debitNoteNumber: 1 }, { unique: true }); // UNIQUE per organization
purchaseReturnSchema.index({ organizationId: 1, supplier: 1 });

// Auto-increment debit note number (per organization)
// Auto-increment debit note number using atomic counter (per organization)
// Format: DN-YYYY-OO-XXXX (OO = first 2 chars of org name, continuous sequence)
purchaseReturnSchema.pre('save', async function (next) {
  if (this.isNew && !this.debitNoteNumber) {
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
      'purchaseReturn',
      String(year) // Use year only for continuous numbering
    );

    // Format: DN-2026-01-RA-0001 (for "Ramesh Medicals" in January)
    this.debitNoteNumber = `DN-${year}-${month}-${orgInitials}-${String(sequence).padStart(4, '0')}`;
  }
  next();
});

const PurchaseReturn = mongoose.model('PurchaseReturn', purchaseReturnSchema);
export default PurchaseReturn;
