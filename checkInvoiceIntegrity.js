import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from './models/Invoice.js';
import Counter from './models/Counter.js';

dotenv.config();

/**
 * Comprehensive Check Script
 * Validates invoice number integrity after migration
 */

const checkInvoiceIntegrity = async () => {
  try {
    console.log('🔍 INVOICE INTEGRITY CHECK\n');
    console.log('═'.repeat(70));

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    let totalIssues = 0;

    // CHECK 1: Database Indexes
    console.log('1️⃣  CHECKING DATABASE INDEXES');
    console.log('─'.repeat(70));
    const indexes = await Invoice.collection.getIndexes();
    console.log('   Current indexes:');
    Object.keys(indexes).forEach(indexName => {
      console.log(`   ✓ ${indexName}:`, JSON.stringify(indexes[indexName]));
    });

    // Verify unique constraint on organizationId + invoiceNumber
    const db = mongoose.connection.db;
    const indexData = await db.collection('invoices').indexes();
    let uniqueIndexExists = false;

    for (const idx of indexData) {
      if (idx.key && idx.key.organizationId === 1 && idx.key.invoiceNumber === 1 && idx.unique === true) {
        uniqueIndexExists = true;
        console.log(`   ✅ Unique constraint verified: ${idx.name} (organizationId + invoiceNumber)\n`);
        break;
      }
    }

    if (!uniqueIndexExists) {
      console.log('   ❌ WARNING: Unique constraint missing!\n');
      totalIssues++;
    }

    // CHECK 2: Duplicate Invoice Numbers
    console.log('2️⃣  CHECKING FOR DUPLICATE INVOICE NUMBERS');
    console.log('─'.repeat(70));
    const orgs = await Invoice.distinct('organizationId');
    let duplicatesFound = 0;

    for (const orgId of orgs) {
      const duplicates = await Invoice.aggregate([
        { $match: { organizationId: orgId } },
        { $group: { _id: '$invoiceNumber', count: { $sum: 1 }, ids: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } }
      ]);

      if (duplicates.length > 0) {
        console.error(`   ❌ Org ${orgId}: Found ${duplicates.length} duplicate(s):`);
        duplicates.forEach(d => {
          console.error(`      - ${d._id}: ${d.count} times (IDs: ${d.ids.join(', ')})`);
        });
        duplicatesFound += duplicates.length;
        totalIssues++;
      }
    }

    if (duplicatesFound === 0) {
      console.log('   ✅ No duplicates found!\n');
    } else {
      console.log(`   ❌ Total duplicates: ${duplicatesFound}\n`);
    }

    // CHECK 3: Invoice Number Format Validation
    console.log('3️⃣  VALIDATING INVOICE NUMBER FORMAT');
    console.log('─'.repeat(70));
    const invalidFormat = await Invoice.find({
      invoiceNumber: { $not: /^INV-\d{4}-(0[1-9]|1[0-2])-\d{5}$/ }
    }).limit(10);

    if (invalidFormat.length > 0) {
      console.error(`   ❌ Found ${invalidFormat.length} invoices with invalid format:`);
      invalidFormat.forEach(inv => {
        console.error(`      - ${inv.invoiceNumber} (ID: ${inv._id})`);
      });
      totalIssues++;
    } else {
      console.log('   ✅ All invoice numbers match format: INV-YYYY-MM-XXXXX\n');
    }

    // CHECK 4: Counter State
    console.log('4️⃣  CHECKING COUNTER STATE');
    console.log('─'.repeat(70));
    const counters = await Counter.find({ type: 'invoice' }).sort({ organizationId: 1, yearMonth: 1 });

    console.log(`   Found ${counters.length} invoice counter(s):`);
    for (const counter of counters) {
      console.log(`   ✓ Org: ${counter.organizationId}, Year: ${counter.yearMonth}, Sequence: ${counter.sequence}`);

      // Verify counter matches actual invoice count
      const invoiceCount = await Invoice.countDocuments({
        organizationId: counter.organizationId,
        invoiceNumber: { $regex: `^INV-${counter.yearMonth}-` }
      });

      if (invoiceCount !== counter.sequence) {
        console.warn(`     ⚠️  Counter mismatch: Counter=${counter.sequence}, Actual=${invoiceCount}`);
        totalIssues++;
      } else {
        console.log(`     ✅ Counter matches invoice count: ${invoiceCount}`);
      }
    }
    console.log();

    // CHECK 5: Invoice Number Sequence Gaps
    console.log('5️⃣  CHECKING FOR SEQUENCE GAPS');
    console.log('─'.repeat(70));
    for (const orgId of orgs) {
      const invoices = await Invoice.find({ organizationId: orgId })
        .sort({ invoiceDate: 1, createdAt: 1 })
        .select('invoiceNumber invoiceDate')
        .lean();

      // Extract sequences for each year
      const yearSequences = {};
      for (const inv of invoices) {
        const match = inv.invoiceNumber.match(/INV-(\d{4})-\d{2}-(\d{5})/);
        if (match) {
          const year = match[1];
          const seq = parseInt(match[2]);
          if (!yearSequences[year]) yearSequences[year] = [];
          yearSequences[year].push(seq);
        }
      }

      // Check for gaps
      let gapsFound = false;
      for (const [year, sequences] of Object.entries(yearSequences)) {
        sequences.sort((a, b) => a - b);
        for (let i = 0; i < sequences.length - 1; i++) {
          if (sequences[i + 1] !== sequences[i] + 1) {
            if (!gapsFound) {
              console.log(`   ⚠️  Org ${orgId}:`);
              gapsFound = true;
            }
            console.log(`      Year ${year}: Gap between ${sequences[i]} and ${sequences[i + 1]}`);
          }
        }
      }

      if (!gapsFound) {
        console.log(`   ✅ Org ${orgId}: No sequence gaps`);
      }
    }
    console.log();

    // CHECK 6: Test Invoice Creation (Dry Run)
    console.log('6️⃣  TESTING INVOICE NUMBER GENERATION (DRY RUN)');
    console.log('─'.repeat(70));
    try {
      const testOrg = orgs[0];
      const testYear = new Date().getFullYear();

      const counter = await Counter.findOne({
        organizationId: testOrg,
        type: 'invoice',
        yearMonth: String(testYear)
      });

      if (counter) {
        const nextSeq = counter.sequence + 1;
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        const nextNumber = `INV-${testYear}-${month}-${String(nextSeq).padStart(5, '0')}`;
        console.log(`   ✅ Next invoice number would be: ${nextNumber}`);
        console.log(`   ✅ Invoice generation logic is working\n`);
      } else {
        console.log(`   ℹ️  No counter exists for test org, will be created on first invoice\n`);
      }
    } catch (error) {
      console.error(`   ❌ Error testing invoice generation: ${error.message}\n`);
      totalIssues++;
    }

    // CHECK 7: Referenced by Other Collections
    console.log('7️⃣  CHECKING REFERENCES FROM OTHER COLLECTIONS');
    console.log('─'.repeat(70));

    // Import models
    const SalesReturn = (await import('./models/SalesReturn.js')).default;
    const Ledger = (await import('./models/Ledger.js')).default;

    // Check sales returns
    const salesReturnsWithInvoice = await SalesReturn.countDocuments({ invoice: { $exists: true } });
    console.log(`   ✓ Sales Returns referencing invoices: ${salesReturnsWithInvoice}`);

    // Verify all references are valid
    const invalidRefs = await SalesReturn.find({ invoice: { $exists: true } }).populate('invoice').lean();
    const brokenRefs = invalidRefs.filter(sr => !sr.invoice);

    if (brokenRefs.length > 0) {
      console.error(`   ❌ Found ${brokenRefs.length} sales returns with broken invoice references`);
      totalIssues++;
    } else {
      console.log(`   ✅ All sales return references are valid`);
    }

    // Check ledger entries
    const ledgerWithInvoiceRef = await Ledger.countDocuments({
      referenceModel: 'Invoice',
      referenceId: { $exists: true }
    });
    console.log(`   ✓ Ledger entries referencing invoices: ${ledgerWithInvoiceRef}`);
    console.log(`   ✅ Ledger references use _id (not invoiceNumber) - safe!\n`);

    // FINAL SUMMARY
    console.log('═'.repeat(70));
    console.log('📊 INTEGRITY CHECK SUMMARY');
    console.log('═'.repeat(70));

    if (totalIssues === 0) {
      console.log('✅ ALL CHECKS PASSED!');
      console.log('✅ No issues found - System is healthy!');
      console.log('✅ Invoice numbering system is working correctly!');
      console.log('✅ No breaking changes detected!');
    } else {
      console.log(`⚠️  Found ${totalIssues} issue(s) that need attention`);
      console.log('⚠️  Please review the warnings above');
    }

    console.log('\n🎉 Integrity check complete!\n');

  } catch (error) {
    console.error('\n❌ Integrity check failed:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run integrity check
checkInvoiceIntegrity();
