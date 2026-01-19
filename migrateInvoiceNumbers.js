import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from './models/Invoice.js';
import Counter from './models/Counter.js';

dotenv.config();

/**
 * Migration Script: Renumber All Invoices with Continuous Format
 *
 * This script will:
 * 1. Find all invoices grouped by organization and year
 * 2. Renumber them sequentially: INV-2026-00001, INV-2026-00002, etc.
 * 3. Update the Counter collection to reflect the new sequence
 * 4. Fix all duplicate invoice numbers
 *
 * IMPORTANT: This will change invoice numbers!
 * - Backup your database before running
 * - Inform users about the change
 * - Update printed invoices if needed
 */

const migrateInvoiceNumbers = async () => {
  try {
    console.log('🚀 Starting invoice number migration...\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all organizations
    const organizations = await Invoice.distinct('organizationId');
    console.log(`📊 Found ${organizations.length} organization(s)\n`);

    let totalUpdated = 0;
    let totalErrors = 0;

    // Process each organization
    for (const orgId of organizations) {
      console.log(`\n📁 Processing Organization: ${orgId}`);
      console.log('─'.repeat(60));

      // Get all invoices for this organization, sorted by creation date
      const invoices = await Invoice.find({ organizationId: orgId })
        .sort({ createdAt: 1 }) // Oldest first
        .lean();

      console.log(`   Found ${invoices.length} invoices`);

      if (invoices.length === 0) continue;

      // Group invoices by year
      const invoicesByYear = {};
      for (const invoice of invoices) {
        const year = new Date(invoice.createdAt).getFullYear();
        if (!invoicesByYear[year]) {
          invoicesByYear[year] = [];
        }
        invoicesByYear[year].push(invoice);
      }

      // Process each year
      for (const [year, yearInvoices] of Object.entries(invoicesByYear)) {
        console.log(`\n   📅 Year ${year}: ${yearInvoices.length} invoices`);

        let sequence = 1;
        const updates = [];

        for (const invoice of yearInvoices) {
          const oldNumber = invoice.invoiceNumber;
          const newNumber = `INV-${year}-${String(sequence).padStart(5, '0')}`;

          if (oldNumber !== newNumber) {
            updates.push({
              _id: invoice._id,
              oldNumber,
              newNumber,
              sequence
            });
          }

          sequence++;
        }

        // Show preview
        if (updates.length > 0) {
          console.log(`\n   📝 Changes for ${year}:`);
          console.log(`   ├─ First: ${updates[0].oldNumber} → ${updates[0].newNumber}`);
          if (updates.length > 1) {
            console.log(`   └─ Last:  ${updates[updates.length - 1].oldNumber} → ${updates[updates.length - 1].newNumber}`);
          }
          console.log(`   Total to update: ${updates.length}`);
        }

        // Apply updates
        for (const update of updates) {
          try {
            await Invoice.updateOne(
              { _id: update._id },
              { $set: { invoiceNumber: update.newNumber } }
            );
            totalUpdated++;
          } catch (error) {
            console.error(`   ❌ Error updating invoice ${update.oldNumber}:`, error.message);
            totalErrors++;
          }
        }

        // Update the counter for this year
        await Counter.findOneAndUpdate(
          { organizationId: orgId, type: 'invoice', yearMonth: String(year) },
          { $set: { sequence: sequence - 1 } },
          { upsert: true }
        );

        console.log(`   ✅ Updated counter for ${year}: sequence = ${sequence - 1}`);
      }
    }

    console.log('\n' + '═'.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('═'.repeat(60));
    console.log(`✅ Total invoices updated: ${totalUpdated}`);
    console.log(`❌ Total errors: ${totalErrors}`);
    console.log('✅ Migration completed successfully!\n');

    // Clean up old counter entries (monthly format)
    console.log('🧹 Cleaning up old monthly counter entries...');
    const oldCounters = await Counter.find({
      type: 'invoice',
      yearMonth: { $regex: /^\d{6}$/ } // Match YYYYMM format (6 digits)
    });

    if (oldCounters.length > 0) {
      console.log(`   Found ${oldCounters.length} old counter entries`);
      await Counter.deleteMany({
        type: 'invoice',
        yearMonth: { $regex: /^\d{6}$/ }
      });
      console.log('   ✅ Cleaned up old counter entries');
    } else {
      console.log('   ℹ️  No old counter entries to clean up');
    }

    console.log('\n🎉 All done! Invoice numbers are now unique and continuous.\n');

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
console.log('\n' + '═'.repeat(60));
console.log('🔄 INVOICE NUMBER MIGRATION SCRIPT');
console.log('═'.repeat(60));
console.log('⚠️  WARNING: This will change all existing invoice numbers!');
console.log('📋 Make sure you have a database backup before proceeding.\n');

// Wait 3 seconds before starting
console.log('Starting in 3 seconds... (Press Ctrl+C to cancel)\n');
setTimeout(() => {
  migrateInvoiceNumbers();
}, 3000);
