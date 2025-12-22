import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const cleanupDuplicateSalesReturn = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Delete the duplicate sales return
        const result = await mongoose.connection.db.collection('salesreturns').deleteOne({
            creditNoteNumber: 'CN-202512-0001'
        });

        console.log(`Deleted ${result.deletedCount} sales return(s)`);

        console.log('\n✅ Cleanup complete! You can now create sales returns.');

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

cleanupDuplicateSalesReturn();
