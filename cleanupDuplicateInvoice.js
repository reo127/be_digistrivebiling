import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const cleanupDuplicateInvoice = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Delete the duplicate invoice INV-202512-0002
        const result = await mongoose.connection.db.collection('invoices').deleteOne({
            invoiceNumber: 'INV-202512-0002'
        });

        console.log(`Deleted ${result.deletedCount} invoice(s) with number INV-202512-0002`);

        console.log('\n✅ Cleanup complete! You can now create invoices.');

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

cleanupDuplicateInvoice();
