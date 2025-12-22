import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const cleanupDuplicatePurchase = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Delete the duplicate purchase PUR-202512-0002
        const result = await mongoose.connection.db.collection('purchases').deleteOne({
            purchaseNumber: 'PUR-202512-0002'
        });

        console.log(`Deleted ${result.deletedCount} purchase(s) with number PUR-202512-0002`);

        console.log('\n✅ Cleanup complete! You can now create purchases.');

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

cleanupDuplicatePurchase();
