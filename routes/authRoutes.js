import express from 'express';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import generateToken from '../utils/generateToken.js';

const router = express.Router();

// @route   POST /api/auth/signup
// @desc    Register new user and create organization
// @access  Public (or Super Admin only - based on your requirements)
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, organizationName, phone } = req.body;

    const userExists = await User.findOne({ email });

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Check if organization name is taken
    if (organizationName) {
      const orgExists = await Organization.findOne({ organizationName });
      if (orgExists) {
        return res.status(400).json({ message: 'Organization name already taken' });
      }
    }

    // Create organization first
    const organization = await Organization.create({
      organizationName: organizationName || `${name}'s Organization`,
      displayName: organizationName || `${name}'s Organization`,
      email: email,
      phone: phone || '',
      subscriptionStatus: 'trial', // Start with trial
      subscriptionPlan: 'basic',
      shopName: organizationName || `${name}'s Shop`
    });

    // Create user with organization link
    const user = await User.create({
      organizationId: organization._id,
      name,
      email,
      password,
      role: 'owner' // First user is always owner
    });

    if (user) {
      // Populate organization data
      const userWithOrg = await User.findById(user._id)
        .select('-password')
        .populate('organizationId', 'organizationName subscriptionStatus subscriptionPlan features')
        .lean();

      res.status(201).json({
        _id: userWithOrg._id,
        name: userWithOrg.name,
        email: userWithOrg.email,
        role: userWithOrg.role,
        organizationId: userWithOrg.organizationId._id,
        organization: userWithOrg.organizationId,
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/auth/login
// @desc    Auth user & get token
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email })
      .populate('organizationId', 'organizationName subscriptionStatus subscriptionPlan features isActive trialEndsAt demoExpiresAt');

    if (user && (await user.matchPassword(password))) {
      // Check if user is active
      if (!user.isActive) {
        return res.status(403).json({ message: 'User account is inactive' });
      }

      // Check if organization is active (skip for superadmin)
      if (user.role !== 'superadmin' && user.organizationId) {
        if (!user.organizationId.isActive) {
          return res.status(403).json({
            message: 'Organization is inactive. Please contact support.'
          });
        }

        // Check subscription status
        const org = user.organizationId;
        const now = new Date();

        if (org.subscriptionStatus === 'trial' && org.trialEndsAt && org.trialEndsAt < now) {
          return res.status(403).json({
            message: 'Trial period has expired. Please subscribe to continue.',
            code: 'TRIAL_EXPIRED'
          });
        }

        if (org.subscriptionStatus === 'demo' && org.demoExpiresAt && org.demoExpiresAt < now) {
          return res.status(403).json({
            message: 'Demo period has expired.',
            code: 'DEMO_EXPIRED'
          });
        }

        if (org.subscriptionStatus === 'suspended') {
          return res.status(403).json({
            message: 'Organization subscription is suspended. Please contact support.',
            code: 'SUBSCRIPTION_SUSPENDED'
          });
        }

        if (org.subscriptionStatus === 'cancelled') {
          return res.status(403).json({
            message: 'Organization subscription has been cancelled.',
            code: 'SUBSCRIPTION_CANCELLED'
          });
        }
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      const userResponse = user.toObject();
      delete userResponse.password;

      res.json({
        _id: userResponse._id,
        name: userResponse.name,
        email: userResponse.email,
        role: userResponse.role,
        permissions: userResponse.permissions,
        organizationId: userResponse.organizationId?._id,
        organization: userResponse.organizationId,
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
