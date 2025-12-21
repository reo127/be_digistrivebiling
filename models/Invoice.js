import mongoose from 'mongoose';

const invoiceItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: String,
  // Batch tracking for FIFO (optional for backwards compatibility)
  batch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch'
  },
  batchNo: String,
  expiryDate: Date,
  hsnCode: String,
  quantity: {
    type: Number,
    required: true
  },
  unit: String,
  mrp: Number,
  purchasePrice: Number, // For COGS calculation
  sellingPrice: {
    type: Number,
    required: true
  },
  discount: {
    type: Number,
    default: 0
  },
  discountAmount: {
    type: Number,
    default: 0
  },
  gstRate: {
    type: Number,
    required: true
  },
  taxableAmount: Number,
  taxAmount: Number,
  cgst: Number,
  sgst: Number,
  igst: Number,
  totalAmount: Number,
  // Track if returned
  returnedQuantity: {
    type: Number,
    default: 0
  }
});

const invoiceSchema = new mongoose.Schema({
  // Multi-tenant Organization Link
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
  invoiceNumber: {
    type: String,
    unique: true
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
  customerAddress: String,
  customerCity: String,
  customerState: String,
  customerGstin: String,
  items: [invoiceItemSchema],
  // Prescription tracking for Schedule H/H1/X drugs
  prescriptionRequired: {
    type: Boolean,
    default: false
  },
  prescriptionNumber: String,
  doctorName: String,
  prescriptionDate: Date,
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
  totalCGST: Number,
  totalSGST: Number,
  totalIGST: Number,
  discount: {
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
  paymentStatus: {
    type: String,
    enum: ['PAID', 'UNPAID', 'PARTIAL'],
    default: 'UNPAID'
  },
  paymentMethod: {
    type: String,
    enum: ['CASH', 'UPI', 'CARD', 'CHEQUE', 'BANK_TRANSFER', 'SPLIT'],
    default: 'CASH'
  },
  paidAmount: {
    type: Number,
    default: 0
  },
  balanceAmount: {
    type: Number,
    default: 0
  },
  paymentDetails: {
    type: String
  },
  notes: {
    type: String
  },
  invoiceDate: {
    type: Date,
    default: Date.now
  },
  // For returns tracking
  isReturned: {
    type: Boolean,
    default: false
  },
  partiallyReturned: {
    type: Boolean,
    default: false
  },
  returnedAmount: {
    type: Number,
    default: 0
  },
  // E-way bill (for inter-state sales > 50000)
  eWayBillRequired: {
    type: Boolean,
    default: false
  },
  eWayBillNumber: String,
  eWayBillDate: Date,
  transporterName: String,
  vehicleNumber: String,
  distance: Number,
  // For accounting - double entry ledger references
  ledgerEntries: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ledger'
  }],
  // Cost of goods sold (for P&L)
  cogs: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes for multi-tenant performance
invoiceSchema.index({ organizationId: 1, invoiceDate: -1 });
invoiceSchema.index({ organizationId: 1, invoiceNumber: 1 });
invoiceSchema.index({ organizationId: 1, customer: 1 });
invoiceSchema.index({ organizationId: 1, paymentStatus: 1 });

// Auto-increment invoice number (per organization)
invoiceSchema.pre('save', async function (next) {
  if (this.isNew) {
    // Find last invoice for this organization
    const lastInvoice = await this.constructor.findOne({
      organizationId: this.organizationId
    }).sort({ createdAt: -1 });

    let nextNumber = 1;
    if (lastInvoice && lastInvoice.invoiceNumber) {
      const lastNumber = parseInt(lastInvoice.invoiceNumber.split('-').pop());
      nextNumber = lastNumber + 1;
    }

    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    this.invoiceNumber = `INV-${year}${month}-${String(nextNumber).padStart(4, '0')}`;
  }
  next();
});

const Invoice = mongoose.model('Invoice', invoiceSchema);
export default Invoice;
