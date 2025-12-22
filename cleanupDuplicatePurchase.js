import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const deleteDuplicatePurchase = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Delete the duplicate purchase
        const result = await mongoose.connection.db.collection('purchases').deleteOne({
            purchaseNumber: 'PUR-202512-0001'
        });

        console.log(`Deleted ${result.deletedCount} purchase(s)`);

        // Also delete any associated batches if needed
        const batchResult = await mongoose.connection.db.collection('batches').deleteMany({
            purchaseInvoice: { $exists: false }
        });

        console.log(`Deleted ${batchResult.deletedCount} orphaned batch(es)`);

        console.log('\n✅ Cleanup complete! You can now create purchases.');

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

deleteDuplicatePurchase();
