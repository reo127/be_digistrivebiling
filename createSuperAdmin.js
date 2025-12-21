import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';
import Organization from './models/Organization.js';
import bcrypt from 'bcryptjs';

dotenv.config();

const createSuperAdmin = async () => {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        // Superadmin details - CHANGE THESE!
        const superAdminData = {
            name: 'Super Admin',
            email: '64rohanmalo@gmail.com',
            password: 'adminmmmmmmmm', // CHANGE THIS PASSWORD!
        };

        // Check if superadmin already exists
        const existingAdmin = await User.findOne({ email: superAdminData.email });
        if (existingAdmin) {
            console.log('❌ Superadmin with this email already exists!');
            console.log('Email:', existingAdmin.email);
            console.log('Role:', existingAdmin.role);

            // Update to superadmin if not already
            if (existingAdmin.role !== 'superadmin') {
                existingAdmin.role = 'superadmin';
                await existingAdmin.save();
                console.log('✅ Updated existing user to superadmin role');
            }

            process.exit(0);
        }

        // Create a platform organization for superadmin
        const platformOrg = await Organization.create({
            organizationName: 'Platform Administration',
            displayName: 'Platform Administration',
            email: superAdminData.email,
            subscriptionStatus: 'active',
            subscriptionPlan: 'premium',
            shopName: 'Digibilling Platform',
            isActive: true
        });

        console.log('✅ Created platform organization');

        // Create superadmin user
        const superAdmin = await User.create({
            organizationId: platformOrg._id,
            name: superAdminData.name,
            email: superAdminData.email,
            password: superAdminData.password,
            role: 'superadmin',
            isActive: true
        });

        console.log('\n🎉 Superadmin created successfully!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📧 Email:', superAdmin.email);
        console.log('🔑 Password:', superAdminData.password);
        console.log('👤 Role:', superAdmin.role);
        console.log('🏢 Organization:', platformOrg.organizationName);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n⚠️  IMPORTANT: Change the password after first login!');
        console.log('\n✅ You can now login at: http://localhost:3000/login');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error creating superadmin:', error.message);
        process.exit(1);
    }
};

createSuperAdmin();
