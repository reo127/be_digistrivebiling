import mongoose from 'mongoose';

const invoiceItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: String,
  batchNo: String,
  expiryDate: Date,
  hsnCode: String,
  quantity: {
    type: Number,
    required: true
  },
  unit: String,
  mrp: Number,
  sellingPrice: {
    type: Number,
    required: true
  },
  gstRate: {
    type: Number,
    required: true
  },
  taxAmount: Number,
  cgst: Number,
  sgst: Number,
  igst: Number,
  totalAmount: Number
});

const invoiceSchema = new mongoose.Schema({
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
  customerGstin: String,
  items: [invoiceItemSchema],
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
  }
}, {
  timestamps: true
});

// Auto-increment invoice number
invoiceSchema.pre('save', async function(next) {
  if (this.isNew) {
    const lastInvoice = await this.constructor.findOne({ userId: this.userId })
      .sort({ createdAt: -1 });

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
