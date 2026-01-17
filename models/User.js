import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  // Organization Link (Multi-tenant)
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: function () {
      // Not required for superadmin
      return this.role !== 'superadmin';
    }
  },

  // Basic Information
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['superadmin', 'owner', 'staff'],
    default: 'owner'
  },

  // Permissions (for staff users)
  permissions: {
    canCreateInvoice: {
      type: Boolean,
      default: true
    },
    canEditInvoice: {
      type: Boolean,
      default: true
    },
    canDeleteInvoice: {
      type: Boolean,
      default: false
    },
    canViewReports: {
      type: Boolean,
      default: true
    },
    canManageInventory: {
      type: Boolean,
      default: true
    },
    canManageProducts: {
      type: Boolean,
      default: true
    },
    canManageCustomers: {
      type: Boolean,
      default: true
    },
    canManageSuppliers: {
      type: Boolean,
      default: true
    },
    canManagePurchases: {
      type: Boolean,
      default: true
    },
    canManageExpenses: {
      type: Boolean,
      default: false
    },
    canManageUsers: {
      type: Boolean,
      default: false
    },
    canManageSettings: {
      type: Boolean,
      default: false
    }
  },

  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for performance
userSchema.index({ organizationId: 1, email: 1 });
userSchema.index({ organizationId: 1, role: 1 });
userSchema.index({ email: 1 });
userSchema.index({ isActive: 1 });

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare passwords
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);
export default User;
