import mongoose from 'mongoose';

// Separate Batch model for FIFO inventory tracking
const batchSchema = new mongoose.Schema({
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
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  batchNo: {
    type: String,
    required: false,
    trim: true
  },
  expiryDate: {
    type: Date,
    required: false
  },
  manufacturingDate: {
    type: Date
  },
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
  quantity: {
    type: Number,
    required: false,
    default: 0
  },
  // Reference to purchase invoice
  purchaseInvoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Purchase'
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier'
  },
  rack: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Track when batch becomes empty
  depletedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Compound index for efficient FIFO queries (multi-tenant)
batchSchema.index({ organizationId: 1, product: 1, expiryDate: 1, createdAt: 1 });
batchSchema.index({ organizationId: 1, isActive: 1 });
batchSchema.index({ product: 1, expiryDate: 1, createdAt: 1 });

// Virtual for expiry status
batchSchema.virtual('isExpired').get(function () {
  return this.expiryDate < new Date();
});

// Virtual for near expiry (within 3 months)
batchSchema.virtual('isNearExpiry').get(function () {
  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);
  return this.expiryDate <= threeMonthsFromNow && this.expiryDate >= new Date();
});

const Batch = mongoose.model('Batch', batchSchema);
export default Batch;
