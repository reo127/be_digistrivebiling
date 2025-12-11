import mongoose from 'mongoose';

const shopSettingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
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
  drugLicense: {
    type: String,
    trim: true
  },
  logo: {
    type: String
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

const ShopSettings = mongoose.model('ShopSettings', shopSettingsSchema);
export default ShopSettings;
