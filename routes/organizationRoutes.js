import express from 'express';
import Organization from '../models/Organization.js';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';
import { requireOwner } from '../middleware/requireSuperAdmin.js';
import tenantIsolation from '../middleware/tenantIsolation.js';

const router = express.Router();

// Apply authentication to all routes
router.use(protect);
router.use(tenantIsolation);

// @route   GET /api/organization/settings
// @desc    Get current organization settings
// @access  Owner/Staff
router.get('/settings', async (req, res) => {
    try {
        if (!req.organizationId) {
            return res.status(400).json({ message: 'No organization context' });
        }

        const organization = await Organization.findById(req.organizationId).lean();

        if (!organization) {
            return res.status(404).json({ message: 'Organization not found' });
        }

        res.json({
            success: true,
            organization
        });
    } catch (error) {
        console.error('Get organization settings error:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   PUT /api/organization/settings
// @desc    Update organization settings
// @access  Owner only
router.put('/settings', requireOwner, async (req, res) => {
    try {
        if (!req.organizationId) {
            return res.status(400).json({ message: 'No organization context' });
        }

        const organization = await Organization.findById(req.organizationId);

        if (!organization) {
            return res.status(404).json({ message: 'Organization not found' });
        }

        // Fields that owner can update
        const allowedFields = [
            'displayName', 'phone', 'gstin', 'pan',
            'address', 'city', 'state', 'pincode',
            'shopName', 'shopAddress', 'shopCity', 'shopState',
            'shopPincode', 'shopPhone', 'shopEmail', 'shopGstin'
        ];

        allowedFields.forEach(field => {
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
        console.error('Update organization settings error:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   GET /api/organization/users
// @desc    Get all users in organization
// @access  Owner only
router.get('/users', requireOwner, async (req, res) => {
    try {
        if (!req.organizationId) {
            return res.status(400).json({ message: 'No organization context' });
        }

        const users = await User.find({ organizationId: req.organizationId })
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

// @route   POST /api/organization/users
// @desc    Add user to organization
// @access  Owner only
router.post('/users', requireOwner, async (req, res) => {
    try {
        if (!req.organizationId) {
            return res.status(400).json({ message: 'No organization context' });
        }

        const { name, email, password, role, permissions } = req.body;

        // Check if organization can add more users
        const organization = await Organization.findById(req.organizationId);
        const canAddMore = await organization.canAddMoreUsers();

        if (!canAddMore) {
            return res.status(400).json({
                message: `Maximum user limit (${organization.maxUsers}) reached. Please upgrade your plan.`
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }

        // Create user
        const user = await User.create({
            organizationId: req.organizationId,
            name,
            email,
            password,
            role: role || 'staff',
            permissions: permissions || {}
        });

        // Remove password from response
        const userResponse = user.toObject();
        delete userResponse.password;

        res.status(201).json({
            success: true,
            user: userResponse
        });
    } catch (error) {
        console.error('Add user error:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   PUT /api/organization/users/:id
// @desc    Update user in organization
// @access  Owner only
router.put('/users/:id', requireOwner, async (req, res) => {
    try {
        if (!req.organizationId) {
            return res.status(400).json({ message: 'No organization context' });
        }

        const user = await User.findOne({
            _id: req.params.id,
            organizationId: req.organizationId
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Prevent changing superadmin
        if (user.role === 'superadmin') {
            return res.status(403).json({ message: 'Cannot modify superadmin user' });
        }

        // Update allowed fields
        const allowedFields = ['name', 'role', 'permissions', 'isActive'];

        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                user[field] = req.body[field];
            }
        });

        await user.save();

        const userResponse = user.toObject();
        delete userResponse.password;

        res.json({
            success: true,
            user: userResponse
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   DELETE /api/organization/users/:id
// @desc    Remove user from organization (soft delete)
// @access  Owner only
router.delete('/users/:id', requireOwner, async (req, res) => {
    try {
        if (!req.organizationId) {
            return res.status(400).json({ message: 'No organization context' });
        }

        const user = await User.findOne({
            _id: req.params.id,
            organizationId: req.organizationId
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Prevent deleting superadmin
        if (user.role === 'superadmin') {
            return res.status(403).json({ message: 'Cannot delete superadmin user' });
        }

        // Prevent owner from deleting themselves
        if (user._id.toString() === req.user._id.toString()) {
            return res.status(400).json({ message: 'Cannot delete your own account' });
        }

        // Soft delete - just deactivate
        user.isActive = false;
        await user.save();

        res.json({
            success: true,
            message: 'User deactivated successfully'
        });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ message: error.message });
    }
});

// @route   GET /api/organization/subscription
// @desc    Get organization subscription details
// @access  Owner/Staff
router.get('/subscription', async (req, res) => {
    try {
        if (!req.organizationId) {
            return res.status(400).json({ message: 'No organization context' });
        }

        const organization = await Organization.findById(req.organizationId)
            .select('subscriptionStatus subscriptionPlan subscriptionStartDate subscriptionEndDate trialEndsAt demoExpiresAt billingCycle maxUsers features')
            .lean();

        if (!organization) {
            return res.status(404).json({ message: 'Organization not found' });
        }

        // Get current user count
        const userCount = await User.countDocuments({ organizationId: req.organizationId });

        res.json({
            success: true,
            subscription: {
                ...organization,
                currentUserCount: userCount
            }
        });
    } catch (error) {
        console.error('Get subscription error:', error);
        res.status(500).json({ message: error.message });
    }
});

export default router;
