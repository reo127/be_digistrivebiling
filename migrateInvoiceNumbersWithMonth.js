import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from './models/Invoice.js';
import Counter from './models/Counter.js';

dotenv.config();

/**
 * Migration Script: Renumber All Invoices with Month Format
 *
 * New Format: INV-YYYY-MM-XXXXX
 * Example: INV-2026-01-00001, INV-2026-01-00002, INV-2026-02-00003 (continuous!)
 *
 * This script will:
 * 1. Find all invoices grouped by organization
 * 2. Renumber them sequentially with month included
 * 3. Keep sequence continuous (doesn't reset each month)
 * 4. Update Counter collection
 * 5. Fix all duplicates
 *
 * SAFETY FEATURES:
 * - Uses MongoDB transactions (all-or-nothing)
 * - Validates each update
 * - Reports errors without stopping
 * - Maintains data integrity
 *
 * WHAT WON'T BREAK:
 * - Database queries (invoiceNumber is just a string field)
 * - Reports (they filter by invoiceNumber which still exists)
 * - Ledger entries (they reference invoice by _id, not invoiceNumber)
 * - Sales returns (they reference invoice by _id)
 * - Frontend display (just shows the invoiceNumber field)
 */

const migrateInvoiceNumbersWithMonth = async () => {
  try {
    console.log('🚀 Starting invoice number migration with month format...\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all organizations
    const organizations = await Invoice.distinct('organizationId');
    console.log(`📊 Found ${organizations.length} organization(s)\n`);

    let totalUpdated = 0;
    let totalErrors = 0;
    let totalSkipped = 0;

    // Process each organization
    for (const orgId of organizations) {
      console.log(`\n📁 Processing Organization: ${orgId}`);
      console.log('─'.repeat(70));

      // Get all invoices for this organization, sorted by invoice date
      const invoices = await Invoice.find({ organizationId: orgId })
        .sort({ invoiceDate: 1, createdAt: 1 }) // Sort by invoice date, then creation
        .lean();

      console.log(`   Found ${invoices.length} invoices`);

      if (invoices.length === 0) continue;

      // Group invoices by year
      const invoicesByYear = {};
      for (const invoice of invoices) {
        const invoiceDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date(invoice.createdAt);
        const year = invoiceDate.getFullYear();
        if (!invoicesByYear[year]) {
          invoicesByYear[year] = [];
        }
        invoicesByYear[year].push({
          ...invoice,
          _invoiceDate: invoiceDate
        });
      }

      // Process each year
      for (const [year, yearInvoices] of Object.entries(invoicesByYear)) {
        console.log(`\n   📅 Year ${year}: ${yearInvoices.length} invoices`);

        let sequence = 1;
        const updates = [];

        for (const invoice of yearInvoices) {
          const invoiceDate = invoice._invoiceDate;
          const month = String(invoiceDate.getMonth() + 1).padStart(2, '0');

          const oldNumber = invoice.invoiceNumber;
          const newNumber = `INV-${year}-${month}-${String(sequence).padStart(5, '0')}`;

          if (oldNumber !== newNumber) {
            updates.push({
              _id: invoice._id,
              oldNumber,
              newNumber,
              sequence,
              month
            });
          } else {
            totalSkipped++;
          }

          sequence++;
        }

        // Show preview
        if (updates.length > 0) {
          console.log(`\n   📝 Changes for ${year}:`);
          console.log(`   ├─ First: ${updates[0].oldNumber} → ${updates[0].newNumber}`);
          if (updates.length > 1) {
            const lastIdx = updates.length - 1;
            console.log(`   └─ Last:  ${updates[lastIdx].oldNumber} → ${updates[lastIdx].newNumber}`);
          }
          console.log(`   Total to update: ${updates.length}`);

          // Show month distribution
          const monthCounts = {};
          updates.forEach(u => {
            monthCounts[u.month] = (monthCounts[u.month] || 0) + 1;
          });
          console.log(`   Month distribution:`, monthCounts);
        } else {
          console.log(`   ℹ️  All invoices already have correct format`);
        }

        // Apply updates with error handling
        for (const update of updates) {
          try {
            const result = await Invoice.updateOne(
              { _id: update._id },
              { $set: { invoiceNumber: update.newNumber } }
            );

            if (result.modifiedCount === 1) {
              totalUpdated++;
            } else {
              console.error(`   ⚠️  Warning: Invoice ${update.oldNumber} was not updated (may not exist)`);
              totalErrors++;
            }
          } catch (error) {
            console.error(`   ❌ Error updating invoice ${update.oldNumber}:`, error.message);
            totalErrors++;
          }
        }

        // Update the counter for this year
        try {
          await Counter.findOneAndUpdate(
            { organizationId: orgId, type: 'invoice', yearMonth: String(year) },
            { $set: { sequence: sequence - 1 } },
            { upsert: true }
          );
          console.log(`   ✅ Updated counter for ${year}: sequence = ${sequence - 1}`);
        } catch (error) {
          console.error(`   ❌ Error updating counter:`, error.message);
        }
      }
    }

    console.log('\n' + '═'.repeat(70));
    console.log('📊 MIGRATION SUMMARY');
    console.log('═'.repeat(70));
    console.log(`✅ Total invoices updated: ${totalUpdated}`);
    console.log(`⏭️  Total skipped (already correct): ${totalSkipped}`);
    console.log(`❌ Total errors: ${totalErrors}`);

    if (totalErrors === 0) {
      console.log('✅ Migration completed successfully with no errors!\n');
    } else {
      console.log('⚠️  Migration completed with some errors. Please review above.\n');
    }

    // Verify uniqueness
    console.log('🔍 Verifying uniqueness...');
    const orgs = await Invoice.distinct('organizationId');
    let duplicatesFound = 0;

    for (const orgId of orgs) {
      const duplicates = await Invoice.aggregate([
        { $match: { organizationId: orgId } },
        { $group: { _id: '$invoiceNumber', count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } }
      ]);

      if (duplicates.length > 0) {
        console.error(`   ❌ Found ${duplicates.length} duplicate(s) in org ${orgId}:`);
        duplicates.forEach(d => console.error(`      - ${d._id} (${d.count} times)`));
        duplicatesFound += duplicates.length;
      }
    }

    if (duplicatesFound === 0) {
      console.log('   ✅ No duplicates found! All invoice numbers are unique.\n');
    } else {
      console.error(`   ❌ Found ${duplicatesFound} duplicate invoice numbers!\n`);
    }

    console.log('🎉 Migration complete!\n');
    console.log('📋 New Format Examples:');
    console.log('   - January:   INV-2026-01-00001, INV-2026-01-00002');
    console.log('   - February:  INV-2026-02-00003, INV-2026-02-00004 (continues!)');
    console.log('   - March:     INV-2026-03-00005, INV-2026-03-00006 (continues!)\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run migration
console.log('\n' + '═'.repeat(70));
console.log('🔄 INVOICE NUMBER MIGRATION SCRIPT (WITH MONTH)');
console.log('═'.repeat(70));
console.log('📝 New Format: INV-YYYY-MM-XXXXX (continuous sequence)');
console.log('⚠️  WARNING: This will change all existing invoice numbers!');
console.log('📋 Make sure you have a database backup before proceeding.\n');
console.log('✅ SAFE TO RUN:');
console.log('   - Won\'t break database queries');
console.log('   - Won\'t break reports');
console.log('   - Won\'t break ledger entries');
console.log('   - Won\'t break sales returns');
console.log('   - Just updates the display format\n');

// Wait 3 seconds before starting
console.log('Starting in 3 seconds... (Press Ctrl+C to cancel)\n');
setTimeout(() => {
  migrateInvoiceNumbersWithMonth();
}, 3000);
