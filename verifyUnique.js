import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const verify = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const db = mongoose.connection.db;
  const indexes = await db.collection('invoices').indexes();
  
  console.log('\n📋 RAW INDEX DATA:\n');
  indexes.forEach(idx => {
    console.log(JSON.stringify(idx, null, 2));
    console.log('─'.repeat(50));
  });
  
  await mongoose.connection.close();
  process.exit(0);
};

verify();
