import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const fixExpenseIndexes = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');

    const db = mongoose.connection.db;
    const collection = db.collection('expenses');

    // Get existing indexes
    console.log('\n📋 Current Expense Indexes:');
    const indexes = await collection.indexes();
    indexes.forEach(index => {
      console.log(`  - ${index.name}:`, JSON.stringify(index.key));
    });

    // Drop old global unique index
    try {
      console.log('\n🗑️  Dropping old global unique index: expenseNumber_1');
      await collection.dropIndex('expenseNumber_1');
      console.log('✅ Successfully dropped expenseNumber_1');
    } catch (error) {
      if (error.code === 27) {
        console.log('ℹ️  Index expenseNumber_1 does not exist (already dropped or never created)');
      } else {
        console.log('❌ Error dropping index:', error.message);
      }
    }

    // Create new compound unique index
    try {
      console.log('\n✨ Creating new compound unique index: organizationId_1_expenseNumber_1');
      await collection.createIndex(
        { organizationId: 1, expenseNumber: 1 },
        { unique: true, name: 'organizationId_1_expenseNumber_1_unique' }
      );
      console.log('✅ Successfully created compound unique index');
    } catch (error) {
      console.log('❌ Error creating index:', error.message);
    }

    // Verify new indexes
    console.log('\n📋 Updated Expense Indexes:');
    const updatedIndexes = await collection.indexes();
    updatedIndexes.forEach(index => {
      console.log(`  - ${index.name}:`, JSON.stringify(index.key));
    });

    console.log('\n✅ Expense index fix complete!');
    console.log('🔄 Please restart the backend server now.');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed');
    process.exit(0);
  }
};

fixExpenseIndexes();
