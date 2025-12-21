import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
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
  expenseNumber: {
    type: String,
    unique: true
  },
  date: {
    type: Date,
    default: Date.now,
    required: true
  },
  category: {
    type: String,
    enum: [
      'RENT',
      'SALARY',
      'ELECTRICITY',
      'WATER',
      'INTERNET',
      'TELEPHONE',
      'MAINTENANCE',
      'STATIONERY',
      'TRANSPORT',
      'FUEL',
      'INSURANCE',
      'LICENSE_FEES',
      'PROFESSIONAL_FEES',
      'BANK_CHARGES',
      'REPAIRS',
      'ADVERTISING',
      'MISCELLANEOUS'
    ],
    required: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  amount: {
    type: Number,
    required: true
  },
  // GST on expenses (if applicable)
  isGSTApplicable: {
    type: Boolean,
    default: false
  },
  gstRate: {
    type: Number,
    default: 0
  },
  gstAmount: {
    type: Number,
    default: 0
  },
  cgst: {
    type: Number,
    default: 0
  },
  sgst: {
    type: Number,
    default: 0
  },
  igst: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'UPI', 'CARD'],
    required: true
  },
  paidTo: {
    type: String,
    trim: true
  },
  referenceNumber: {
    type: String,
    trim: true
  },
  invoiceNumber: {
    type: String,
    trim: true
  },
  // For recurring expenses
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurringPeriod: {
    type: String,
    enum: ['MONTHLY', 'QUARTERLY', 'YEARLY']
  },
  notes: String,
  attachments: [{
    fileName: String,
    fileUrl: String,
    fileType: String
  }],
  // For accounting
  ledgerEntries: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ledger'
  }]
}, {
  timestamps: true
});

// Auto-increment expense number (per organization)
expenseSchema.pre('save', async function (next) {
  if (this.isNew && !this.expenseNumber) {
    const lastExpense = await this.constructor.findOne({
      organizationId: this.organizationId
    }).sort({ createdAt: -1 });

    let nextNumber = 1;
    if (lastExpense && lastExpense.expenseNumber) {
      const lastNumber = parseInt(lastExpense.expenseNumber.split('-').pop());
      nextNumber = lastNumber + 1;
    }

    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    this.expenseNumber = `EXP-${year}${month}-${String(nextNumber).padStart(4, '0')}`;
  }
  next();
});

// Indexes for multi-tenant reports
expenseSchema.index({ organizationId: 1, date: -1 });
expenseSchema.index({ organizationId: 1, category: 1 });

const Expense = mongoose.model('Expense', expenseSchema);
export default Expense;
