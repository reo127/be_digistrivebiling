import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  contactPerson: {
    type: String,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  gstin: {
    type: String,
    uppercase: true,
    trim: true,
    required: true
  },
  pan: {
    type: String,
    uppercase: true,
    trim: true
  },
  address: {
    type: String,
    trim: true
  },
  city: {
    type: String,
    trim: true
  },
  state: {
    type: String,
    trim: true,
    required: true
  },
  pincode: {
    type: String,
    trim: true
  },
  drugLicenseNo: {
    type: String,
    trim: true
  },
  bankDetails: {
    bankName: String,
    accountNumber: String,
    ifscCode: String,
    branch: String
  },
  paymentTerms: {
    type: String,
    enum: ['IMMEDIATE', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'CUSTOM'],
    default: 'NET_30'
  },
  creditDays: {
    type: Number,
    default: 30
  },
  creditLimit: {
    type: Number,
    default: 0
  },
  openingBalance: {
    type: Number,
    default: 0
  },
  currentBalance: {
    type: Number,
    default: 0
  },
  totalPurchases: {
    type: Number,
    default: 0
  },
  totalReturns: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  notes: {
    type: String
  }
}, {
  timestamps: true
});

// Index for search
supplierSchema.index({ name: 'text', gstin: 'text', phone: 'text' });

const Supplier = mongoose.model('Supplier', supplierSchema);
export default Supplier;
