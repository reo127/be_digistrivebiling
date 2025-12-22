import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Counter from './models/Counter.js';

dotenv.config();

const testCounter = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB Connected\n');

        const orgId = new mongoose.Types.ObjectId('6944f3f423234e50fa452131');
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const yearMonth = `${year}${month}`;

        console.log('🧪 Testing Counter.getNextSequence()...\n');
        console.log(`Organization: ${orgId}`);
        console.log(`Type: purchase`);
        console.log(`YearMonth: ${yearMonth}\n`);

        // Get current state
        const before = await Counter.findOne({
            organizationId: orgId,
            type: 'purchase',
            yearMonth
        });

        console.log('BEFORE:');
        console.log(`  Sequence: ${before ? before.sequence : 'NOT FOUND'}`);
        console.log(`  Next should be: ${before ? before.sequence + 1 : 1}\n`);

        // Test getNextSequence
        console.log('Calling Counter.getNextSequence()...');
        const nextSeq = await Counter.getNextSequence(orgId, 'purchase', yearMonth);
        console.log(`  Returned: ${nextSeq}`);
        console.log(`  Expected purchase number: PUR-${yearMonth}-${String(nextSeq).padStart(4, '0')}\n`);

        // Check after
        const after = await Counter.findOne({
            organizationId: orgId,
            type: 'purchase',
            yearMonth
        });

        console.log('AFTER:');
        console.log(`  Sequence: ${after.sequence}`);
        console.log(`  Next will be: ${after.sequence + 1}\n`);

        // Check if it incremented correctly
        if (before && after.sequence === before.sequence + 1) {
            console.log('✅ Counter incremented correctly!');
        } else {
            console.log('❌ Counter did NOT increment correctly!');
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

testCounter();
