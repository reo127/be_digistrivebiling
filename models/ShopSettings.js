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
    required: true
  },
  city: {
    type: String,
    required: true
  },
  state: {
    type: String,
    required: true
  },
  pincode: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true
  },
  email: {
    type: String
  },
  gstin: {
    type: String,
    required: true,
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
