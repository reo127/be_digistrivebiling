import express from 'express';
import Organization from '../models/Organization.js';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/requireSuperAdmin.js';

const router = express.Router();

// Apply authentication and super admin check to all routes
router.use(protect);
router.use(requireSuperAdmin);

// @route   POST /api/admin/organizations
// @desc    Create new organization with owner user
// @access  Super Admin
router.post('/organizations', async (req, res) => {
    try {
        const {
            organizationName,
            email,
            phone,
            gstin,
            address,
            city,
            state,
            pincode,
            subscriptionPlan,
            subscriptionStatus,
            maxUsers,
            features,
            // Owner details
            ownerName,
            ownerEmail,
            ownerPassword
        } = req.body;

        // Validate owner details
        if (!ownerName || !ownerEmail || !ownerPassword) {
            return res.status(400).json({
                message: 'Owner name, email, and password are required'
            });
        }

        // Check if organization already exists
        const existingOrg = await Organization.findOne({
            $or: [{ organizationName }, { email }]
        });

        if (existingOrg) {
            return res.status(400).json({
                message: 'Organization with this name or email already exists'
            });
        }

        // Check if owner email already exists
        const existingUser = await User.findOne({ email: ownerEmail });
        if (existingUser) {
            return res.status(400).json({
                message: 'User with this email already exists'
            });
        }

        // Create organization
        const organization = await Organization.create({
            organizationName,
            displayName: organizationName,
            email,
            phone,
            gstin,
            address,
            city,
            state,
            pincode,
            subscriptionPlan: subscriptionPlan || 'basic',
            subscriptionStatus: subscriptionStatus || 'trial',
            maxUsers: maxUsers || 5,
            features: features || {
                inventory: true,
                reports: true,
                multiUser: true,
                api: false,
                customBranding: false
            },
            createdBy: req.user._id
        });

        // Create owner user
        const owner = await User.create({
            organizationId: organization._id,
            name: ownerName,
            email: ownerEmail,
            password: ownerPassword, // Will be hashed by User model pre-save hook
            role: 'owner',
            permissions: {
                canCreateInvoice: true,
                canEditInvoice: true,
                canDeleteInvoice: true,
                canViewReports: true,
                canManageInventory: true,
                canManageProducts: true,
                canManageCustomers: true,
                canManageSuppliers: true,
                canManagePurchases: true,
                canManageExpenses: true,
                canManageUsers: true,
                canManageSettings: true
            },
            isActive: true
        });

        res.status(201).json({
            success: true,
            organization,
            owner: {
                _id: owner._id,
                name: owner.name,
                email: owner.email,
                role: owner.role
            },
            message: 'Organization and owner account created successfully'
        });
    } catch (error) {
        console.error('Create organization error:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   GET /api/admin/organizations
// @desc    Get all organizations
// @access  Super Admin
router.get('/organizations', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search,
            status,
            plan
        } = req.query;

        const query = {};

        // Search filter
        if (search) {
            query.$or = [
                { organizationName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        // Status filter
        if (status) {
            query.subscriptionStatus = status;
        }

        // Plan filter
        if (plan) {
            query.subscriptionPlan = plan;
        }

        const total = await Organization.countDocuments(query);
        const organizations = await Organization.find(query)
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .lean();

        // Get user count for each organization
        const orgsWithUserCount = await Promise.all(
            organizations.map(async (org) => {
                const userCount = await User.countDocuments({ organizationId: org._id });
                return {
                    ...org,
                    userCount
                };
            })
        );

        res.json({
            success: true,
            organizations: orgsWithUserCount,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (error) {
        console.error('Get organizations error:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   GET /api/admin/organizations/:id
// @desc    Get single organization
// @access  Super Admin
router.get('/organizations/:id', async (req, res) => {
    try {
        const organization = await Organization.findById(req.params.id)
            .populate('createdBy', 'name email')
            .lean();

        if (!organization) {
            return res.status(404).json({ message: 'Organization not found' });
        }

        // Get users count and list
        const users = await User.find({ organizationId: req.params.id })
            .select('name email role isActive lastLogin')
            .lean();

        res.json({
            success: true,
            organization: {
                ...organization,
                users,
                userCount: users.length
            }
        });
    } catch (error) {
        console.error('Get organization error:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   PUT /api/admin/organizations/:id
// @desc    Update organization
// @access  Super Admin
router.put('/organizations/:id', async (req, res) => {
    try {
        const organization = await Organization.findById(req.params.id);

        if (!organization) {
            return res.status(404).json({ message: 'Organization not found' });
        }

        // Update fields
        const updateFields = [
            'organizationName', 'displayName', 'email', 'phone',
            'gstin', 'pan', 'address', 'city', 'state', 'pincode',
            'subscriptionPlan', 'subscriptionStatus', 'maxUsers',
            'features', 'shopName', 'shopAddress', 'shopGstin', 'notes'
        ];

        updateFields.forEach(field => {
            if (req.body[field] !== undefined) {
                organization[field] = req.body[field];
            }
        });

        await organization.save();

        res.json({
            success: true,
            organization
        });
    } catch (error) {
        console.error('Update organization error:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   PATCH /api/admin/organizations/:id/status
// @desc    Update organization subscription status
// @access  Super Admin
router.patch('/organizations/:id/status', async (req, res) => {
    try {
        const { subscriptionStatus } = req.body;

        if (!['demo', 'trial', 'active', 'suspended', 'cancelled'].includes(subscriptionStatus)) {
            return res.status(400).json({ message: 'Invalid subscription status' });
        }

        const organization = await Organization.findById(req.params.id);

        if (!organization) {
            return res.status(404).json({ message: 'Organization not found' });
        }

        organization.subscriptionStatus = subscriptionStatus;

        // Set dates based on status
        if (subscriptionStatus === 'active' && !organization.subscriptionStartDate) {
            organization.subscriptionStartDate = new Date();
        }

        await organization.save();

        res.json({
            success: true,
            organization
        });
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   DELETE /api/admin/organizations/:id
// @desc    Delete organization (soft delete - set isActive to false)
// @access  Super Admin
router.delete('/organizations/:id', async (req, res) => {
    try {
        const organization = await Organization.findById(req.params.id);

        if (!organization) {
            return res.status(404).json({ message: 'Organization not found' });
        }

        // Soft delete - just deactivate
        organization.isActive = false;
        organization.subscriptionStatus = 'cancelled';
        await organization.save();

        // Also deactivate all users
        await User.updateMany(
            { organizationId: req.params.id },
            { isActive: false }
        );

        res.json({
            success: true,
            message: 'Organization deactivated successfully'
        });
    } catch (error) {
        console.error('Delete organization error:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   GET /api/admin/organizations/:id/users
// @desc    Get all users of an organization
// @access  Super Admin
router.get('/organizations/:id/users', async (req, res) => {
    try {
        const users = await User.find({ organizationId: req.params.id })
            .select('-password')
            .sort({ createdAt: -1 })
            .lean();

        res.json({
            success: true,
            users
        });
    } catch (error) {
        console.error('Get organization users error:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   POST /api/admin/organizations/:id/users
// @desc    Add user to organization (Super Admin)
// @access  Super Admin
router.post('/organizations/:id/users', async (req, res) => {
    try {
        const { name, email, password, role, permissions } = req.body;

        // Check if organization exists
        const organization = await Organization.findById(req.params.id);
        if (!organization) {
            return res.status(404).json({ message: 'Organization not found' });
        }

        // Check if organization can add more users
        const canAddMore = await organization.canAddMoreUsers();
        if (!canAddMore) {
            return res.status(400).json({
                message: `Maximum user limit (${organization.maxUsers}) reached. Please upgrade the plan.`
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }

        // Create user
        const user = await User.create({
            organizationId: req.params.id,
            name,
            email,
            password,
            role: role || 'staff',
            permissions: permissions || {},
            isActive: true
        });

        // Remove password from response
        const userResponse = user.toObject();
        delete userResponse.password;

        res.status(201).json({
            success: true,
            user: userResponse,
            message: 'User created successfully'
        });
    } catch (error) {
        console.error('Add user error:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   GET /api/admin/organizations/:id/stats
// @desc    Get organization statistics
// @access  Super Admin
router.get('/organizations/:id/stats', async (req, res) => {
    try {
        const Invoice = (await import('../models/Invoice.js')).default;
        const Product = (await import('../models/Product.js')).default;
        const Customer = (await import('../models/Customer.js')).default;

        const [
            userCount,
            invoiceCount,
            productCount,
            customerCount,
            totalRevenue
        ] = await Promise.all([
            User.countDocuments({ organizationId: req.params.id }),
            Invoice.countDocuments({ organizationId: req.params.id }),
            Product.countDocuments({ organizationId: req.params.id }),
            Customer.countDocuments({ organizationId: req.params.id }),
            Invoice.aggregate([
                { $match: { organizationId: req.params.id } },
                { $group: { _id: null, total: { $sum: '$grandTotal' } } }
            ])
        ]);

        res.json({
            success: true,
            stats: {
                userCount,
                invoiceCount,
                productCount,
                customerCount,
                totalRevenue: totalRevenue[0]?.total || 0
            }
        });
    } catch (error) {
        console.error('Get organization stats error:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   GET /api/admin/dashboard/stats
// @desc    Get platform-wide statistics
// @access  Super Admin
router.get('/dashboard/stats', async (req, res) => {
    try {
        const [
            totalOrgs,
            activeOrgs,
            trialOrgs,
            demoOrgs,
            totalUsers
        ] = await Promise.all([
            Organization.countDocuments(),
            Organization.countDocuments({ subscriptionStatus: 'active', isActive: true }),
            Organization.countDocuments({ subscriptionStatus: 'trial', isActive: true }),
            Organization.countDocuments({ subscriptionStatus: 'demo', isActive: true }),
            User.countDocuments({ role: { $ne: 'superadmin' } })
        ]);

        // Get recent organizations
        const recentOrgs = await Organization.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .select('organizationName email subscriptionStatus createdAt')
            .lean();

        res.json({
            success: true,
            stats: {
                totalOrganizations: totalOrgs,
                activeOrganizations: activeOrgs,
                trialOrganizations: trialOrgs,
                demoOrganizations: demoOrgs,
                totalUsers,
                recentOrganizations: recentOrgs
            }
        });
    } catch (error) {
        console.error('Get dashboard stats error:', error);
        res.status(500).json({ message: error.message });
    }
});

export default router;
