import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Purchase from './models/Purchase.js';
import Counter from './models/Counter.js';

dotenv.config();

const checkAllPurchases = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB Connected\n');

        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const yearMonth = `${year}${month}`;

        // Find ALL purchases for current month
        const allPurchases = await Purchase.find({
            purchaseNumber: new RegExp(`^PUR-${yearMonth}`)
        }).sort({ purchaseNumber: 1 });

        console.log(`📋 ALL PURCHASES FOR ${yearMonth}: ${allPurchases.length} total\n`);
        console.log('='.repeat(80));

        allPurchases.forEach((p, i) => {
            console.log(`\n${i + 1}. ${p.purchaseNumber}`);
            console.log(`   ID: ${p._id}`);
            console.log(`   Organization: ${p.organizationId || 'NULL/MISSING!'}`);
            console.log(`   Supplier: ${p.supplierName}`);
            console.log(`   Created: ${p.createdAt}`);
        });

        console.log('\n' + '='.repeat(80));

        // Group by purchase number to find duplicates
        const byNumber = {};
        allPurchases.forEach(p => {
            const num = p.purchaseNumber;
            if (!byNumber[num]) {
                byNumber[num] = [];
            }
            byNumber[num].push({
                id: p._id,
                org: p.organizationId ? p.organizationId.toString() : 'NULL'
            });
        });

        console.log('\n🔍 DUPLICATE CHECK:\n');
        let foundDuplicates = false;
        Object.entries(byNumber).forEach(([num, purchases]) => {
            if (purchases.length > 1) {
                console.log(`❌ DUPLICATE: ${num}`);
                purchases.forEach(p => {
                    console.log(`   - ID: ${p.id}, Org: ${p.org}`);
                });
                foundDuplicates = true;
            }
        });

        if (!foundDuplicates) {
            console.log('✅ No duplicate purchase numbers found across all purchases');
        }

        // Check counter state
        console.log('\n' + '='.repeat(80));
        console.log('\n📊 COUNTER STATE:\n');

        const counters = await Counter.find({ type: 'purchase', yearMonth });

        for (const counter of counters) {
            console.log(`Organization: ${counter.organizationId}`);
            console.log(`  Current sequence: ${counter.sequence}`);
            console.log(`  Next number: PUR-${yearMonth}-${String(counter.sequence + 1).padStart(4, '0')}`);

            // Find purchases for this org
            const orgPurchases = allPurchases.filter(p =>
                p.organizationId && p.organizationId.toString() === counter.organizationId.toString()
            );
            console.log(`  Actual purchases: ${orgPurchases.length}`);
            console.log(`  Numbers: ${orgPurchases.map(p => p.purchaseNumber).join(', ')}`);

            // Check if sequence matches
            if (orgPurchases.length !== counter.sequence) {
                console.log(`  ⚠️  MISMATCH! Have ${orgPurchases.length} purchases but counter is at ${counter.sequence}`);
            } else {
                console.log(`  ✅ Counter matches purchase count`);
            }
            console.log('');
        }

        // Check for purchases without counter
        const orgsWithPurchases = [...new Set(allPurchases
            .filter(p => p.organizationId)
            .map(p => p.organizationId.toString())
        )];

        const orgsWithCounters = counters.map(c => c.organizationId.toString());

        orgsWithPurchases.forEach(orgId => {
            if (!orgsWithCounters.includes(orgId)) {
                console.log(`⚠️  Organization ${orgId} has purchases but NO counter!`);
            }
        });

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

checkAllPurchases();
