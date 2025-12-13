import express from 'express';
import Payment from '../models/Payment.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Invoice from '../models/Invoice.js';
import Purchase from '../models/Purchase.js';
import { protect } from '../middleware/auth.js';
import { postPaymentToLedger } from '../utils/ledgerHelper.js';

const router = express.Router();

// @route   GET /api/payments
// @desc    Get all payments
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { startDate, endDate, type, partyType } = req.query;
    let query = { userId: req.user._id };

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (type) query.type = type;
    if (partyType) query.partyType = partyType;

    const payments = await Payment.find(query)
      .populate('party')
      .sort({ date: -1 });

    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/payments/stats
// @desc    Get payment statistics
// @access  Private
router.get('/stats', protect, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayReceived, todayPaid, totalReceived, totalPaid] = await Promise.all([
      Payment.aggregate([
        {
          $match: {
            userId: req.user._id,
            type: 'RECEIVED',
            date: { $gte: today }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' }
          }
        }
      ]),
      Payment.aggregate([
        {
          $match: {
            userId: req.user._id,
            type: 'PAID',
            date: { $gte: today }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' }
          }
        }
      ]),
      Payment.aggregate([
        {
          $match: {
            userId: req.user._id,
            type: 'RECEIVED'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' }
          }
        }
      ]),
      Payment.aggregate([
        {
          $match: {
            userId: req.user._id,
            type: 'PAID'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' }
          }
        }
      ])
    ]);

    res.json({
      todayReceived: todayReceived[0]?.total || 0,
      todayPaid: todayPaid[0]?.total || 0,
      totalReceived: totalReceived[0]?.total || 0,
      totalPaid: totalPaid[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/payments/:id
// @desc    Get single payment
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const payment = await Payment.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('party');

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    res.json(payment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/payments
// @desc    Create payment (received or paid)
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const {
      type,
      partyType,
      party: partyId,
      amount,
      paymentMethod,
      referenceType,
      referenceId,
      ...paymentData
    } = req.body;

    // Validate party
    const PartyModel = partyType === 'CUSTOMER' ? Customer : Supplier;
    const party = await PartyModel.findOne({
      _id: partyId,
      userId: req.user._id
    });

    if (!party) {
      return res.status(404).json({ message: `${partyType} not found` });
    }

    // Get reference document details if provided
    let referenceNumber = '';
    if (referenceType && referenceId) {
      const ReferenceModel = referenceType === 'INVOICE' ? Invoice : Purchase;
      const reference = await ReferenceModel.findById(referenceId);
      if (reference) {
        referenceNumber = reference.invoiceNumber || reference.purchaseNumber;
      }
    }

    // Create payment
    const payment = await Payment.create({
      ...paymentData,
      userId: req.user._id,
      type,
      partyType,
      party: partyId,
      partyModel: partyType === 'CUSTOMER' ? 'Customer' : 'Supplier',
      partyName: party.name,
      amount,
      paymentMethod,
      referenceType,
      referenceId,
      referenceModel: referenceType === 'INVOICE' ? 'Invoice' : (referenceType === 'PURCHASE' ? 'Purchase' : undefined),
      referenceNumber
    });

    // Update party balance
    if (type === 'RECEIVED') {
      // Received from customer - reduce outstanding
      if (partyType === 'CUSTOMER') {
        party.outstandingBalance = Math.max(0, party.outstandingBalance - amount);
      }
    } else {
      // Paid to supplier - reduce payable
      if (partyType === 'SUPPLIER') {
        party.currentBalance = Math.max(0, party.currentBalance - amount);
      }
    }
    await party.save();

    // Update invoice/purchase payment status if referenced
    if (referenceId && referenceType) {
      const ReferenceModel = referenceType === 'INVOICE' ? Invoice : Purchase;
      const reference = await ReferenceModel.findById(referenceId);

      if (reference) {
        const newPaidAmount = reference.paidAmount + amount;
        const newBalance = reference.grandTotal - newPaidAmount;

        reference.paidAmount = newPaidAmount;
        reference.balanceAmount = newBalance;
        reference.paymentStatus = newBalance <= 0 ? 'PAID' : (newPaidAmount > 0 ? 'PARTIAL' : 'UNPAID');

        await reference.save();
      }
    }

    // Post to ledger
    const ledgerEntries = await postPaymentToLedger(payment, req.user._id);
    payment.ledgerEntries = ledgerEntries.map(entry => entry._id);
    await payment.save();

    res.status(201).json(payment);
  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE /api/payments/:id
// @desc    Delete payment
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const payment = await Payment.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    // Note: In production, you should also reverse ledger entries and party balances
    return res.status(400).json({
      message: 'Payment deletion not allowed for accounting integrity. Please create an adjustment entry instead.'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
