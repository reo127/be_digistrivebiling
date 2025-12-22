import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({
    organizationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
        index: true
    },
    type: {
        type: String,
        required: true,
        enum: ['invoice', 'purchase', 'salesReturn', 'purchaseReturn']
    },
    yearMonth: {
        type: String,
        required: true,
        // Format: YYYYMM (e.g., "202512")
    },
    sequence: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Compound unique index to ensure one counter per org/type/month
counterSchema.index({ organizationId: 1, type: 1, yearMonth: 1 }, { unique: true });

/**
 * Get next sequence number atomically
 * @param {ObjectId} organizationId - Organization ID
 * @param {String} type - Counter type (invoice, purchase, salesReturn, purchaseReturn)
 * @param {String} yearMonth - Year and month (YYYYMM)
 * @returns {Number} - Next sequence number
 */
counterSchema.statics.getNextSequence = async function (organizationId, type, yearMonth) {
    const counter = await this.findOneAndUpdate(
        { organizationId, type, yearMonth },
        { $inc: { sequence: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return counter.sequence;
};

const Counter = mongoose.model('Counter', counterSchema);
export default Counter;
