import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Counter from './models/Counter.js';
import Invoice from './models/Invoice.js';

dotenv.config();

const checkCounter = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB Connected\n');

        // Get current month
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const yearMonth = `${year}${month}`;

        console.log(`📅 Current month: ${yearMonth}\n`);

        // Find all invoice counters
        const counters = await Counter.find({ type: 'invoice' });

        console.log(`📊 Found ${counters.length} invoice counter(s):\n`);

        for (const counter of counters) {
            console.log(`Counter for ${counter.yearMonth}:`);
            console.log(`  Organization: ${counter.organizationId}`);
            console.log(`  Current Sequence: ${counter.sequence}`);
            console.log(`  Next Invoice: INV-${counter.yearMonth}-${String(counter.sequence + 1).padStart(4, '0')}`);

            // Find actual invoices for this org and month
            const invoices = await Invoice.find({
                organizationId: counter.organizationId,
                invoiceNumber: new RegExp(`^INV-${counter.yearMonth}`)
            }).sort({ invoiceNumber: 1 });

            console.log(`  Actual Invoices: ${invoices.length}`);
            if (invoices.length > 0) {
                console.log(`  Invoice Numbers: ${invoices.map(i => i.invoiceNumber).join(', ')}`);
            }
            console.log('');
        }

        // Check for invoices without counters
        const allInvoices = await Invoice.find({
            invoiceNumber: new RegExp(`^INV-${yearMonth}`)
        });

        console.log(`\n📋 Total invoices for ${yearMonth}: ${allInvoices.length}`);

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

checkCounter();
