import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Purchase from './models/Purchase.js';
import Counter from './models/Counter.js';

dotenv.config();

const checkPurchases = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB Connected\n');

        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const yearMonth = `${year}${month}`;

        console.log(`📅 Current month: ${yearMonth}\n`);
        console.log('=' .repeat(70));

        // Find all purchase counters
        const counters = await Counter.find({ type: 'purchase' });

        console.log(`\n📊 PURCHASE COUNTERS:\n`);
        for (const counter of counters) {
            console.log(`Counter for ${counter.yearMonth}:`);
            console.log(`  Organization: ${counter.organizationId}`);
            console.log(`  Current Sequence: ${counter.sequence}`);
            console.log(`  Next Purchase Number: PUR-${counter.yearMonth}-${String(counter.sequence + 1).padStart(4, '0')}`);

            // Find actual purchases for this org and month
            const purchases = await Purchase.find({
                organizationId: counter.organizationId,
                purchaseNumber: new RegExp(`^PUR-${counter.yearMonth}`)
            }).sort({ purchaseNumber: 1 });

            console.log(`  Actual Purchases in DB: ${purchases.length}`);
            if (purchases.length > 0) {
                console.log(`  Purchase Numbers:`);
                purchases.forEach(p => {
                    console.log(`    - ${p.purchaseNumber} (ID: ${p._id})`);
                });

                // Check for duplicates
                const numbers = purchases.map(p => p.purchaseNumber);
                const duplicates = numbers.filter((item, index) => numbers.indexOf(item) !== index);
                if (duplicates.length > 0) {
                    console.log(`  ❌ DUPLICATES FOUND: ${duplicates.join(', ')}`);
                } else {
                    console.log(`  ✅ No duplicates in DB`);
                }

                // Check if counter matches
                const maxNumber = Math.max(...purchases.map(p => {
                    const num = p.purchaseNumber.split('-').pop();
                    return parseInt(num);
                }));
                console.log(`  Highest Number in DB: ${maxNumber}`);
                console.log(`  Counter Sequence: ${counter.sequence}`);
                if (maxNumber !== counter.sequence) {
                    console.log(`  ⚠️  MISMATCH! Counter should be ${maxNumber} but is ${counter.sequence}`);
                }
            }
            console.log('');
        }

        // Find ALL purchases for current month across all organizations
        const allPurchases = await Purchase.find({
            purchaseNumber: new RegExp(`^PUR-${yearMonth}`)
        });

        console.log('=' .repeat(70));
        console.log(`\n📋 ALL PURCHASES FOR ${yearMonth}: ${allPurchases.length} total\n`);

        // Group by organization
        const byOrg = {};
        allPurchases.forEach(p => {
            const orgId = p.organizationId.toString();
            if (!byOrg[orgId]) {
                byOrg[orgId] = [];
            }
            byOrg[orgId].push(p.purchaseNumber);
        });

        Object.entries(byOrg).forEach(([orgId, numbers]) => {
            console.log(`Organization ${orgId}:`);
            console.log(`  Purchases: ${numbers.sort().join(', ')}`);
        });

        // Check for any purchase without organizationId
        const missingOrg = await Purchase.find({ organizationId: null });
        if (missingOrg.length > 0) {
            console.log(`\n⚠️  WARNING: ${missingOrg.length} purchases without organizationId!`);
        }

        console.log('\n' + '='.repeat(70));

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

checkPurchases();
