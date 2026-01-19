import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from './models/Invoice.js';
import Purchase from './models/Purchase.js';
import SalesReturn from './models/SalesReturn.js';
import PurchaseReturn from './models/PurchaseReturn.js';
import Organization from './models/Organization.js';
import Counter from './models/Counter.js';

dotenv.config();

/**
 * Migration Script: Renumber All Documents with Org Initials
 *
 * New Format:
 * - Invoices & Purchases: PREFIX-YYYY-OO-XXXXXX (6 digits)
 * - Returns: PREFIX-YYYY-MM-OO-XXXX (4 digits with month)
 *
 * Where:
 * - PREFIX: INV, PUR, CN, DN
 * - YYYY: Year (e.g., 2026)
 * - MM: Month (01-12, only for returns)
 * - OO: First 2 characters of organization name
 * - XXXXXX/XXXX: Sequential number (continuous within year)
 *
 * Examples:
 * - INV-2026-RA-000001 (Invoice for "Ramesh Medicals")
 * - PUR-2026-RA-000001 (Purchase)
 * - CN-2026-01-RA-0001 (Credit Note in January)
 * - DN-2026-01-RA-0001 (Debit Note in January)
 */

async function migrateAllWithMonthAndOrg() {
  try {
    console.log('🔧 MIGRATING ALL DOCUMENTS WITH MONTH AND ORG INITIALS\n');
    console.log('═'.repeat(70));

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all organizations
    const organizations = await Organization.find({}).select('_id organizationName');
    console.log(`📋 Found ${organizations.length} organization(s)\n`);

    let totalUpdated = 0;
    let totalErrors = 0;

    // Process each organization
    for (const org of organizations) {
      console.log(`\n${'─'.repeat(70)}`);
      console.log(`🏢 Processing: ${org.organizationName}`);
      console.log(`${'─'.repeat(70)}`);

      // Extract organization initials
      const orgInitials = org.organizationName
        .trim()
        .substring(0, 2)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '') || 'XX';

      console.log(`   Initials: ${orgInitials}\n`);

      // Migrate Invoices
      const invoiceResult = await migrateInvoices(org._id, orgInitials);
      totalUpdated += invoiceResult.updated;
      totalErrors += invoiceResult.errors;

      // Migrate Purchases
      const purchaseResult = await migratePurchases(org._id, orgInitials);
      totalUpdated += purchaseResult.updated;
      totalErrors += purchaseResult.errors;

      // Migrate Sales Returns
      const salesReturnResult = await migrateSalesReturns(org._id, orgInitials);
      totalUpdated += salesReturnResult.updated;
      totalErrors += salesReturnResult.errors;

      // Migrate Purchase Returns
      const purchaseReturnResult = await migratePurchaseReturns(org._id, orgInitials);
      totalUpdated += purchaseReturnResult.updated;
      totalErrors += purchaseReturnResult.errors;
    }

    console.log('\n' + '═'.repeat(70));
    console.log('📊 MIGRATION SUMMARY');
    console.log('═'.repeat(70));
    console.log(`✅ Total documents updated: ${totalUpdated}`);
    console.log(`❌ Total errors: ${totalErrors}`);
    console.log('═'.repeat(70));

    if (totalErrors === 0) {
      console.log('\n🎉 SUCCESS! All documents migrated with org initials!\n');
      console.log('New Format Examples:');
      console.log('   - Invoice:         INV-2026-RA-000001');
      console.log('   - Purchase:        PUR-2026-RA-000001');
      console.log('   - Sales Return:    CN-2026-01-RA-0001');
      console.log('   - Purchase Return: DN-2026-01-RA-0001\n');
    } else {
      console.log(`\n⚠️  Migration completed with ${totalErrors} error(s)\n`);
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

async function migrateInvoices(orgId, orgInitials) {
  console.log('   📄 Migrating Invoices...');

  try {
    const invoices = await Invoice.find({ organizationId: orgId }).sort({ invoiceDate: 1 });

    if (invoices.length === 0) {
      console.log('      ℹ️  No invoices found');
      return { updated: 0, errors: 0 };
    }

    // Group by year
    const yearGroups = {};
    invoices.forEach(inv => {
      const date = new Date(inv.invoiceDate);
      const year = date.getFullYear();
      if (!yearGroups[year]) yearGroups[year] = [];
      yearGroups[year].push(inv);
    });

    let updated = 0;
    let errors = 0;

    // Process each year
    for (const [year, yearInvoices] of Object.entries(yearGroups)) {
      let sequence = 1;

      for (const invoice of yearInvoices) {
        try {
          const newNumber = `INV-${year}-${orgInitials}-${String(sequence).padStart(6, '0')}`;

          await Invoice.updateOne(
            { _id: invoice._id },
            { $set: { invoiceNumber: newNumber } }
          );

          sequence++;
          updated++;
        } catch (err) {
          console.error(`      ❌ Error updating invoice ${invoice._id}:`, err.message);
          errors++;
        }
      }

      // Update counter for this year
      await Counter.findOneAndUpdate(
        { organizationId: orgId, type: 'invoice', yearMonth: String(year) },
        { $set: { sequence: sequence - 1 } },
        { upsert: true }
      );
    }

    console.log(`      ✅ ${updated} invoices updated`);
    return { updated, errors };
  } catch (error) {
    console.error('      ❌ Error:', error.message);
    return { updated: 0, errors: 1 };
  }
}

async function migratePurchases(orgId, orgInitials) {
  console.log('   🛒 Migrating Purchases...');

  try {
    const purchases = await Purchase.find({ organizationId: orgId }).sort({ purchaseDate: 1 });

    if (purchases.length === 0) {
      console.log('      ℹ️  No purchases found');
      return { updated: 0, errors: 0 };
    }

    // Group by year
    const yearGroups = {};
    purchases.forEach(pur => {
      const date = new Date(pur.purchaseDate);
      const year = date.getFullYear();
      if (!yearGroups[year]) yearGroups[year] = [];
      yearGroups[year].push(pur);
    });

    let updated = 0;
    let errors = 0;

    // Process each year
    for (const [year, yearPurchases] of Object.entries(yearGroups)) {
      let sequence = 1;

      for (const purchase of yearPurchases) {
        try {
          const newNumber = `PUR-${year}-${orgInitials}-${String(sequence).padStart(6, '0')}`;

          await Purchase.updateOne(
            { _id: purchase._id },
            { $set: { purchaseNumber: newNumber } }
          );

          sequence++;
          updated++;
        } catch (err) {
          console.error(`      ❌ Error updating purchase ${purchase._id}:`, err.message);
          errors++;
        }
      }

      // Update counter for this year
      await Counter.findOneAndUpdate(
        { organizationId: orgId, type: 'purchase', yearMonth: String(year) },
        { $set: { sequence: sequence - 1 } },
        { upsert: true }
      );
    }

    console.log(`      ✅ ${updated} purchases updated`);
    return { updated, errors };
  } catch (error) {
    console.error('      ❌ Error:', error.message);
    return { updated: 0, errors: 1 };
  }
}

async function migrateSalesReturns(orgId, orgInitials) {
  console.log('   🔄 Migrating Sales Returns...');

  try {
    const salesReturns = await SalesReturn.find({ organizationId: orgId }).sort({ returnDate: 1 });

    if (salesReturns.length === 0) {
      console.log('      ℹ️  No sales returns found');
      return { updated: 0, errors: 0 };
    }

    // Group by year
    const yearGroups = {};
    salesReturns.forEach(sr => {
      const date = new Date(sr.returnDate);
      const year = date.getFullYear();
      if (!yearGroups[year]) yearGroups[year] = [];
      yearGroups[year].push(sr);
    });

    let updated = 0;
    let errors = 0;

    // Process each year
    for (const [year, yearReturns] of Object.entries(yearGroups)) {
      let sequence = 1;

      for (const salesReturn of yearReturns) {
        try {
          const date = new Date(salesReturn.returnDate);
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const newNumber = `CN-${year}-${month}-${orgInitials}-${String(sequence).padStart(4, '0')}`;

          await SalesReturn.updateOne(
            { _id: salesReturn._id },
            { $set: { creditNoteNumber: newNumber } }
          );

          sequence++;
          updated++;
        } catch (err) {
          console.error(`      ❌ Error updating sales return ${salesReturn._id}:`, err.message);
          errors++;
        }
      }

      // Update counter for this year
      await Counter.findOneAndUpdate(
        { organizationId: orgId, type: 'salesReturn', yearMonth: String(year) },
        { $set: { sequence: sequence - 1 } },
        { upsert: true }
      );
    }

    console.log(`      ✅ ${updated} sales returns updated`);
    return { updated, errors };
  } catch (error) {
    console.error('      ❌ Error:', error.message);
    return { updated: 0, errors: 1 };
  }
}

async function migratePurchaseReturns(orgId, orgInitials) {
  console.log('   ↩️  Migrating Purchase Returns...');

  try {
    const purchaseReturns = await PurchaseReturn.find({ organizationId: orgId }).sort({ returnDate: 1 });

    if (purchaseReturns.length === 0) {
      console.log('      ℹ️  No purchase returns found');
      return { updated: 0, errors: 0 };
    }

    // Group by year
    const yearGroups = {};
    purchaseReturns.forEach(pr => {
      const date = new Date(pr.returnDate);
      const year = date.getFullYear();
      if (!yearGroups[year]) yearGroups[year] = [];
      yearGroups[year].push(pr);
    });

    let updated = 0;
    let errors = 0;

    // Process each year
    for (const [year, yearReturns] of Object.entries(yearGroups)) {
      let sequence = 1;

      for (const purchaseReturn of yearReturns) {
        try {
          const date = new Date(purchaseReturn.returnDate);
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const newNumber = `DN-${year}-${month}-${orgInitials}-${String(sequence).padStart(4, '0')}`;

          await PurchaseReturn.updateOne(
            { _id: purchaseReturn._id },
            { $set: { debitNoteNumber: newNumber } }
          );

          sequence++;
          updated++;
        } catch (err) {
          console.error(`      ❌ Error updating purchase return ${purchaseReturn._id}:`, err.message);
          errors++;
        }
      }

      // Update counter for this year
      await Counter.findOneAndUpdate(
        { organizationId: orgId, type: 'purchaseReturn', yearMonth: String(year) },
        { $set: { sequence: sequence - 1 } },
        { upsert: true }
      );
    }

    console.log(`      ✅ ${updated} purchase returns updated`);
    return { updated, errors };
  } catch (error) {
    console.error('      ❌ Error:', error.message);
    return { updated: 0, errors: 1 };
  }
}

// Run migration
migrateAllWithMonthAndOrg();
