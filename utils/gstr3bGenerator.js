import Invoice from '../models/Invoice.js';
import Purchase from '../models/Purchase.js';
import SalesReturn from '../models/SalesReturn.js';
import PurchaseReturn from '../models/PurchaseReturn.js';

/**
 * Generate GSTR-3B computation
 * @param {String} userId
 * @param {Date} startDate - Month start
 * @param {Date} endDate - Month end
 * @param {String} gstin
 * @returns {Object} - GSTR-3B data
 */
export const generateGSTR3B = async (userId, startDate, endDate, gstin) => {
  // Fetch all transactions for the period
  const [invoices, purchases, salesReturns, purchaseReturns] = await Promise.all([
    Invoice.find({
      userId,
      invoiceDate: { $gte: startDate, $lte: endDate }
    }),
    Purchase.find({
      userId,
      purchaseDate: { $gte: startDate, $lte: endDate }
    }),
    SalesReturn.find({
      userId,
      returnDate: { $gte: startDate, $lte: endDate }
    }),
    PurchaseReturn.find({
      userId,
      returnDate: { $gte: startDate, $lte: endDate }
    })
  ]);

  // ====== 3.1 OUTWARD SUPPLIES ======
  // Tax liability on outward supplies

  const outwardSupplies = {
    taxable: {
      txval: 0,
      iamt: 0,
      camt: 0,
      samt: 0,
      csamt: 0 // Cess amount
    },
    exempted: {
      txval: 0,
      iamt: 0,
      camt: 0,
      samt: 0,
      csamt: 0
    },
    nil_rated: {
      txval: 0
    },
    non_gst: {
      txval: 0
    }
  };

  // Outward taxable supplies (from invoices)
  invoices.forEach(inv => {
    outwardSupplies.taxable.txval += inv.subtotal;
    outwardSupplies.taxable.iamt += inv.totalIGST || 0;
    outwardSupplies.taxable.camt += inv.totalCGST || 0;
    outwardSupplies.taxable.samt += inv.totalSGST || 0;
  });

  // Deduct sales returns from outward supplies
  salesReturns.forEach(sr => {
    outwardSupplies.taxable.txval -= sr.subtotal;
    outwardSupplies.taxable.iamt -= sr.totalIGST || 0;
    outwardSupplies.taxable.camt -= sr.totalCGST || 0;
    outwardSupplies.taxable.samt -= sr.totalSGST || 0;
  });

  // ====== 3.2 INWARD SUPPLIES LIABLE TO REVERSE CHARGE ======
  // Typically zero for medical shops
  const reverseCharge = {
    txval: 0,
    iamt: 0,
    camt: 0,
    samt: 0,
    csamt: 0
  };

  // ====== 4. ELIGIBLE ITC (Input Tax Credit) ======
  // ITC available from purchases

  const itc = {
    // 4(A) ITC Available
    inputs: {
      txval: 0,
      iamt: 0,
      camt: 0,
      samt: 0,
      csamt: 0
    },
    capital_goods: {
      txval: 0,
      iamt: 0,
      camt: 0,
      samt: 0,
      csamt: 0
    },
    input_services: {
      txval: 0,
      iamt: 0,
      camt: 0,
      samt: 0,
      csamt: 0
    },
    // 4(B) ITC Reversed
    reversed: {
      txval: 0,
      iamt: 0,
      camt: 0,
      samt: 0,
      csamt: 0
    },
    // 4(D) Net ITC Available
    net: {
      iamt: 0,
      camt: 0,
      samt: 0,
      csamt: 0
    }
  };

  // ITC from purchases (inputs - inventory)
  purchases.forEach(pur => {
    itc.inputs.txval += pur.subtotal;
    itc.inputs.iamt += pur.totalIGST || 0;
    itc.inputs.camt += pur.totalCGST || 0;
    itc.inputs.samt += pur.totalSGST || 0;
  });

  // Reverse ITC for purchase returns
  purchaseReturns.forEach(pr => {
    itc.reversed.txval += pr.subtotal;
    itc.reversed.iamt += pr.totalIGST || 0;
    itc.reversed.camt += pr.totalCGST || 0;
    itc.reversed.samt += pr.totalSGST || 0;
  });

  // Calculate net ITC
  itc.net.iamt = itc.inputs.iamt - itc.reversed.iamt;
  itc.net.camt = itc.inputs.camt - itc.reversed.camt;
  itc.net.samt = itc.inputs.samt - itc.reversed.samt;

  // ====== 5. TAX PAYABLE ======
  const taxPayable = {
    igst: Math.max(0, outwardSupplies.taxable.iamt - itc.net.iamt),
    cgst: Math.max(0, outwardSupplies.taxable.camt - itc.net.camt),
    sgst: Math.max(0, outwardSupplies.taxable.samt - itc.net.samt),
    cess: 0
  };

  // Total tax payable
  const totalTaxPayable = taxPayable.igst + taxPayable.cgst + taxPayable.sgst + taxPayable.cess;

  // ====== 6. INTEREST & LATE FEE ======
  // Calculate interest if filing is late (simplified - can be enhanced)
  const interest = {
    igst: 0,
    cgst: 0,
    sgst: 0,
    cess: 0
  };

  const lateFee = {
    igst: 0,
    cgst: 0,
    sgst: 0,
    cess: 0
  };

  // Summary
  const summary = {
    period: getMonthYear(startDate),
    total_outward_supplies: outwardSupplies.taxable.txval,
    total_output_tax: outwardSupplies.taxable.iamt + outwardSupplies.taxable.camt + outwardSupplies.taxable.samt,
    total_inward_supplies: itc.inputs.txval,
    total_input_tax: itc.inputs.iamt + itc.inputs.camt + itc.inputs.samt,
    net_itc: itc.net.iamt + itc.net.camt + itc.net.samt,
    total_tax_payable: totalTaxPayable,
    total_invoices: invoices.length,
    total_purchases: purchases.length
  };

  return {
    gstin,
    fp: getFinancialPeriod(startDate),
    version: 'GSTR3B_v1.0',
    generated_at: new Date(),

    // Table 3.1 - Outward supplies and inward supplies liable to reverse charge
    section_3_1: {
      outward_supplies: outwardSupplies,
      reverse_charge: reverseCharge
    },

    // Table 4 - Eligible ITC
    section_4: itc,

    // Table 5 - Tax payable
    section_5: taxPayable,

    // Table 6 - Interest and late fee
    section_6: {
      interest,
      late_fee: lateFee
    },

    summary
  };
};

/**
 * Convert GSTR-3B to JSON format for GST portal upload
 */
export const generateGSTR3BJSON = (gstr3bData) => {
  return {
    gstin: gstr3bData.gstin,
    ret_period: gstr3bData.fp,

    // Table 3.1
    sup_details: {
      osup_det: {
        txval: roundTo2(gstr3bData.section_3_1.outward_supplies.taxable.txval),
        iamt: roundTo2(gstr3bData.section_3_1.outward_supplies.taxable.iamt),
        camt: roundTo2(gstr3bData.section_3_1.outward_supplies.taxable.camt),
        samt: roundTo2(gstr3bData.section_3_1.outward_supplies.taxable.samt),
        csamt: roundTo2(gstr3bData.section_3_1.outward_supplies.taxable.csamt)
      },
      osup_zero: {
        txval: roundTo2(gstr3bData.section_3_1.outward_supplies.exempted.txval),
        iamt: roundTo2(gstr3bData.section_3_1.outward_supplies.exempted.iamt),
        csamt: 0
      },
      osup_nil_exmp: {
        txval: roundTo2(gstr3bData.section_3_1.outward_supplies.nil_rated.txval)
      },
      osup_nongst: {
        txval: roundTo2(gstr3bData.section_3_1.outward_supplies.non_gst.txval)
      },
      isup_rev: {
        txval: roundTo2(gstr3bData.section_3_1.reverse_charge.txval),
        iamt: roundTo2(gstr3bData.section_3_1.reverse_charge.iamt),
        camt: roundTo2(gstr3bData.section_3_1.reverse_charge.camt),
        samt: roundTo2(gstr3bData.section_3_1.reverse_charge.samt),
        csamt: roundTo2(gstr3bData.section_3_1.reverse_charge.csamt)
      }
    },

    // Table 4 - ITC
    itc_elg: {
      itc_avl: [{
        ty: 'INPUTS',
        iamt: roundTo2(gstr3bData.section_4.inputs.iamt),
        camt: roundTo2(gstr3bData.section_4.inputs.camt),
        samt: roundTo2(gstr3bData.section_4.inputs.samt),
        csamt: roundTo2(gstr3bData.section_4.inputs.csamt)
      }],
      itc_rev: [{
        ty: 'RUL',
        iamt: roundTo2(gstr3bData.section_4.reversed.iamt),
        camt: roundTo2(gstr3bData.section_4.reversed.camt),
        samt: roundTo2(gstr3bData.section_4.reversed.samt),
        csamt: roundTo2(gstr3bData.section_4.reversed.csamt)
      }],
      itc_net: {
        iamt: roundTo2(gstr3bData.section_4.net.iamt),
        camt: roundTo2(gstr3bData.section_4.net.camt),
        samt: roundTo2(gstr3bData.section_4.net.samt),
        csamt: roundTo2(gstr3bData.section_4.net.csamt)
      }
    },

    // Table 5 - Tax payable
    intr_details: {
      intr_amt: {
        iamt: roundTo2(gstr3bData.section_5.igst),
        camt: roundTo2(gstr3bData.section_5.cgst),
        samt: roundTo2(gstr3bData.section_5.sgst),
        csamt: roundTo2(gstr3bData.section_5.cess)
      }
    }
  };
};

/**
 * Generate summary report in readable format
 */
export const generateGSTR3BSummary = (gstr3bData) => {
  return {
    period: gstr3bData.summary.period,
    filing_status: 'Not Filed', // To be updated when filing

    outward_supplies: {
      total_taxable_value: roundTo2(gstr3bData.section_3_1.outward_supplies.taxable.txval),
      igst: roundTo2(gstr3bData.section_3_1.outward_supplies.taxable.iamt),
      cgst: roundTo2(gstr3bData.section_3_1.outward_supplies.taxable.camt),
      sgst: roundTo2(gstr3bData.section_3_1.outward_supplies.taxable.samt),
      total_tax: roundTo2(
        gstr3bData.section_3_1.outward_supplies.taxable.iamt +
        gstr3bData.section_3_1.outward_supplies.taxable.camt +
        gstr3bData.section_3_1.outward_supplies.taxable.samt
      )
    },

    input_tax_credit: {
      total_taxable_value: roundTo2(gstr3bData.section_4.inputs.txval),
      igst: roundTo2(gstr3bData.section_4.net.iamt),
      cgst: roundTo2(gstr3bData.section_4.net.camt),
      sgst: roundTo2(gstr3bData.section_4.net.samt),
      total_itc: roundTo2(
        gstr3bData.section_4.net.iamt +
        gstr3bData.section_4.net.camt +
        gstr3bData.section_4.net.samt
      )
    },

    tax_payable: {
      igst: roundTo2(gstr3bData.section_5.igst),
      cgst: roundTo2(gstr3bData.section_5.cgst),
      sgst: roundTo2(gstr3bData.section_5.sgst),
      cess: roundTo2(gstr3bData.section_5.cess),
      total: roundTo2(
        gstr3bData.section_5.igst +
        gstr3bData.section_5.cgst +
        gstr3bData.section_5.sgst +
        gstr3bData.section_5.cess
      )
    },

    statistics: {
      total_invoices: gstr3bData.summary.total_invoices,
      total_purchases: gstr3bData.summary.total_purchases,
      total_outward_value: roundTo2(gstr3bData.summary.total_outward_supplies),
      total_inward_value: roundTo2(gstr3bData.summary.total_inward_supplies)
    }
  };
};

// Helper functions
const getFinancialPeriod = (date) => {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}${year}`;
};

const getMonthYear = (date) => {
  const d = new Date(date);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
};

const roundTo2 = (num) => {
  return Math.round(num * 100) / 100;
};

export default {
  generateGSTR3B,
  generateGSTR3BJSON,
  generateGSTR3BSummary
};
