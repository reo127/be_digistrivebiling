import express from 'express';
import Invoice from '../models/Invoice.js';
import ShopSettings from '../models/ShopSettings.js';
import { protect } from '../middleware/auth.js';
import { generateGSTR1, generateGSTR1JSON, generateGSTR1CSV } from '../utils/gstr1Generator.js';
import { generateGSTR3B, generateGSTR3BJSON, generateGSTR3BSummary } from '../utils/gstr3bGenerator.js';
import { generateProfitLoss, generateBalanceSheet, generateMonthwisePL } from '../utils/financialReports.js';
import { generateEWayBill, generateBulkEWayBills, generateEWayBillCSV } from '../utils/ewayBillGenerator.js';

const router = express.Router();

// ==================== GSTR-1 ROUTES ====================

// @route   GET /api/reports/gstr1
// @desc    Generate GSTR-1 report
// @access  Private
router.get('/gstr1', protect, async (req, res) => {
  try {
    const { startDate, endDate, format = 'json' } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    const shopSettings = await ShopSettings.findOne({ userId: req.user._id });
    if (!shopSettings) {
      return res.status(400).json({ message: 'Shop settings not configured' });
    }

    const gstr1Data = await generateGSTR1(
      req.user._id,
      new Date(startDate),
      new Date(endDate),
      shopSettings.gstin
    );

    if (format === 'csv') {
      const csv = generateGSTR1CSV(gstr1Data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=GSTR1_${startDate}_${endDate}.csv`);
      return res.send(csv);
    } else if (format === 'gst-json') {
      const gstJson = generateGSTR1JSON(gstr1Data);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=GSTR1_${startDate}_${endDate}.json`);
      return res.json(gstJson);
    }

    res.json(gstr1Data);
  } catch (error) {
    console.error('GSTR-1 generation error:', error);
    res.status(500).json({ message: error.message });
  }
});

// ==================== GSTR-3B ROUTES ====================

// @route   GET /api/reports/gstr3b
// @desc    Generate GSTR-3B computation
// @access  Private
router.get('/gstr3b', protect, async (req, res) => {
  try {
    const { month, year, format = 'json' } = req.query;

    if (!month || !year) {
      return res.status(400).json({ message: 'Month and year are required' });
    }

    const shopSettings = await ShopSettings.findOne({ userId: req.user._id });
    if (!shopSettings) {
      return res.status(400).json({ message: 'Shop settings not configured' });
    }

    // Calculate month range
    const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
    const endDate = new Date(parseInt(year), parseInt(month), 0);

    const gstr3bData = await generateGSTR3B(
      req.user._id,
      startDate,
      endDate,
      shopSettings.gstin
    );

    if (format === 'gst-json') {
      const gstJson = generateGSTR3BJSON(gstr3bData);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=GSTR3B_${month}_${year}.json`);
      return res.json(gstJson);
    } else if (format === 'summary') {
      const summary = generateGSTR3BSummary(gstr3bData);
      return res.json(summary);
    }

    res.json(gstr3bData);
  } catch (error) {
    console.error('GSTR-3B generation error:', error);
    res.status(500).json({ message: error.message });
  }
});

// ==================== P&L STATEMENT ROUTES ====================

// @route   GET /api/reports/profit-loss
// @desc    Generate Profit & Loss Statement
// @access  Private
router.get('/profit-loss', protect, async (req, res) => {
  try {
    const { startDate, endDate, type = 'period' } = req.query;

    if (type === 'monthwise' && req.query.year) {
      // Month-wise comparison for a year
      const monthwisePL = await generateMonthwisePL(req.user._id, parseInt(req.query.year));
      return res.json(monthwisePL);
    }

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    const plStatement = await generateProfitLoss(
      req.user._id,
      new Date(startDate),
      new Date(endDate)
    );

    res.json(plStatement);
  } catch (error) {
    console.error('P&L generation error:', error);
    res.status(500).json({ message: error.message });
  }
});

// ==================== BALANCE SHEET ROUTES ====================

// @route   GET /api/reports/balance-sheet
// @desc    Generate Balance Sheet
// @access  Private
router.get('/balance-sheet', protect, async (req, res) => {
  try {
    const { asOnDate } = req.query;

    const date = asOnDate ? new Date(asOnDate) : new Date();

    const balanceSheet = await generateBalanceSheet(req.user._id, date);

    res.json(balanceSheet);
  } catch (error) {
    console.error('Balance Sheet generation error:', error);
    res.status(500).json({ message: error.message });
  }
});

// ==================== E-WAY BILL ROUTES ====================

// @route   GET /api/reports/eway-bill/:invoiceId
// @desc    Generate E-Way Bill for a single invoice
// @access  Private
router.get('/eway-bill/:invoiceId', protect, async (req, res) => {
  try {
    const { format = 'json' } = req.query;

    const invoice = await Invoice.findOne({
      _id: req.params.invoiceId,
      userId: req.user._id
    });

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const shopSettings = await ShopSettings.findOne({ userId: req.user._id });
    if (!shopSettings) {
      return res.status(400).json({ message: 'Shop settings not configured' });
    }

    const ewayBill = generateEWayBill(invoice, shopSettings);

    if (format === 'csv') {
      const csv = generateEWayBillCSV(ewayBill);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=EWayBill_${invoice.invoiceNumber}.csv`);
      return res.send(csv);
    }

    res.json(ewayBill);
  } catch (error) {
    console.error('E-Way Bill generation error:', error);
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/reports/eway-bill-bulk
// @desc    Generate E-Way Bills for multiple invoices
// @access  Private
router.get('/eway-bill-bulk', protect, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    const shopSettings = await ShopSettings.findOne({ userId: req.user._id });
    if (!shopSettings) {
      return res.status(400).json({ message: 'Shop settings not configured' });
    }

    const invoices = await Invoice.find({
      userId: req.user._id,
      invoiceDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
      eWayBillRequired: true
    });

    const bulkEWayBills = generateBulkEWayBills(invoices, shopSettings);

    res.json(bulkEWayBills);
  } catch (error) {
    console.error('Bulk E-Way Bill generation error:', error);
    res.status(500).json({ message: error.message });
  }
});

// ==================== GENERAL LEDGER ROUTES ====================

// @route   GET /api/reports/ledger/:account
// @desc    Get ledger for a specific account
// @access  Private
router.get('/ledger/:account', protect, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const Ledger = (await import('../models/Ledger.js')).default;

    const query = {
      userId: req.user._id,
      account: req.params.account
    };

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const entries = await Ledger.find(query)
      .sort({ date: 1, createdAt: 1 })
      .populate('partyId');

    // Calculate running balance
    let balance = 0;
    const entriesWithBalance = entries.map(entry => {
      if (entry.type === 'DEBIT') {
        balance += entry.amount;
      } else {
        balance -= entry.amount;
      }

      return {
        ...entry.toObject(),
        runningBalance: balance
      };
    });

    res.json({
      account: req.params.account,
      entries: entriesWithBalance,
      openingBalance: 0,
      closingBalance: balance
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/reports/trial-balance
// @desc    Get trial balance
// @access  Private
router.get('/trial-balance', protect, async (req, res) => {
  try {
    const { asOnDate } = req.query;
    const date = asOnDate ? new Date(asOnDate) : new Date();

    const Ledger = (await import('../models/Ledger.js')).default;
    const { getAccountBalance } = await import('../utils/ledgerHelper.js');

    // Get all account types
    const accounts = [
      'CASH', 'BANK', 'ACCOUNTS_RECEIVABLE', 'INVENTORY',
      'ACCOUNTS_PAYABLE', 'GST_PAYABLE_CGST', 'GST_PAYABLE_SGST', 'GST_PAYABLE_IGST',
      'CAPITAL', 'SALES', 'PURCHASES', 'COST_OF_GOODS_SOLD',
      'RENT_EXPENSE', 'SALARY_EXPENSE', 'ELECTRICITY_EXPENSE'
    ];

    const trialBalance = await Promise.all(
      accounts.map(async (account) => {
        const balance = await getAccountBalance(req.user._id, account, date);
        return {
          account,
          debit: balance > 0 ? balance : 0,
          credit: balance < 0 ? -balance : 0
        };
      })
    );

    const totals = trialBalance.reduce((acc, item) => ({
      totalDebit: acc.totalDebit + item.debit,
      totalCredit: acc.totalCredit + item.credit
    }), { totalDebit: 0, totalCredit: 0 });

    res.json({
      asOnDate: date,
      accounts: trialBalance.filter(item => item.debit !== 0 || item.credit !== 0),
      totals
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/reports/summary
// @desc    Get comprehensive business summary
// @access  Private
router.get('/summary', protect, async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    const today = new Date();
    let startDate;

    switch (period) {
      case 'today':
        startDate = new Date(today.setHours(0, 0, 0, 0));
        break;
      case 'week':
        startDate = new Date(today.setDate(today.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(today.setMonth(today.getMonth() - 1));
        break;
      case 'year':
        startDate = new Date(today.setFullYear(today.getFullYear() - 1));
        break;
      default:
        startDate = new Date(today.setMonth(today.getMonth() - 1));
    }

    const endDate = new Date();

    const [pl, invoiceStats, purchaseStats, inventoryStats] = await Promise.all([
      generateProfitLoss(req.user._id, startDate, endDate),
      Invoice.aggregate([
        { $match: { userId: req.user._id, invoiceDate: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$grandTotal' } } }
      ]),
      (await import('../models/Purchase.js')).default.aggregate([
        { $match: { userId: req.user._id, purchaseDate: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$grandTotal' } } }
      ]),
      (await import('../utils/inventoryManager.js')).getLowStockProducts(req.user._id)
    ]);

    res.json({
      period,
      date_range: { startDate, endDate },
      profit_loss: pl.net_profit,
      sales: {
        count: invoiceStats[0]?.count || 0,
        total: invoiceStats[0]?.total || 0
      },
      purchases: {
        count: purchaseStats[0]?.count || 0,
        total: purchaseStats[0]?.total || 0
      },
      inventory: {
        low_stock_items: inventoryStats.length
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
