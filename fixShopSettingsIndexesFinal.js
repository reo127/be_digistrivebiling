import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const fixShopSettingsIndexes = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');

    const db = mongoose.connection.db;
    const collection = db.collection('shopsettings');

    // Get existing indexes
    console.log('\n📋 Current ShopSettings Indexes:');
    const indexes = await collection.indexes();
    indexes.forEach(index => {
      console.log(`  - ${index.name}:`, JSON.stringify(index.key), index.unique ? '(UNIQUE)' : '');
    });

    // Drop non-unique organizationId index
    try {
      console.log('\n🗑️  Dropping non-unique index: organizationId_1');
      await collection.dropIndex('organizationId_1');
      console.log('✅ Successfully dropped organizationId_1');
    } catch (error) {
      if (error.code === 27) {
        console.log('ℹ️  Index does not exist');
      } else {
        console.log('❌ Error dropping index:', error.message);
      }
    }

    // Create new unique organizationId index
    try {
      console.log('\n✨ Creating new UNIQUE index: organizationId_1');
      await collection.createIndex(
        { organizationId: 1 },
        { unique: true }
      );
      console.log('✅ Successfully created organizationId unique index');
    } catch (error) {
      console.log('❌ Error creating index:', error.message);
    }

    // Verify new indexes
    console.log('\n📋 Updated ShopSettings Indexes:');
    const updatedIndexes = await collection.indexes();
    updatedIndexes.forEach(index => {
      console.log(`  - ${index.name}:`, JSON.stringify(index.key), index.unique ? '(UNIQUE)' : '');
    });

    console.log('\n✅ ShopSettings index fix complete!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed');
    process.exit(0);
  }
};

fixShopSettingsIndexes();
