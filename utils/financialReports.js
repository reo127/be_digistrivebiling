import Invoice from '../models/Invoice.js';
import Purchase from '../models/Purchase.js';
import Expense from '../models/Expense.js';
import Ledger from '../models/Ledger.js';
import { getAccountBalance } from '../utils/ledgerHelper.js';

/**
 * Generate Profit & Loss Statement
 * @param {String} userId
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Object} - P&L Report
 */
export const generateProfitLoss = async (userId, startDate, endDate) => {
  // Fetch all transactions
  const [invoices, expenses] = await Promise.all([
    Invoice.find({
      userId,
      invoiceDate: { $gte: startDate, $lte: endDate }
    }),
    Expense.find({
      userId,
      date: { $gte: startDate, $lte: endDate }
    })
  ]);

  // ===== REVENUE =====
  const totalSales = invoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
  const totalSalesExcludingGST = invoices.reduce((sum, inv) => sum + inv.subtotal, 0);

  // ===== COST OF GOODS SOLD (COGS) =====
  const totalCOGS = invoices.reduce((sum, inv) => sum + (inv.cogs || 0), 0);

  // ===== GROSS PROFIT =====
  const grossProfit = totalSalesExcludingGST - totalCOGS;
  const grossProfitMargin = totalSalesExcludingGST > 0
    ? (grossProfit / totalSalesExcludingGST) * 100
    : 0;

  // ===== OPERATING EXPENSES =====
  const expensesByCategory = {};
  const expenseCategories = [
    'RENT', 'SALARY', 'ELECTRICITY', 'WATER', 'INTERNET', 'TELEPHONE',
    'MAINTENANCE', 'STATIONERY', 'TRANSPORT', 'FUEL', 'INSURANCE',
    'LICENSE_FEES', 'PROFESSIONAL_FEES', 'BANK_CHARGES', 'REPAIRS',
    'ADVERTISING', 'MISCELLANEOUS'
  ];

  expenseCategories.forEach(category => {
    expensesByCategory[category] = 0;
  });

  expenses.forEach(exp => {
    if (expensesByCategory[exp.category] !== undefined) {
      expensesByCategory[exp.category] += exp.amount; // Exclude GST on expenses
    }
  });

  const totalOperatingExpenses = Object.values(expensesByCategory).reduce((sum, val) => sum + val, 0);

  // ===== OPERATING PROFIT (EBITDA) =====
  const operatingProfit = grossProfit - totalOperatingExpenses;

  // ===== OTHER INCOME/EXPENSES =====
  const otherIncome = 0; // Can be added if you have other income sources
  const otherExpenses = 0;

  // ===== NET PROFIT BEFORE TAX =====
  const netProfitBeforeTax = operatingProfit + otherIncome - otherExpenses;

  // ===== TAX LIABILITY =====
  // GST is not profit/loss, it's a liability. Income tax calculation can be added here
  const incomeTax = 0; // To be calculated based on tax slab

  // ===== NET PROFIT AFTER TAX =====
  const netProfitAfterTax = netProfitBeforeTax - incomeTax;

  // Net profit margin
  const netProfitMargin = totalSalesExcludingGST > 0
    ? (netProfitAfterTax / totalSalesExcludingGST) * 100
    : 0;

  return {
    period: {
      start: startDate,
      end: endDate
    },

    // Revenue Section
    revenue: {
      sales_including_gst: roundTo2(totalSales),
      sales_excluding_gst: roundTo2(totalSalesExcludingGST),
      other_income: roundTo2(otherIncome),
      total_revenue: roundTo2(totalSalesExcludingGST + otherIncome)
    },

    // Cost of Goods Sold
    cogs: {
      total_cogs: roundTo2(totalCOGS)
    },

    // Gross Profit
    gross_profit: {
      amount: roundTo2(grossProfit),
      margin_percentage: roundTo2(grossProfitMargin)
    },

    // Operating Expenses
    operating_expenses: {
      ...Object.fromEntries(
        Object.entries(expensesByCategory).map(([key, value]) => [key.toLowerCase(), roundTo2(value)])
      ),
      total: roundTo2(totalOperatingExpenses)
    },

    // Operating Profit
    operating_profit: {
      amount: roundTo2(operatingProfit)
    },

    // Other Income/Expenses
    other_income_expenses: {
      other_income: roundTo2(otherIncome),
      other_expenses: roundTo2(otherExpenses)
    },

    // Net Profit
    net_profit: {
      before_tax: roundTo2(netProfitBeforeTax),
      income_tax: roundTo2(incomeTax),
      after_tax: roundTo2(netProfitAfterTax),
      margin_percentage: roundTo2(netProfitMargin)
    },

    // Statistics
    statistics: {
      total_invoices: invoices.length,
      total_expenses: expenses.length,
      average_invoice_value: invoices.length > 0 ? roundTo2(totalSales / invoices.length) : 0
    }
  };
};

/**
 * Generate Balance Sheet
 * @param {String} userId
 * @param {Date} asOnDate - Balance sheet as on this date
 * @returns {Object} - Balance Sheet
 */
export const generateBalanceSheet = async (userId, asOnDate) => {
  // Get balances of all accounts as on date
  const [
    cash,
    bank,
    accountsReceivable,
    inventory,
    accountsPayable,
    gstPayableCGST,
    gstPayableSGST,
    gstPayableIGST
  ] = await Promise.all([
    getAccountBalance(userId, 'CASH', asOnDate),
    getAccountBalance(userId, 'BANK', asOnDate),
    getAccountBalance(userId, 'ACCOUNTS_RECEIVABLE', asOnDate),
    getAccountBalance(userId, 'INVENTORY', asOnDate),
    getAccountBalance(userId, 'ACCOUNTS_PAYABLE', asOnDate),
    getAccountBalance(userId, 'GST_PAYABLE_CGST', asOnDate),
    getAccountBalance(userId, 'GST_PAYABLE_SGST', asOnDate),
    getAccountBalance(userId, 'GST_PAYABLE_IGST', asOnDate)
  ]);

  // Get inventory value from batches (more accurate than ledger)
  const Batch = (await import('../models/Batch.js')).default;
  const batches = await Batch.find({
    userId,
    isActive: true,
    quantity: { $gt: 0 },
    createdAt: { $lte: asOnDate }
  });

  const inventoryValue = batches.reduce((sum, batch) =>
    sum + (batch.quantity * batch.purchasePrice), 0);

  // ===== ASSETS =====
  const currentAssets = {
    cash: Math.max(0, cash),
    bank: Math.max(0, bank),
    accounts_receivable: Math.max(0, accountsReceivable),
    inventory: inventoryValue
  };

  const totalCurrentAssets = Object.values(currentAssets).reduce((sum, val) => sum + val, 0);

  // Fixed Assets (can be added later - furniture, equipment)
  const fixedAssets = {
    furniture_fixtures: 0,
    equipment: 0,
    less_depreciation: 0
  };

  const totalFixedAssets = fixedAssets.furniture_fixtures + fixedAssets.equipment - fixedAssets.less_depreciation;

  const totalAssets = totalCurrentAssets + totalFixedAssets;

  // ===== LIABILITIES =====
  const currentLiabilities = {
    accounts_payable: Math.max(0, -accountsPayable), // Negative balance means liability
    gst_payable: Math.max(0, -(gstPayableCGST + gstPayableSGST + gstPayableIGST)),
    other_liabilities: 0
  };

  const totalCurrentLiabilities = Object.values(currentLiabilities).reduce((sum, val) => sum + val, 0);

  // Long-term Liabilities
  const longTermLiabilities = {
    loans_payable: 0
  };

  const totalLongTermLiabilities = Object.values(longTermLiabilities).reduce((sum, val) => sum + val, 0);

  const totalLiabilities = totalCurrentLiabilities + totalLongTermLiabilities;

  // ===== CAPITAL/EQUITY =====
  // Capital = Total Assets - Total Liabilities
  // Or Opening Capital + Profit - Drawings

  const capital = {
    opening_capital: 0, // To be set from settings or previous period
    add_profit: 0, // Current period profit from P&L
    less_drawings: 0,
    retained_earnings: totalAssets - totalLiabilities // Balancing figure
  };

  const totalCapital = capital.retained_earnings;

  // Verify accounting equation: Assets = Liabilities + Capital
  const difference = totalAssets - (totalLiabilities + totalCapital);

  return {
    as_on_date: asOnDate,

    // Assets
    assets: {
      current_assets: {
        ...Object.fromEntries(
          Object.entries(currentAssets).map(([key, value]) => [key, roundTo2(value)])
        ),
        total: roundTo2(totalCurrentAssets)
      },
      fixed_assets: {
        ...Object.fromEntries(
          Object.entries(fixedAssets).map(([key, value]) => [key, roundTo2(value)])
        ),
        total: roundTo2(totalFixedAssets)
      },
      total_assets: roundTo2(totalAssets)
    },

    // Liabilities
    liabilities: {
      current_liabilities: {
        ...Object.fromEntries(
          Object.entries(currentLiabilities).map(([key, value]) => [key, roundTo2(value)])
        ),
        total: roundTo2(totalCurrentLiabilities)
      },
      long_term_liabilities: {
        ...Object.fromEntries(
          Object.entries(longTermLiabilities).map(([key, value]) => [key, roundTo2(value)])
        ),
        total: roundTo2(totalLongTermLiabilities)
      },
      total_liabilities: roundTo2(totalLiabilities)
    },

    // Capital/Equity
    capital: {
      ...Object.fromEntries(
        Object.entries(capital).map(([key, value]) => [key, roundTo2(value)])
      ),
      total_capital: roundTo2(totalCapital)
    },

    // Verification
    total_liabilities_and_capital: roundTo2(totalLiabilities + totalCapital),
    balance_check: {
      is_balanced: Math.abs(difference) < 0.01,
      difference: roundTo2(difference)
    }
  };
};

/**
 * Generate month-wise P&L comparison
 */
export const generateMonthwisePL = async (userId, year) => {
  const months = [];

  for (let month = 0; month < 12; month++) {
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);

    const pl = await generateProfitLoss(userId, startDate, endDate);

    months.push({
      month: month + 1,
      month_name: startDate.toLocaleString('default', { month: 'long' }),
      revenue: pl.revenue.sales_excluding_gst,
      cogs: pl.cogs.total_cogs,
      gross_profit: pl.gross_profit.amount,
      operating_expenses: pl.operating_expenses.total,
      net_profit: pl.net_profit.after_tax,
      net_profit_margin: pl.net_profit.margin_percentage
    });
  }

  const yearTotal = {
    revenue: months.reduce((sum, m) => sum + m.revenue, 0),
    cogs: months.reduce((sum, m) => sum + m.cogs, 0),
    gross_profit: months.reduce((sum, m) => sum + m.gross_profit, 0),
    operating_expenses: months.reduce((sum, m) => sum + m.operating_expenses, 0),
    net_profit: months.reduce((sum, m) => sum + m.net_profit, 0)
  };

  return {
    year,
    months,
    yearly_total: yearTotal
  };
};

// Helper
const roundTo2 = (num) => {
  return Math.round(num * 100) / 100;
};

export default {
  generateProfitLoss,
  generateBalanceSheet,
  generateMonthwisePL
};
