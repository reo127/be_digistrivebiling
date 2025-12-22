import mongoose from 'mongoose';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

const cleanupDuplicate = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        console.log('Select document type:');
        console.log('1. Purchase');
        console.log('2. Invoice');
        console.log('3. Sales Return');

        const choice = await question('\nEnter your choice (1-3): ');

        let collection, numberField, documentNumber;

        switch (choice.trim()) {
            case '1':
                collection = 'purchases';
                numberField = 'purchaseNumber';
                documentNumber = await question('Enter Purchase Number (e.g., PUR-202512-0001): ');
                break;
            case '2':
                collection = 'invoices';
                numberField = 'invoiceNumber';
                documentNumber = await question('Enter Invoice Number (e.g., INV-202512-0001): ');
                break;
            case '3':
                collection = 'salesreturns';
                numberField = 'creditNoteNumber';
                documentNumber = await question('Enter Credit Note Number (e.g., CN-202512-0001): ');
                break;
            default:
                console.log('❌ Invalid choice!');
                rl.close();
                await mongoose.connection.close();
                process.exit(1);
        }

        const query = {};
        query[numberField] = documentNumber.trim();

        console.log(`\n🔍 Searching for ${documentNumber.trim()} in ${collection}...`);

        const result = await mongoose.connection.db.collection(collection).deleteOne(query);

        if (result.deletedCount > 0) {
            console.log(`\n✅ Successfully deleted ${result.deletedCount} document(s)!`);
            console.log('✅ You can now create the document again.');
        } else {
            console.log(`\n⚠️  No document found with ${numberField}: ${documentNumber.trim()}`);
        }

        rl.close();
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        rl.close();
        process.exit(1);
    }
};

cleanupDuplicate();
