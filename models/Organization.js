import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema({
    // Basic Information
    organizationName: {
        type: String,
        required: true,
        trim: true
    },
    displayName: {
        type: String,
        trim: true
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    phone: {
        type: String,
        trim: true
    },

    // Business Details
    gstin: {
        type: String,
        trim: true
    },
    pan: {
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
    country: {
        type: String,
        default: 'India'
    },

    // Subscription Management
    subscriptionStatus: {
        type: String,
        enum: ['demo', 'trial', 'active', 'suspended', 'cancelled'],
        default: 'trial'
    },
    subscriptionPlan: {
        type: String,
        enum: ['demo', 'basic', 'standard', 'premium'],
        default: 'basic'
    },
    subscriptionStartDate: {
        type: Date,
        default: Date.now
    },
    subscriptionEndDate: {
        type: Date
    },
    trialEndsAt: {
        type: Date
    },

    // Billing
    billingCycle: {
        type: String,
        enum: ['monthly', 'yearly'],
        default: 'monthly'
    },
    lastBillingDate: {
        type: Date
    },
    nextBillingDate: {
        type: Date
    },

    // Shop Settings (migrated from ShopSettings)
    shopName: {
        type: String,
        trim: true
    },
    shopAddress: {
        type: String,
        trim: true
    },
    shopCity: {
        type: String,
        trim: true
    },
    shopState: {
        type: String,
        trim: true
    },
    shopPincode: {
        type: String,
        trim: true
    },
    shopPhone: {
        type: String,
        trim: true
    },
    shopEmail: {
        type: String,
        trim: true
    },
    shopGstin: {
        type: String,
        trim: true
    },
    shopLogo: {
        type: String
    },

    // Limits & Features
    maxUsers: {
        type: Number,
        default: 5
    },
    maxInvoicesPerMonth: {
        type: Number,
        default: 1000
    },
    features: {
        inventory: {
            type: Boolean,
            default: true
        },
        reports: {
            type: Boolean,
            default: true
        },
        multiUser: {
            type: Boolean,
            default: true
        },
        api: {
            type: Boolean,
            default: false
        },
        customBranding: {
            type: Boolean,
            default: false
        }
    },

    // Demo Account Settings
    isDemo: {
        type: Boolean,
        default: false
    },
    demoExpiresAt: {
        type: Date
    },

    // Metadata
    isActive: {
        type: Boolean,
        default: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    notes: {
        type: String
    }
}, {
    timestamps: true
});

// Indexes for performance
organizationSchema.index({ organizationName: 1 });
organizationSchema.index({ email: 1 });
organizationSchema.index({ subscriptionStatus: 1 });
organizationSchema.index({ isActive: 1 });
organizationSchema.index({ createdAt: -1 });

// Set trial end date before saving
organizationSchema.pre('save', function (next) {
    if (this.isNew && this.subscriptionStatus === 'trial' && !this.trialEndsAt) {
        // 30 days trial period
        this.trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    if (this.isNew && this.isDemo && !this.demoExpiresAt) {
        // 7 days demo period
        this.demoExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }

    next();
});

// Method to check if subscription is active
organizationSchema.methods.isSubscriptionActive = function () {
    if (this.subscriptionStatus === 'active') return true;
    if (this.subscriptionStatus === 'trial' && this.trialEndsAt > new Date()) return true;
    if (this.subscriptionStatus === 'demo' && this.demoExpiresAt > new Date()) return true;
    return false;
};

// Method to check if organization can create more users
organizationSchema.methods.canAddMoreUsers = async function () {
    const User = mongoose.model('User');
    const userCount = await User.countDocuments({ organizationId: this._id });
    return userCount < this.maxUsers;
};

const Organization = mongoose.model('Organization', organizationSchema);
export default Organization;
