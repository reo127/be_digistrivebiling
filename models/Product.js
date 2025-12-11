import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
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
  genericName: {
    type: String,
    trim: true
  },
  manufacturer: {
    type: String,
    trim: true
  },
  composition: {
    type: String,
    trim: true
  },
  batchNo: {
    type: String,
    trim: true
  },
  expiryDate: {
    type: Date
  },
  hsnCode: {
    type: String,
    trim: true
  },
  gstRate: {
    type: Number,
    required: true,
    default: 12
  },
  mrp: {
    type: Number,
    required: true
  },
  sellingPrice: {
    type: Number,
    required: true
  },
  purchasePrice: {
    type: Number
  },
  stockQuantity: {
    type: Number,
    required: true,
    default: 0
  },
  minStockLevel: {
    type: Number,
    default: 10
  },
  unit: {
    type: String,
    enum: ['PCS', 'BOX', 'STRIP', 'BOTTLE', 'KG', 'LITRE'],
    default: 'PCS'
  },
  rack: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for search
productSchema.index({ name: 'text', genericName: 'text', manufacturer: 'text' });

const Product = mongoose.model('Product', productSchema);
export default Product;
