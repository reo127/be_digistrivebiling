// GST Calculation Utilities

/**
 * Calculate GST amounts based on taxable amount and GST rate
 * @param {Number} taxableAmount - Amount before tax
 * @param {Number} gstRate - GST rate (0, 5, 12, 18, 28)
 * @param {String} taxType - 'CGST_SGST' or 'IGST'
 * @returns {Object} - { cgst, sgst, igst, totalTax }
 */
export const calculateGST = (taxableAmount, gstRate, taxType) => {
  const totalTax = (taxableAmount * gstRate) / 100;

  if (taxType === 'CGST_SGST') {
    return {
      cgst: totalTax / 2,
      sgst: totalTax / 2,
      igst: 0,
      totalTax
    };
  } else {
    return {
      cgst: 0,
      sgst: 0,
      igst: totalTax,
      totalTax
    };
  }
};

/**
 * Determine tax type based on supplier/customer state
 * @param {String} shopState - Shop's state from settings
 * @param {String} partyState - Customer/Supplier state
 * @returns {String} - 'CGST_SGST' or 'IGST'
 */
export const determineTaxType = (shopState, partyState) => {
  if (!partyState || shopState.trim().toUpperCase() === partyState.trim().toUpperCase()) {
    return 'CGST_SGST';
  }
  return 'IGST';
};

/**
 * Calculate item-level GST for invoice/purchase items
 * @param {Object} item - { quantity, sellingPrice/purchasePrice, discount, gstRate }
 * @param {String} taxType - 'CGST_SGST' or 'IGST'
 * @returns {Object} - Complete item with tax calculations
 */
export const calculateItemGST = (item, taxType) => {
  const { quantity, sellingPrice, purchasePrice, discount = 0, gstRate } = item;
  const price = sellingPrice || purchasePrice;

  // Calculate taxable amount
  const itemTotal = price * quantity;
  const discountAmount = (itemTotal * discount) / 100;
  const taxableAmount = itemTotal - discountAmount;

  // Calculate GST
  const gst = calculateGST(taxableAmount, gstRate, taxType);

  return {
    ...item,
    discountAmount,
    taxableAmount,
    ...gst,
    totalAmount: taxableAmount + gst.totalTax
  };
};

/**
 * Calculate total amounts for invoice/purchase
 * @param {Array} items - Array of items with GST calculated
 * @param {Object} additionalCharges - { freight, packaging, otherCharges }
 * @param {Number} discount - Overall discount
 * @returns {Object} - { subtotal, totalTax, totalCGST, totalSGST, totalIGST, grandTotal }
 */
export const calculateTotals = (items, additionalCharges = {}, discount = 0) => {
  const subtotal = items.reduce((sum, item) => sum + item.taxableAmount, 0);
  const totalTax = items.reduce((sum, item) => sum + item.totalTax, 0);
  const totalCGST = items.reduce((sum, item) => sum + (item.cgst || 0), 0);
  const totalSGST = items.reduce((sum, item) => sum + (item.sgst || 0), 0);
  const totalIGST = items.reduce((sum, item) => sum + (item.igst || 0), 0);

  const { freight = 0, packaging = 0, otherCharges = 0 } = additionalCharges;
  const additionalTotal = freight + packaging + otherCharges;

  const grandTotal = subtotal + totalTax + additionalTotal - discount;
  const roundOff = Math.round(grandTotal) - grandTotal;

  return {
    subtotal,
    totalTax,
    totalCGST,
    totalSGST,
    totalIGST,
    discount,
    additionalCharges: additionalTotal,
    roundOff,
    grandTotal: Math.round(grandTotal)
  };
};

/**
 * Reverse calculate price from MRP including GST
 * @param {Number} mrp - Maximum Retail Price (including GST)
 * @param {Number} gstRate - GST rate
 * @returns {Number} - Price before GST
 */
export const reverseCalculateGST = (mrp, gstRate) => {
  return mrp / (1 + gstRate / 100);
};

/**
 * Validate GSTIN format
 * @param {String} gstin - GSTIN number
 * @returns {Boolean}
 */
export const validateGSTIN = (gstin) => {
  if (!gstin) return false;
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return gstinRegex.test(gstin);
};

/**
 * Extract state code from GSTIN
 * @param {String} gstin - GSTIN number
 * @returns {String} - State code (first 2 digits)
 */
export const getStateCodeFromGSTIN = (gstin) => {
  if (!gstin || gstin.length < 2) return null;
  return gstin.substring(0, 2);
};

/**
 * Get financial year from date
 * @param {Date} date
 * @returns {String} - Format: "2024-2025"
 */
export const getFinancialYear = (date = new Date()) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;

  if (month >= 4) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
};

/**
 * Get financial year date range
 * @param {String} fy - Financial year string "2024-2025"
 * @returns {Object} - { startDate, endDate }
 */
export const getFinancialYearRange = (fy) => {
  const [startYear] = fy.split('-').map(Number);
  return {
    startDate: new Date(startYear, 3, 1), // April 1
    endDate: new Date(startYear + 1, 2, 31) // March 31
  };
};

/**
 * Convert number to words (for invoice)
 * @param {Number} amount
 * @returns {String}
 */
export const amountToWords = (amount) => {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

  if (amount === 0) return 'Zero Rupees Only';

  const num = Math.floor(amount);
  const paise = Math.round((amount - num) * 100);

  let words = '';

  // Crores
  if (num >= 10000000) {
    words += amountToWords(Math.floor(num / 10000000)) + ' Crore ';
    amount = num % 10000000;
  }

  // Lakhs
  if (num >= 100000) {
    words += amountToWords(Math.floor(num / 100000)) + ' Lakh ';
    amount = num % 100000;
  }

  // Thousands
  if (num >= 1000) {
    words += amountToWords(Math.floor(num / 1000)) + ' Thousand ';
    amount = num % 1000;
  }

  // Hundreds
  if (num >= 100) {
    words += ones[Math.floor(num / 100)] + ' Hundred ';
    amount = num % 100;
  }

  // Tens and Ones
  if (num >= 20) {
    words += tens[Math.floor(num / 10)] + ' ';
    words += ones[num % 10] + ' ';
  } else if (num >= 10) {
    words += teens[num - 10] + ' ';
  } else if (num > 0) {
    words += ones[num] + ' ';
  }

  words += 'Rupees';

  if (paise > 0) {
    words += ' and ' + amountToWords(paise) + ' Paise';
  }

  return words.trim() + ' Only';
};

export default {
  calculateGST,
  determineTaxType,
  calculateItemGST,
  calculateTotals,
  reverseCalculateGST,
  validateGSTIN,
  getStateCodeFromGSTIN,
  getFinancialYear,
  getFinancialYearRange,
  amountToWords
};
