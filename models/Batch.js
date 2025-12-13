import mongoose from 'mongoose';

// Separate Batch model for FIFO inventory tracking
const batchSchema = new mongoose.Schema({
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
    required: true,
    trim: true
  },
  expiryDate: {
    type: Date,
    required: true
  },
  manufacturingDate: {
    type: Date
  },
  mrp: {
    type: Number,
    required: true
  },
  purchasePrice: {
    type: Number,
    required: true
  },
  sellingPrice: {
    type: Number,
    required: true
  },
  gstRate: {
    type: Number,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
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

// Compound index for efficient FIFO queries
batchSchema.index({ product: 1, expiryDate: 1, createdAt: 1 });
batchSchema.index({ userId: 1, isActive: 1 });

// Virtual for expiry status
batchSchema.virtual('isExpired').get(function() {
  return this.expiryDate < new Date();
});

// Virtual for near expiry (within 3 months)
batchSchema.virtual('isNearExpiry').get(function() {
  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);
  return this.expiryDate <= threeMonthsFromNow && this.expiryDate >= new Date();
});

const Batch = mongoose.model('Batch', batchSchema);
export default Batch;
