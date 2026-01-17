import mongoose from 'mongoose';

const purchaseItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: String,
  batchNo: {
    type: String,
    required: false
  },
  expiryDate: {
    type: Date,
    required: false
  },
  manufacturingDate: {
    type: Date
  },
  hsnCode: String,
  quantity: {
    type: Number,
    required: false,
    default: 0
  },
  freeQuantity: {
    type: Number,
    default: 0
  },
  unit: String,
  mrp: {
    type: Number,
    required: false,
    default: 0
  },
  purchasePrice: {
    type: Number,
    required: false,
    default: 0
  },
  sellingPrice: {
    type: Number,
    required: false,
    default: 0
  },
  gstRate: {
    type: Number,
    required: false,
    default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  discountAmount: {
    type: Number,
    default: 0
  },
  taxableAmount: Number,
  cgst: Number,
  sgst: Number,
  igst: Number,
  totalAmount: Number,
  // Link to created batch
  batch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch'
  }
});

const purchaseSchema = new mongoose.Schema({
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
  purchaseNumber: {
    type: String
    // Unique constraint is on compound index (organizationId + purchaseNumber)
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  supplierName: String,
  supplierGstin: String,
  supplierInvoiceNo: {
    type: String
  },
  supplierInvoiceDate: {
    type: Date
  },
  purchaseDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  dueDate: {
    type: Date
  },
  items: [purchaseItemSchema],
  // Tax type based on supplier state
  taxType: {
    type: String,
    enum: ['CGST_SGST', 'IGST'],
    required: false,
    default: 'CGST_SGST'
  },
  subtotal: {
    type: Number,
    required: false,
    default: 0
  },
  totalTax: {
    type: Number,
    required: false,
    default: 0
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
  discount: {
    type: Number,
    default: 0
  },
  // Additional charges
  freight: {
    type: Number,
    default: 0
  },
  packaging: {
    type: Number,
    default: 0
  },
  otherCharges: {
    type: Number,
    default: 0
  },
  roundOff: {
    type: Number,
    default: 0
  },
  grandTotal: {
    type: Number,
    required: false,
    default: 0
  },
  paymentStatus: {
    type: String,
    enum: ['PAID', 'UNPAID', 'PARTIAL'],
    default: 'UNPAID'
  },
  paymentMethod: {
    type: String,
    enum: ['CASH', 'CHEQUE', 'BANK_TRANSFER', 'UPI', 'CREDIT'],
    default: 'CREDIT'
  },
  paidAmount: {
    type: Number,
    default: 0
  },
  balanceAmount: {
    type: Number,
    default: 0
  },
  // Multiple payment tracking
  payments: [{
    amount: {
      type: Number,
      required: true
    },
    paymentMethod: {
      type: String,
      enum: ['CASH', 'CHEQUE', 'BANK_TRANSFER', 'UPI', 'CREDIT_NOTE', 'OTHER'],
      required: true
    },
    paymentDate: {
      type: Date,
      default: Date.now,
      required: true
    },
    referenceNumber: String,
    notes: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    // Ledger entries for this payment (debit and credit)
    ledgerEntries: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ledger'
    }]
  }],
  paymentTerms: String,
  notes: String,
  // For returns
  isReturned: {
    type: Boolean,
    default: false
  },
  returnedAmount: {
    type: Number,
    default: 0
  },
  // For accounting
  ledgerEntries: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ledger'
  }],
  // Audit trail for edits
  editHistory: [{
    editedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    editedAt: {
      type: Date,
      default: Date.now
    },
    changes: mongoose.Schema.Types.Mixed
  }]
}, {
  timestamps: true
});

// Indexes for multi-tenant queries
purchaseSchema.index({ organizationId: 1, purchaseDate: -1 });
purchaseSchema.index({ organizationId: 1, purchaseNumber: 1 }, { unique: true }); // UNIQUE per organization
purchaseSchema.index({ organizationId: 1, supplier: 1 });
purchaseSchema.index({ organizationId: 1, paymentStatus: 1 });

// Auto-increment purchase number using atomic counter (per organization)
purchaseSchema.pre('save', async function (next) {
  if (this.isNew && !this.purchaseNumber) {
    const Counter = mongoose.model('Counter');

    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const yearMonth = `${year}${month}`;

    // Get next sequence number atomically - NO RACE CONDITION!
    const sequence = await Counter.getNextSequence(
      this.organizationId,
      'purchase',
      yearMonth
    );

    this.purchaseNumber = `PUR-${yearMonth}-${String(sequence).padStart(4, '0')}`;
  }
  next();
});

const Purchase = mongoose.model('Purchase', purchaseSchema);
export default Purchase;
