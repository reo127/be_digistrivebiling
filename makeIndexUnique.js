import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const makeIndexUnique = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB Connected\n');

        const db = mongoose.connection.db;
        const collection = db.collection('invoices');

        // Drop the existing non-unique compound index
        console.log('🗑️  Dropping non-unique compound index...');
        try {
            await collection.dropIndex('organizationId_1_invoiceNumber_1');
            console.log('✅ Dropped organizationId_1_invoiceNumber_1');
        } catch (err) {
            if (err.code === 27) {
                console.log('ℹ️  Index doesn\'t exist');
            } else {
                throw err;
            }
        }

        // Create UNIQUE compound index
        console.log('\n✨ Creating UNIQUE compound index...');
        await collection.createIndex(
            { organizationId: 1, invoiceNumber: 1 },
            {
                unique: true,
                name: 'organizationId_1_invoiceNumber_1_unique'
            }
        );
        console.log('✅ Created UNIQUE compound index');

        // Verify indexes
        const indexes = await collection.indexes();
        console.log('\n📋 Final indexes:');
        indexes.forEach(idx => {
            const uniqueTag = idx.unique ? ' [UNIQUE]' : '';
            console.log(`  - ${idx.name}:`, idx.key, uniqueTag);
        });

        console.log('\n🎉 SUCCESS!');
        console.log('✅ Invoice numbers are now unique PER ORGANIZATION');
        console.log('ℹ️  Different organizations can have the same invoice number');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

makeIndexUnique();
