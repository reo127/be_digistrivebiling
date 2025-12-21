import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
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
  paymentNumber: {
    type: String,
    unique: true
  },
  date: {
    type: Date,
    default: Date.now,
    required: true
  },
  // Payment type
  type: {
    type: String,
    enum: ['RECEIVED', 'PAID'],
    required: true
  },
  // Party details
  partyType: {
    type: String,
    enum: ['CUSTOMER', 'SUPPLIER'],
    required: true
  },
  party: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'partyModel',
    required: true
  },
  partyModel: {
    type: String,
    enum: ['Customer', 'Supplier'],
    required: true
  },
  partyName: String,
  amount: {
    type: Number,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['CASH', 'CHEQUE', 'BANK_TRANSFER', 'UPI', 'CARD'],
    required: true
  },
  // Payment method details
  transactionId: String,
  chequeNumber: String,
  chequeDate: Date,
  bankName: String,
  upiId: String,
  cardLastFour: String,
  // Reference to invoice/purchase
  referenceType: {
    type: String,
    enum: ['INVOICE', 'PURCHASE', 'ADVANCE', 'ON_ACCOUNT']
  },
  referenceId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'referenceModel'
  },
  referenceModel: {
    type: String,
    enum: ['Invoice', 'Purchase']
  },
  referenceNumber: String,
  notes: String,
  // For accounting
  ledgerEntries: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ledger'
  }]
}, {
  timestamps: true
});

// Auto-increment payment number (per organization)
paymentSchema.pre('save', async function (next) {
  if (this.isNew && !this.paymentNumber) {
    const prefix = this.type === 'RECEIVED' ? 'RCPT' : 'PAY';
    const lastPayment = await this.constructor.findOne({
      organizationId: this.organizationId,
      type: this.type
    }).sort({ createdAt: -1 });

    let nextNumber = 1;
    if (lastPayment && lastPayment.paymentNumber) {
      const lastNumber = parseInt(lastPayment.paymentNumber.split('-').pop());
      nextNumber = lastNumber + 1;
    }

    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    this.paymentNumber = `${prefix}-${year}${month}-${String(nextNumber).padStart(4, '0')}`;
  }
  next();
});

// Indexes for multi-tenant queries
paymentSchema.index({ organizationId: 1, date: -1 });
paymentSchema.index({ organizationId: 1, partyType: 1, party: 1 });

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
