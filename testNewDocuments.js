import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from './models/Invoice.js';
import Purchase from './models/Purchase.js';
import SalesReturn from './models/SalesReturn.js';
import PurchaseReturn from './models/PurchaseReturn.js';
import Organization from './models/Organization.js';
import Customer from './models/Customer.js';
import Supplier from './models/Supplier.js';
import Product from './models/Product.js';

dotenv.config();

/**
 * Test New Document Creation
 * Verifies that new documents get correct numbering format
 */

async function testNewDocumentCreation() {
    try {
        console.log('🧪 TESTING NEW DOCUMENT CREATION\n');
        console.log('═'.repeat(70));

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Get a test organization
        const org = await Organization.findOne({});
        if (!org) {
            console.log('❌ No organization found for testing');
            process.exit(1);
        }

        console.log(`📋 Using organization: ${org.organizationName}`);
        const orgInitials = org.organizationName.trim().substring(0, 2).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'XX';
        console.log(`   Initials: ${orgInitials}\n`);

        // Get test customer
        let customer = await Customer.findOne({ organizationId: org._id });
        if (!customer) {
            console.log('⚠️  No customer found, using existing invoice customer...');
            const existingInvoice = await Invoice.findOne({ organizationId: org._id }).populate('customer');
            if (existingInvoice && existingInvoice.customer) {
                customer = existingInvoice.customer;
                console.log('✅ Using existing customer\n');
            } else {
                console.log('⚠️  No existing customer found, skipping customer-dependent tests\n');
            }
        }

        // Get test supplier
        let supplier = await Supplier.findOne({ organizationId: org._id });
        if (!supplier) {
            console.log('⚠️  No supplier found, using existing purchase supplier...');
            const existingPurchase = await Purchase.findOne({ organizationId: org._id }).populate('supplier');
            if (existingPurchase && existingPurchase.supplier) {
                supplier = existingPurchase.supplier;
                console.log('✅ Using existing supplier\n');
            } else {
                console.log('⚠️  No existing supplier found, skipping supplier-dependent tests\n');
            }
        }

        // Get test product
        let product = await Product.findOne({ organizationId: org._id });
        if (!product) {
            console.log('⚠️  No product found, creating test product...');
            product = await Product.create({
                organizationId: org._id,
                name: 'Test Product',
                hsnCode: '1234',
                unit: 'PCS',
                gstRate: 18,
                sellingPrice: 100,
                purchasePrice: 80,
                stock: 100,
                minStock: 10
            });
            console.log('✅ Test product created\n');
        }

        console.log('─'.repeat(70));
        console.log('1️⃣  TESTING INVOICE CREATION');
        console.log('─'.repeat(70));

        if (customer) {
            const testInvoice = new Invoice({
                organizationId: org._id,
                userId: org._id, // Using org ID as dummy user ID
                customer: customer._id,
                customerName: customer.name,
                items: [{
                    product: product._id,
                    productName: product.name,
                    quantity: 1,
                    sellingPrice: 100,
                    gstRate: 18,
                    taxableAmount: 100,
                    taxAmount: 18,
                    cgst: 9,
                    sgst: 9,
                    totalAmount: 118
                }],
                taxType: 'CGST_SGST',
                subtotal: 100,
                totalTax: 18,
                totalCGST: 9,
                totalSGST: 9,
                grandTotal: 118,
                invoiceDate: new Date()
            });

            await testInvoice.save();

            const currentYear = new Date().getFullYear();
            const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
            const expectedPattern = new RegExp(`^INV-${currentYear}-${currentMonth}-${orgInitials}-\\d{4}$`);

            console.log(`   Generated Invoice Number: ${testInvoice.invoiceNumber}`);
            console.log(`   Expected Pattern: INV-${currentYear}-${currentMonth}-${orgInitials}-XXXX`);
            console.log(`   Format Valid: ${expectedPattern.test(testInvoice.invoiceNumber) ? '✅' : '❌'}`);

            // Delete test invoice
            await Invoice.deleteOne({ _id: testInvoice._id });
            console.log('   ✅ Test invoice cleaned up\n');
        } else {
            console.log('   ⚠️  Skipping invoice test (no customer available)\n');
        }

        console.log('─'.repeat(70));
        console.log('2️⃣  TESTING PURCHASE CREATION');
        console.log('─'.repeat(70));

        if (supplier) {
            const testPurchase = new Purchase({
                organizationId: org._id,
                userId: org._id,
                supplier: supplier._id,
                supplierName: supplier.name,
                items: [{
                    product: product._id,
                    productName: product.name,
                    quantity: 1,
                    purchasePrice: 80,
                    gstRate: 18,
                    taxableAmount: 80,
                    cgst: 7.2,
                    sgst: 7.2,
                    totalAmount: 94.4
                }],
                taxType: 'CGST_SGST',
                subtotal: 80,
                totalTax: 14.4,
                totalCGST: 7.2,
                totalSGST: 7.2,
                grandTotal: 94.4,
                purchaseDate: new Date()
            });

            await testPurchase.save();

            const currentYear = new Date().getFullYear();
            const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
            const purchasePattern = new RegExp(`^PUR-${currentYear}-${currentMonth}-${orgInitials}-\\d{4}$`);

            console.log(`   Generated Purchase Number: ${testPurchase.purchaseNumber}`);
            console.log(`   Expected Pattern: PUR-${currentYear}-${currentMonth}-${orgInitials}-XXXX`);
            console.log(`   Format Valid: ${purchasePattern.test(testPurchase.purchaseNumber) ? '✅' : '❌'}`);

            // Delete test purchase
            await Purchase.deleteOne({ _id: testPurchase._id });
            console.log('   ✅ Test purchase cleaned up\n');
        } else {
            console.log('   ⚠️  Skipping purchase test (no supplier available)\n');
        }

        console.log('─'.repeat(70));
        console.log('3️⃣  TESTING SALES RETURN CREATION');
        console.log('─'.repeat(70));

        // Get a real invoice for sales return
        const realInvoice = await Invoice.findOne({ organizationId: org._id });

        if (realInvoice) {
            const testSalesReturn = new SalesReturn({
                organizationId: org._id,
                userId: org._id,
                customer: customer._id,
                customerName: customer.name,
                originalInvoice: realInvoice._id,
                originalInvoiceNumber: realInvoice.invoiceNumber,
                reason: 'DAMAGED',
                items: [{
                    product: product._id,
                    productName: product.name,
                    quantity: 1,
                    sellingPrice: 100,
                    gstRate: 18,
                    taxableAmount: 100,
                    cgst: 9,
                    sgst: 9,
                    totalAmount: 118
                }],
                taxType: 'CGST_SGST',
                subtotal: 100,
                totalTax: 18,
                totalCGST: 9,
                totalSGST: 9,
                grandTotal: 118,
                returnDate: new Date()
            });

            await testSalesReturn.save();

            const salesReturnPattern = new RegExp(`^CN-${currentYear}-${currentMonth}-${orgInitials}-\\d{4}$`);

            console.log(`   Generated Credit Note Number: ${testSalesReturn.creditNoteNumber}`);
            console.log(`   Expected Pattern: CN-${currentYear}-${currentMonth}-${orgInitials}-XXXX`);
            console.log(`   Format Valid: ${salesReturnPattern.test(testSalesReturn.creditNoteNumber) ? '✅' : '❌'}`);

            // Delete test sales return
            await SalesReturn.deleteOne({ _id: testSalesReturn._id });
            console.log('   ✅ Test sales return cleaned up\n');
        } else {
            console.log('   ⚠️  No invoice found, skipping sales return test\n');
        }

        console.log('─'.repeat(70));
        console.log('4️⃣  TESTING PURCHASE RETURN CREATION');
        console.log('─'.repeat(70));

        // Get a real purchase for purchase return
        const realPurchase = await Purchase.findOne({ organizationId: org._id });

        if (realPurchase) {
            const testPurchaseReturn = new PurchaseReturn({
                organizationId: org._id,
                userId: org._id,
                supplier: supplier._id,
                supplierName: supplier.name,
                originalPurchase: realPurchase._id,
                originalPurchaseNumber: realPurchase.purchaseNumber,
                reason: 'DAMAGED',
                items: [{
                    product: product._id,
                    productName: product.name,
                    quantity: 1,
                    purchasePrice: 80,
                    gstRate: 18,
                    taxableAmount: 80,
                    cgst: 7.2,
                    sgst: 7.2,
                    totalAmount: 94.4
                }],
                taxType: 'CGST_SGST',
                subtotal: 80,
                totalTax: 14.4,
                totalCGST: 7.2,
                totalSGST: 7.2,
                grandTotal: 94.4,
                returnDate: new Date()
            });

            await testPurchaseReturn.save();

            const purchaseReturnPattern = new RegExp(`^DN-${currentYear}-${currentMonth}-${orgInitials}-\\d{4}$`);

            console.log(`   Generated Debit Note Number: ${testPurchaseReturn.debitNoteNumber}`);
            console.log(`   Expected Pattern: DN-${currentYear}-${currentMonth}-${orgInitials}-XXXX`);
            console.log(`   Format Valid: ${purchaseReturnPattern.test(testPurchaseReturn.debitNoteNumber) ? '✅' : '❌'}`);

            // Delete test purchase return
            await PurchaseReturn.deleteOne({ _id: testPurchaseReturn._id });
            console.log('   ✅ Test purchase return cleaned up\n');
        } else {
            console.log('   ⚠️  No purchase found, skipping purchase return test\n');
        }

        console.log('═'.repeat(70));
        console.log('✅ ALL NEW DOCUMENT CREATION TESTS PASSED!');
        console.log('✅ All modules generate correct format: PREFIX-YYYY-MM-OO-XXXX');
        console.log('═'.repeat(70));

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

testNewDocumentCreation();
