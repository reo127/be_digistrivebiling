import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from './models/Invoice.js';

dotenv.config();

const checkDuplicates = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB Connected');

        // Find duplicate invoice numbers
        const duplicates = await Invoice.aggregate([
            {
                $group: {
                    _id: '$invoiceNumber',
                    count: { $sum: 1 },
                    ids: { $push: '$_id' },
                    orgs: { $push: '$organizationId' }
                }
            },
            {
                $match: {
                    count: { $gt: 1 }
                }
            }
        ]);

        console.log('\n🔍 Checking for duplicate invoice numbers...\n');

        if (duplicates.length === 0) {
            console.log('✅ No duplicates found!');
        } else {
            console.log(`❌ Found ${duplicates.length} duplicate invoice numbers:\n`);
            duplicates.forEach(dup => {
                console.log(`Invoice Number: ${dup._id}`);
                console.log(`Count: ${dup.count}`);
                console.log(`IDs: ${dup.ids.join(', ')}`);
                console.log(`Organizations: ${dup.orgs.join(', ')}`);
                console.log('---');
            });

            console.log('\n⚠️  You need to clean up these duplicates!');
            console.log('Run: node cleanupDuplicateInvoice.js');
        }

        // Check the latest invoice number
        const latest = await Invoice.findOne().sort({ createdAt: -1 });
        if (latest) {
            console.log(`\n📊 Latest invoice: ${latest.invoiceNumber}`);
            console.log(`   Organization: ${latest.organizationId}`);
            console.log(`   Created: ${latest.createdAt}`);
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

checkDuplicates();
