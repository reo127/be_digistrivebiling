import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Fetch user with organization populated
      req.user = await User.findById(decoded.id)
        .select('-password')
        .populate('organizationId', 'organizationName subscriptionStatus features isActive trialEndsAt demoExpiresAt')
        .lean();

      if (!req.user) {
        return res.status(401).json({ message: 'User not found' });
      }

      // Check if user is active
      if (!req.user.isActive) {
        return res.status(403).json({ message: 'User account is inactive' });
      }

      // Check if organization is active (skip for superadmin)
      if (req.user.role !== 'superadmin' && req.user.organizationId) {
        if (!req.user.organizationId.isActive) {
          return res.status(403).json({
            message: 'Organization is inactive. Please contact support.'
          });
        }

        // Check subscription status
        const org = req.user.organizationId;
        const now = new Date();

        if (org.subscriptionStatus === 'trial' && org.trialEndsAt && org.trialEndsAt < now) {
          return res.status(403).json({
            message: 'Trial period has expired. Please subscribe to continue.'
          });
        }

        if (org.subscriptionStatus === 'demo' && org.demoExpiresAt && org.demoExpiresAt < now) {
          return res.status(403).json({
            message: 'Demo period has expired.'
          });
        }

        if (org.subscriptionStatus === 'suspended') {
          return res.status(403).json({
            message: 'Organization subscription is suspended. Please contact support.'
          });
        }

        if (org.subscriptionStatus === 'cancelled') {
          return res.status(403).json({
            message: 'Organization subscription has been cancelled.'
          });
        }
      }

      next();
    } catch (error) {
      console.error(error);
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};
