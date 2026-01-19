import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from './models/Invoice.js';

dotenv.config();

const checkIndexDetails = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const indexInfo = await Invoice.collection.indexInformation();
  
  console.log('\n📋 DETAILED INDEX INFORMATION:\n');
  for (const [indexName, indexDef] of Object.entries(indexInfo)) {
    console.log(`Index: ${indexName}`);
    console.log(JSON.stringify(indexDef, null, 2));
    console.log('─'.repeat(50));
  }
  
  await mongoose.connection.close();
  process.exit(0);
};

checkIndexDetails();
