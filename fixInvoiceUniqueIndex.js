import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from './models/Invoice.js';

dotenv.config();

/**
 * Fix Invoice Unique Index
 * Ensures the unique constraint on (organizationId + invoiceNumber) exists
 */

const fixInvoiceUniqueIndex = async () => {
  try {
    console.log('🔧 FIXING INVOICE UNIQUE INDEX\n');
    console.log('═'.repeat(70));

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('📋 Current indexes:');
    const indexes = await Invoice.collection.getIndexes();
    Object.keys(indexes).forEach(indexName => {
      const indexDef = indexes[indexName];
      const isUnique = indexDef.unique ? '(UNIQUE)' : '';
      console.log(`   - ${indexName} ${isUnique}`);
    });

    console.log('\n🔍 Checking for unique constraint...');
    const uniqueIndexExists = Object.values(indexes).some(idx =>
      idx.organizationId === 1 && idx.invoiceNumber === 1 && idx.unique === true
    );

    if (uniqueIndexExists) {
      console.log('✅ Unique constraint already exists!\n');
    } else {
      console.log('⚠️  Unique constraint missing. Creating it now...\n');

      // Drop the non-unique index first
      try {
        await Invoice.collection.dropIndex('organizationId_1_invoiceNumber_1');
        console.log('✓ Dropped old non-unique index');
      } catch (error) {
        console.log('ℹ️  Old index doesn\'t exist or already dropped');
      }

      // Create the unique index
      await Invoice.collection.createIndex(
        { organizationId: 1, invoiceNumber: 1 },
        { unique: true, background: true }
      );
      console.log('✅ Created unique constraint: (organizationId + invoiceNumber)\n');
    }

    // Verify the fix
    console.log('🔍 Verifying fix...');
    const newIndexes = await Invoice.collection.getIndexes();

    // Check all indexes for unique constraint
    let foundUniqueIndex = false;
    for (const [indexName, indexDef] of Object.entries(newIndexes)) {
      if (Array.isArray(indexDef)) {
        const hasOrgId = indexDef.some(field => field[0] === 'organizationId');
        const hasInvNum = indexDef.some(field => field[0] === 'invoiceNumber');
        if (hasOrgId && hasInvNum) {
          // Check if this index is unique
          const indexInfo = await Invoice.collection.indexInformation();
          if (indexInfo[indexName] && indexInfo[indexName].unique) {
            foundUniqueIndex = true;
            console.log(`✅ Found unique index: ${indexName}`);
            break;
          }
        }
      }
    }

    console.log('✅ Unique constraint verified!\n');
    console.log('═'.repeat(70));
    console.log('✅ SUCCESS! Invoice unique constraint is now enforced.');
    console.log('✅ This prevents duplicate invoice numbers per organization.');

  } catch (error) {
    console.error('\n❌ Fix failed:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run fix
fixInvoiceUniqueIndex();
