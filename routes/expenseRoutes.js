import express from 'express';
import Expense from '../models/Expense.js';
import { protect } from '../middleware/auth.js';
import { calculateGST } from '../utils/gstCalculations.js';
import { postExpenseToLedger } from '../utils/ledgerHelper.js';

const router = express.Router();

// @route   GET /api/expenses
// @desc    Get all expenses
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;
    let query = { userId: req.user._id };

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (category) query.category = category;

    const expenses = await Expense.find(query).sort({ date: -1 });

    res.json(expenses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/expenses/stats
// @desc    Get expense statistics
// @access  Private
router.get('/stats', protect, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    const [todayExpenses, monthExpenses, categoryWise] = await Promise.all([
      Expense.aggregate([
        {
          $match: {
            userId: req.user._id,
            date: { $gte: today }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$totalAmount' }
          }
        }
      ]),
      Expense.aggregate([
        {
          $match: {
            userId: req.user._id,
            date: { $gte: thisMonth }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$totalAmount' }
          }
        }
      ]),
      Expense.aggregate([
        {
          $match: { userId: req.user._id }
        },
        {
          $group: {
            _id: '$category',
            total: { $sum: '$totalAmount' },
            count: { $sum: 1 }
          }
        },
        {
          $sort: { total: -1 }
        }
      ])
    ]);

    res.json({
      todayExpenses: todayExpenses[0]?.total || 0,
      monthExpenses: monthExpenses[0]?.total || 0,
      categoryWise
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/expenses/:id
// @desc    Get single expense
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    res.json(expense);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/expenses
// @desc    Create expense
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const { amount, isGSTApplicable, gstRate, ...expenseData } = req.body;

    let gstAmount = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    let totalAmount = amount;

    // Calculate GST if applicable
    if (isGSTApplicable && gstRate) {
      const gstCalc = calculateGST(amount, gstRate, 'CGST_SGST'); // Default to CGST/SGST
      gstAmount = gstCalc.totalTax;
      cgst = gstCalc.cgst;
      sgst = gstCalc.sgst;
      igst = gstCalc.igst;
      totalAmount = amount + gstAmount;
    }

    const expense = await Expense.create({
      ...expenseData,
      userId: req.user._id,
      organizationId: req.organizationId || req.user.organizationId,
      amount,
      isGSTApplicable: isGSTApplicable || false,
      gstRate: gstRate || 0,
      gstAmount,
      cgst,
      sgst,
      igst,
      totalAmount
    });

    // Post to ledger
    const ledgerEntries = await postExpenseToLedger(expense, req.user._id, req.organizationId || req.user.organizationId);
    expense.ledgerEntries = ledgerEntries.map(entry => entry._id);
    await expense.save();

    res.status(201).json(expense);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/expenses/:id
// @desc    Update expense
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    // Recalculate GST if amount or rate changed
    if (req.body.amount || req.body.gstRate !== undefined) {
      const amount = req.body.amount || expense.amount;
      const isGSTApplicable = req.body.isGSTApplicable ?? expense.isGSTApplicable;
      const gstRate = req.body.gstRate ?? expense.gstRate;

      if (isGSTApplicable && gstRate) {
        const gstCalc = calculateGST(amount, gstRate, 'CGST_SGST');
        expense.gstAmount = gstCalc.totalTax;
        expense.cgst = gstCalc.cgst;
        expense.sgst = gstCalc.sgst;
        expense.igst = gstCalc.igst;
        expense.totalAmount = amount + gstCalc.totalTax;
      } else {
        expense.totalAmount = amount;
        expense.gstAmount = 0;
        expense.cgst = 0;
        expense.sgst = 0;
        expense.igst = 0;
      }
    }

    // Update other fields
    Object.keys(req.body).forEach(key => {
      if (key !== 'userId' && key !== 'ledgerEntries' && key !== 'expenseNumber') {
        expense[key] = req.body[key];
      }
    });

    await expense.save();

    res.json(expense);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE /api/expenses/:id
// @desc    Delete expense
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    // Note: In production, you should also reverse ledger entries
    await expense.deleteOne();

    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
