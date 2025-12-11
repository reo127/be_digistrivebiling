import express from 'express';
import ShopSettings from '../models/ShopSettings.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// @route   GET /api/shop
// @desc    Get shop settings
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const settings = await ShopSettings.findOne({ userId: req.user._id });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/shop
// @desc    Create or update shop settings
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    let settings = await ShopSettings.findOne({ userId: req.user._id });

    if (settings) {
      // Update existing
      settings = await ShopSettings.findOneAndUpdate(
        { userId: req.user._id },
        { ...req.body, userId: req.user._id },
        { new: true, runValidators: true }
      );
    } else {
      // Create new
      settings = await ShopSettings.create({
        ...req.body,
        userId: req.user._id
      });
    }

    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
