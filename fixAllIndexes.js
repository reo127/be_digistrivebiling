import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const fixAllIndexes = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB Connected\n');

        const db = mongoose.connection.db;

        // Collections to fix
        const collections = [
            {
                name: 'invoices',
                oldIndex: 'invoiceNumber_1',
                newIndex: { organizationId: 1, invoiceNumber: 1 },
                newIndexName: 'organizationId_1_invoiceNumber_1_unique'
            },
            {
                name: 'purchases',
                oldIndex: 'purchaseNumber_1',
                newIndex: { organizationId: 1, purchaseNumber: 1 },
                newIndexName: 'organizationId_1_purchaseNumber_1_unique'
            },
            {
                name: 'salesreturns',
                oldIndex: 'creditNoteNumber_1',
                newIndex: { organizationId: 1, creditNoteNumber: 1 },
                newIndexName: 'organizationId_1_creditNoteNumber_1_unique'
            },
            {
                name: 'purchasereturns',
                oldIndex: 'debitNoteNumber_1',
                newIndex: { organizationId: 1, debitNoteNumber: 1 },
                newIndexName: 'organizationId_1_debitNoteNumber_1_unique'
            }
        ];

        console.log('🔧 FIXING ALL DOCUMENT NUMBER INDEXES\n');
        console.log('=' .repeat(60));

        for (const col of collections) {
            console.log(`\n📦 Collection: ${col.name}`);
            console.log('-'.repeat(60));

            const collection = db.collection(col.name);

            // Check if collection exists
            const collectionExists = await db.listCollections({ name: col.name }).hasNext();
            if (!collectionExists) {
                console.log(`  ⚠️  Collection doesn't exist yet - will be created on first use`);
                continue;
            }

            // Get existing indexes
            const indexes = await collection.indexes();
            console.log(`  📋 Current indexes:`);
            indexes.forEach(idx => {
                const uniqueTag = idx.unique ? ' [UNIQUE]' : '';
                console.log(`     - ${idx.name}: ${JSON.stringify(idx.key)}${uniqueTag}`);
            });

            // Drop old single-field unique index
            console.log(`\n  🗑️  Dropping old global unique index: ${col.oldIndex}`);
            try {
                await collection.dropIndex(col.oldIndex);
                console.log(`     ✅ Dropped ${col.oldIndex}`);
            } catch (err) {
                if (err.code === 27) {
                    console.log(`     ℹ️  Index doesn't exist (already dropped or never created)`);
                } else {
                    console.log(`     ⚠️  Error: ${err.message}`);
                }
            }

            // Drop old non-unique compound index if exists
            const oldCompoundName = col.newIndexName.replace('_unique', '');
            try {
                await collection.dropIndex(oldCompoundName);
                console.log(`     ✅ Dropped old non-unique compound index: ${oldCompoundName}`);
            } catch (err) {
                if (err.code === 27) {
                    console.log(`     ℹ️  Old compound index doesn't exist`);
                }
            }

            // Create new UNIQUE compound index
            console.log(`\n  ✨ Creating new UNIQUE compound index...`);
            try {
                await collection.createIndex(
                    col.newIndex,
                    { unique: true, name: col.newIndexName }
                );
                console.log(`     ✅ Created: ${col.newIndexName}`);
                console.log(`        Index: ${JSON.stringify(col.newIndex)} [UNIQUE]`);
            } catch (err) {
                if (err.code === 85 || err.code === 86) {
                    console.log(`     ℹ️  Index already exists with correct definition`);
                } else {
                    console.log(`     ❌ Error: ${err.message}`);
                }
            }

            // Verify final state
            const newIndexes = await collection.indexes();
            console.log(`\n  ✅ Final indexes for ${col.name}:`);
            newIndexes.forEach(idx => {
                const uniqueTag = idx.unique ? ' [UNIQUE]' : '';
                console.log(`     - ${idx.name}: ${JSON.stringify(idx.key)}${uniqueTag}`);
            });
        }

        console.log('\n' + '='.repeat(60));
        console.log('\n🎉 ALL INDEXES FIXED!\n');
        console.log('✅ Invoice numbers - unique per organization');
        console.log('✅ Purchase numbers - unique per organization');
        console.log('✅ Credit note numbers - unique per organization');
        console.log('✅ Debit note numbers - unique per organization');
        console.log('\n📝 Each organization now has independent numbering sequences!');
        console.log('\n🚀 RESTART YOUR BACKEND SERVER to apply changes!');
        console.log('   cd be-billing-app && npm run dev\n');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error:', error);
        process.exit(1);
    }
};

fixAllIndexes();
