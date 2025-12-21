import mongoose from 'mongoose';

// Double-entry accounting ledger
const ledgerSchema = new mongoose.Schema({
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
  date: {
    type: Date,
    default: Date.now,
    required: true
  },
  // Account heads for double entry
  account: {
    type: String,
    enum: [
      // Assets
      'CASH',
      'BANK',
      'ACCOUNTS_RECEIVABLE',
      'INVENTORY',
      'FURNITURE_FIXTURES',
      'EQUIPMENT',
      // Liabilities
      'ACCOUNTS_PAYABLE',
      'GST_PAYABLE_CGST',
      'GST_PAYABLE_SGST',
      'GST_PAYABLE_IGST',
      'LOANS_PAYABLE',
      'OTHER_LIABILITIES',
      // Capital
      'CAPITAL',
      'DRAWINGS',
      'RETAINED_EARNINGS',
      // Revenue
      'SALES',
      'OTHER_INCOME',
      // Expenses
      'PURCHASES',
      'COST_OF_GOODS_SOLD',
      'RENT_EXPENSE',
      'SALARY_EXPENSE',
      'ELECTRICITY_EXPENSE',
      'WATER_EXPENSE',
      'INTERNET_EXPENSE',
      'TELEPHONE_EXPENSE',
      'MAINTENANCE_EXPENSE',
      'STATIONERY_EXPENSE',
      'TRANSPORT_EXPENSE',
      'FUEL_EXPENSE',
      'INSURANCE_EXPENSE',
      'LICENSE_FEES_EXPENSE',
      'PROFESSIONAL_FEES_EXPENSE',
      'BANK_CHARGES',
      'REPAIRS_EXPENSE',
      'ADVERTISING_EXPENSE',
      'MISCELLANEOUS_EXPENSE',
      // GST Input Tax Credit
      'GST_INPUT_CGST',
      'GST_INPUT_SGST',
      'GST_INPUT_IGST',
      // Sales/Purchase Returns
      'SALES_RETURN',
      'PURCHASE_RETURN'
    ],
    required: true
  },
  // Debit or Credit entry
  type: {
    type: String,
    enum: ['DEBIT', 'CREDIT'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  // Reference to source transaction
  referenceType: {
    type: String,
    enum: ['INVOICE', 'PURCHASE', 'EXPENSE', 'PAYMENT', 'SALES_RETURN', 'PURCHASE_RETURN', 'OPENING_BALANCE', 'ADJUSTMENT'],
    required: true
  },
  referenceId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'referenceModel'
  },
  referenceModel: {
    type: String,
    enum: ['Invoice', 'Purchase', 'Expense', 'Payment', 'SalesReturn', 'PurchaseReturn']
  },
  referenceNumber: String,
  // Party details
  party: {
    type: String,
    enum: ['CUSTOMER', 'SUPPLIER', 'SELF', 'OTHER']
  },
  partyId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'partyModel'
  },
  partyModel: {
    type: String,
    enum: ['Customer', 'Supplier']
  },
  partyName: String,
  description: {
    type: String,
    required: true
  },
  // Financial year for grouping
  financialYear: {
    type: String,
    required: true
  },
  notes: String
}, {
  timestamps: true
});

// Indexes for efficient queries (multi-tenant)
ledgerSchema.index({ organizationId: 1, date: -1 });
ledgerSchema.index({ organizationId: 1, account: 1, date: -1 });
ledgerSchema.index({ organizationId: 1, financialYear: 1 });
ledgerSchema.index({ referenceType: 1, referenceId: 1 });

// Static method to create double entry (multi-tenant)
ledgerSchema.statics.createDoubleEntry = async function (organizationId, userId, entries, options = {}) {
  const { referenceType, referenceId, referenceModel, referenceNumber, description, date, financialYear } = options;

  const ledgerEntries = entries.map(entry => ({
    organizationId,
    userId,
    date: date || new Date(),
    account: entry.account,
    type: entry.type,
    amount: entry.amount,
    referenceType,
    referenceId,
    referenceModel,
    referenceNumber,
    party: entry.party,
    partyId: entry.partyId,
    partyModel: entry.partyModel,
    partyName: entry.partyName,
    description: entry.description || description,
    financialYear: financialYear || getCurrentFinancialYear(),
    notes: entry.notes
  }));

  return await this.insertMany(ledgerEntries);
};

// Helper function to get current financial year
function getCurrentFinancialYear() {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  // Financial year in India: April to March
  if (currentMonth >= 4) {
    return `${currentYear}-${currentYear + 1}`;
  } else {
    return `${currentYear - 1}-${currentYear}`;
  }
}

const Ledger = mongoose.model('Ledger', ledgerSchema);
export default Ledger;
