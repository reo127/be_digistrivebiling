import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const fixIndexes = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB Connected\n');

        const db = mongoose.connection.db;
        const collection = db.collection('invoices');

        // Get existing indexes
        const indexes = await collection.indexes();
        console.log('📋 Current indexes:');
        indexes.forEach(idx => {
            console.log(`  - ${idx.name}:`, idx.key);
        });

        // Drop the old invoiceNumber_1 index (unique without organizationId)
        console.log('\n🗑️  Dropping old invoiceNumber_1 index...');
        try {
            await collection.dropIndex('invoiceNumber_1');
            console.log('✅ Dropped invoiceNumber_1');
        } catch (err) {
            if (err.code === 27) {
                console.log('ℹ️  Index already dropped or doesn\'t exist');
            } else {
                throw err;
            }
        }

        // Create new compound unique index
        console.log('\n✨ Creating new compound unique index...');
        await collection.createIndex(
            { organizationId: 1, invoiceNumber: 1 },
            { unique: true, name: 'organizationId_1_invoiceNumber_1' }
        );
        console.log('✅ Created compound index: { organizationId: 1, invoiceNumber: 1 }');

        // Verify new indexes
        const newIndexes = await collection.indexes();
        console.log('\n✅ Updated indexes:');
        newIndexes.forEach(idx => {
            console.log(`  - ${idx.name}:`, idx.key);
        });

        console.log('\n🎉 Index fix complete!');
        console.log('ℹ️  Each organization can now have its own sequence of invoice numbers.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

fixIndexes();
