import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from './models/Invoice.js';
import Purchase from './models/Purchase.js';
import SalesReturn from './models/SalesReturn.js';
import PurchaseReturn from './models/PurchaseReturn.js';

dotenv.config();

/**
 * Verification Script: Check migrated document numbers
 */

async function verifyMigration() {
    try {
        console.log('🔍 VERIFYING MIGRATION RESULTS\n');
        console.log('═'.repeat(70));

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Sample invoices
        console.log('📄 Sample Invoices:');
        const invoices = await Invoice.find({}).select('invoiceNumber invoiceDate organizationId').limit(5).sort({ invoiceDate: -1 });
        invoices.forEach(inv => {
            console.log(`   ${inv.invoiceNumber} (${new Date(inv.invoiceDate).toLocaleDateString()})`);
        });

        // Sample purchases
        console.log('\n🛒 Sample Purchases:');
        const purchases = await Purchase.find({}).select('purchaseNumber purchaseDate organizationId').limit(5).sort({ purchaseDate: -1 });
        purchases.forEach(pur => {
            console.log(`   ${pur.purchaseNumber} (${new Date(pur.purchaseDate).toLocaleDateString()})`);
        });

        // Sample sales returns
        console.log('\n🔄 Sample Sales Returns:');
        const salesReturns = await SalesReturn.find({}).select('creditNoteNumber returnDate organizationId').limit(5).sort({ returnDate: -1 });
        salesReturns.forEach(sr => {
            console.log(`   ${sr.creditNoteNumber} (${new Date(sr.returnDate).toLocaleDateString()})`);
        });

        // Sample purchase returns
        console.log('\n↩️  Sample Purchase Returns:');
        const purchaseReturns = await PurchaseReturn.find({}).select('debitNoteNumber returnDate organizationId').limit(5).sort({ returnDate: -1 });
        purchaseReturns.forEach(pr => {
            console.log(`   ${pr.debitNoteNumber} (${new Date(pr.returnDate).toLocaleDateString()})`);
        });

        // Check format consistency
        console.log('\n' + '═'.repeat(70));
        console.log('✅ FORMAT VERIFICATION');
        console.log('═'.repeat(70));

        const invoiceFormat = /^INV-\d{4}-\d{2}-[A-Z0-9]{2}-\d{4}$/;
        const purchaseFormat = /^PUR-\d{4}-\d{2}-[A-Z0-9]{2}-\d{4}$/;
        const salesReturnFormat = /^CN-\d{4}-\d{2}-[A-Z0-9]{2}-\d{4}$/;
        const purchaseReturnFormat = /^DN-\d{4}-\d{2}-[A-Z0-9]{2}-\d{4}$/;

        const allInvoices = await Invoice.find({}).select('invoiceNumber');
        const invalidInvoices = allInvoices.filter(inv => !invoiceFormat.test(inv.invoiceNumber));
        console.log(`\n📄 Invoices: ${allInvoices.length} total, ${invalidInvoices.length} invalid format`);

        const allPurchases = await Purchase.find({}).select('purchaseNumber');
        const invalidPurchases = allPurchases.filter(pur => !purchaseFormat.test(pur.purchaseNumber));
        console.log(`🛒 Purchases: ${allPurchases.length} total, ${invalidPurchases.length} invalid format`);

        const allSalesReturns = await SalesReturn.find({}).select('creditNoteNumber');
        const invalidSalesReturns = allSalesReturns.filter(sr => !salesReturnFormat.test(sr.creditNoteNumber));
        console.log(`🔄 Sales Returns: ${allSalesReturns.length} total, ${invalidSalesReturns.length} invalid format`);

        const allPurchaseReturns = await PurchaseReturn.find({}).select('debitNoteNumber');
        const invalidPurchaseReturns = allPurchaseReturns.filter(pr => !purchaseReturnFormat.test(pr.debitNoteNumber));
        console.log(`↩️  Purchase Returns: ${allPurchaseReturns.length} total, ${invalidPurchaseReturns.length} invalid format`);

        const totalInvalid = invalidInvoices.length + invalidPurchases.length + invalidSalesReturns.length + invalidPurchaseReturns.length;

        console.log('\n' + '═'.repeat(70));
        if (totalInvalid === 0) {
            console.log('✅ ALL DOCUMENTS HAVE CORRECT FORMAT!');
            console.log('✅ Format: PREFIX-YYYY-MM-OO-XXXX');
            console.log('✅ All modules are now consistent!');
        } else {
            console.log(`⚠️  Found ${totalInvalid} documents with invalid format`);
        }
        console.log('═'.repeat(70));

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Verification failed:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

verifyMigration();
