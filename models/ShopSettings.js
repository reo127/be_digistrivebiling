import mongoose from 'mongoose';

const shopSettingsSchema = new mongoose.Schema({
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
  shopName: {
    type: String,
    required: true,
    trim: true
  },
  ownerName: {
    type: String,
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
    trim: true
  },
  pincode: {
    type: String,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    trim: true
  },
  gstin: {
    type: String,
    uppercase: true,
    trim: true
  },
  logo: {
    type: String
  },
  termsAndConditions: {
    type: String,
    trim: true
  },
  defaultTaxType: {
    type: String,
    enum: ['CGST_SGST', 'IGST'],
    default: 'CGST_SGST'
  },
  invoicePrefix: {
    type: String,
    default: 'INV'
  },
  invoiceStartNumber: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true
});

// One shop settings per organization
shopSettingsSchema.index({ organizationId: 1 }, { unique: true });

const ShopSettings = mongoose.model('ShopSettings', shopSettingsSchema);
export default ShopSettings;
