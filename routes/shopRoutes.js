import express from 'express';
import ShopSettings from '../models/ShopSettings.js';
import { protect } from '../middleware/auth.js';
import { tenantIsolation, addOrgFilter } from '../middleware/tenantIsolation.js';

const router = express.Router();

router.use('/public', (req, res, next) => next()); // Skip auth for public routes
router.use(protect);
router.use(tenantIsolation);

// @route   GET /api/shop/public/name
// @desc    Get shop name (public access for login/signup pages)
// @access  Public
router.get('/public/name', async (req, res) => {
  try {
    // Get the first shop settings (assuming single shop)
    const settings = await ShopSettings.findOne().select('shopName');
    res.json({ shopName: settings?.shopName || 'Billing Software' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/shop
// @desc    Get shop settings
// @access  Private
router.get('/', async (req, res) => {
  try {
    const settings = await ShopSettings.findOne({ organizationId: req.organizationId });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/shop
// @desc    Create or update shop settings
// @access  Private
router.post('/', async (req, res) => {
  try {
    let settings = await ShopSettings.findOne({ organizationId: req.organizationId });

    if (settings) {
      // Update existing
      settings = await ShopSettings.findOneAndUpdate(
        { organizationId: req.organizationId },
        { ...req.body, organizationId: req.organizationId },
        { new: true, runValidators: true }
      );
    } else {
      // Create new
      settings = await ShopSettings.create({
        ...req.body,
        organizationId: req.organizationId
      });
    }

    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
