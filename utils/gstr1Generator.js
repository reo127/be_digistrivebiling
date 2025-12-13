import Invoice from '../models/Invoice.js';
import SalesReturn from '../models/SalesReturn.js';
import { getFinancialYear } from './gstCalculations.js';

/**
 * Generate GSTR-1 report data
 * @param {String} userId
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {String} gstin - Shop GSTIN
 * @returns {Object} - GSTR-1 data structure
 */
export const generateGSTR1 = async (userId, startDate, endDate, gstin) => {
  // Fetch all invoices in date range
  const invoices = await Invoice.find({
    userId,
    invoiceDate: {
      $gte: startDate,
      $lte: endDate
    }
  }).populate('customer');

  // Fetch all sales returns (credit notes) in date range
  const creditNotes = await SalesReturn.find({
    userId,
    returnDate: {
      $gte: startDate,
      $lte: endDate
    }
  }).populate('customer');

  // B2B - Business to Business (with GSTIN)
  const b2b = [];
  const b2bInvoices = invoices.filter(inv => inv.customerGstin);

  // Group by GSTIN
  const b2bGrouped = {};
  b2bInvoices.forEach(inv => {
    const ctin = inv.customerGstin;
    if (!b2bGrouped[ctin]) {
      b2bGrouped[ctin] = {
        ctin,
        invoices: []
      };
    }

    b2bGrouped[ctin].invoices.push({
      inum: inv.invoiceNumber,
      idt: formatDate(inv.invoiceDate),
      val: inv.grandTotal,
      pos: getStateCode(inv.customerState || inv.customerGstin),
      rchrg: 'N', // Reverse charge
      inv_typ: 'R', // Regular
      items: aggregateItemsByRate(inv.items, inv.taxType)
    });
  });

  b2b.push(...Object.values(b2bGrouped));

  // B2C Large - Sales to consumers > 2.5 lakhs without GSTIN
  const b2cl = [];
  const b2clInvoices = invoices.filter(inv => !inv.customerGstin && inv.grandTotal > 250000);

  b2clInvoices.forEach(inv => {
    b2cl.push({
      pos: getStateCode(inv.customerState),
      invoices: [{
        inum: inv.invoiceNumber,
        idt: formatDate(inv.invoiceDate),
        val: inv.grandTotal,
        items: aggregateItemsByRate(inv.items, inv.taxType)
      }]
    });
  });

  // B2C Small - Sales to consumers <= 2.5 lakhs without GSTIN (summary only)
  const b2cs = [];
  const b2csInvoices = invoices.filter(inv => !inv.customerGstin && inv.grandTotal <= 250000);

  // Group by state, tax rate, and tax type
  const b2csGrouped = {};
  b2csInvoices.forEach(inv => {
    inv.items.forEach(item => {
      const key = `${inv.customerState || 'Unknown'}_${item.gstRate}_${inv.taxType}`;
      if (!b2csGrouped[key]) {
        b2csGrouped[key] = {
          pos: getStateCode(inv.customerState),
          rate: item.gstRate,
          typ: inv.taxType === 'CGST_SGST' ? 'OE' : 'INTER',
          txval: 0,
          iamt: 0,
          camt: 0,
          samt: 0,
          csamt: 0
        };
      }

      b2csGrouped[key].txval += item.taxableAmount || 0;
      if (inv.taxType === 'IGST') {
        b2csGrouped[key].iamt += item.igst || 0;
      } else {
        b2csGrouped[key].camt += item.cgst || 0;
        b2csGrouped[key].samt += item.sgst || 0;
      }
    });
  });

  b2cs.push(...Object.values(b2csGrouped));

  // Credit/Debit Notes - Sales Returns
  const cdnr = []; // Registered credit notes
  const cdnur = []; // Unregistered credit notes

  const registeredCN = creditNotes.filter(cn => cn.customerGstin);
  const unregisteredCN = creditNotes.filter(cn => !cn.customerGstin);

  // Registered credit notes
  const cdnrGrouped = {};
  registeredCN.forEach(cn => {
    const ctin = cn.customerGstin;
    if (!cdnrGrouped[ctin]) {
      cdnrGrouped[ctin] = {
        ctin,
        notes: []
      };
    }

    cdnrGrouped[ctin].notes.push({
      ntty: 'C', // Credit note
      nt_num: cn.creditNoteNumber,
      nt_dt: formatDate(cn.returnDate),
      val: cn.grandTotal,
      pos: getStateCode(cn.customerState || cn.customerGstin),
      rchrg: 'N',
      inv_typ: 'R',
      items: aggregateItemsByRate(cn.items, cn.taxType)
    });
  });

  cdnr.push(...Object.values(cdnrGrouped));

  // Unregistered credit notes
  unregisteredCN.forEach(cn => {
    cdnur.push({
      ntty: 'C',
      nt_num: cn.creditNoteNumber,
      nt_dt: formatDate(cn.returnDate),
      val: cn.grandTotal,
      pos: getStateCode(cn.customerState),
      typ: cn.grandTotal > 250000 ? 'B2CL' : 'B2CS',
      items: aggregateItemsByRate(cn.items, cn.taxType)
    });
  });

  // Nil Rated, Exempted, and Non-GST supplies (if any)
  const nil = [];

  // Summary
  const summary = {
    total_invoices: invoices.length,
    total_credit_notes: creditNotes.length,
    b2b_invoices: b2bInvoices.length,
    b2cl_invoices: b2clInvoices.length,
    b2cs_invoices: b2csInvoices.length,
    total_taxable_value: invoices.reduce((sum, inv) => sum + inv.subtotal, 0),
    total_tax: invoices.reduce((sum, inv) => sum + inv.totalTax, 0),
    total_cgst: invoices.reduce((sum, inv) => sum + (inv.totalCGST || 0), 0),
    total_sgst: invoices.reduce((sum, inv) => sum + (inv.totalSGST || 0), 0),
    total_igst: invoices.reduce((sum, inv) => sum + (inv.totalIGST || 0), 0),
    total_invoice_value: invoices.reduce((sum, inv) => sum + inv.grandTotal, 0)
  };

  return {
    gstin,
    fp: getFinancialPeriod(startDate),
    version: 'GSTR1_v1.0',
    generated_at: new Date(),
    b2b,
    b2cl,
    b2cs,
    cdnr,
    cdnur,
    nil,
    summary
  };
};

/**
 * Convert GSTR-1 data to JSON format for GST portal upload
 */
export const generateGSTR1JSON = (gstr1Data) => {
  return {
    gstin: gstr1Data.gstin,
    fp: gstr1Data.fp,
    gt: gstr1Data.summary.total_invoice_value,
    cur_gt: gstr1Data.summary.total_invoice_value,
    b2b: gstr1Data.b2b.map(entry => ({
      ctin: entry.ctin,
      inv: entry.invoices.map(inv => ({
        inum: inv.inum,
        idt: inv.idt,
        val: roundTo2(inv.val),
        pos: inv.pos,
        rchrg: inv.rchrg,
        inv_typ: inv.inv_typ,
        itms: inv.items.map(item => ({
          num: item.num,
          itm_det: {
            rt: item.rate,
            txval: roundTo2(item.txval),
            iamt: roundTo2(item.iamt),
            camt: roundTo2(item.camt),
            samt: roundTo2(item.samt),
            csamt: roundTo2(item.csamt)
          }
        }))
      }))
    })),
    b2cl: gstr1Data.b2cl.map(entry => ({
      pos: entry.pos,
      inv: entry.invoices.map(inv => ({
        inum: inv.inum,
        idt: inv.idt,
        val: roundTo2(inv.val),
        itms: inv.items.map(item => ({
          num: item.num,
          itm_det: {
            rt: item.rate,
            txval: roundTo2(item.txval),
            iamt: roundTo2(item.iamt),
            camt: roundTo2(item.camt),
            samt: roundTo2(item.samt),
            csamt: roundTo2(item.csamt)
          }
        }))
      }))
    })),
    b2cs: gstr1Data.b2cs.map(entry => ({
      pos: entry.pos,
      rt: entry.rate,
      typ: entry.typ,
      txval: roundTo2(entry.txval),
      iamt: roundTo2(entry.iamt),
      camt: roundTo2(entry.camt),
      samt: roundTo2(entry.samt),
      csamt: roundTo2(entry.csamt)
    })),
    cdnr: gstr1Data.cdnr.map(entry => ({
      ctin: entry.ctin,
      nt: entry.notes.map(note => ({
        ntty: note.ntty,
        nt_num: note.nt_num,
        nt_dt: note.nt_dt,
        val: roundTo2(note.val),
        pos: note.pos,
        rchrg: note.rchrg,
        inv_typ: note.inv_typ,
        itms: note.items.map(item => ({
          num: item.num,
          itm_det: {
            rt: item.rate,
            txval: roundTo2(item.txval),
            iamt: roundTo2(item.iamt),
            camt: roundTo2(item.camt),
            samt: roundTo2(item.samt),
            csamt: roundTo2(item.csamt)
          }
        }))
      }))
    })),
    cdnur: gstr1Data.cdnur.map(entry => ({
      ntty: entry.ntty,
      nt_num: entry.nt_num,
      nt_dt: entry.nt_dt,
      val: roundTo2(entry.val),
      pos: entry.pos,
      typ: entry.typ,
      itms: entry.items.map(item => ({
        num: item.num,
        itm_det: {
          rt: item.rate,
          txval: roundTo2(item.txval),
          iamt: roundTo2(item.iamt),
          camt: roundTo2(item.camt),
          samt: roundTo2(item.samt),
          csamt: roundTo2(item.csamt)
        }
      }))
    }))
  };
};

/**
 * Convert GSTR-1 data to CSV format
 */
export const generateGSTR1CSV = (gstr1Data) => {
  const csvData = [];

  // B2B Invoices
  csvData.push(['Section', 'GSTIN/UIN', 'Invoice Number', 'Invoice Date', 'Invoice Value', 'Place of Supply', 'Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST']);
  gstr1Data.b2b.forEach(entry => {
    entry.invoices.forEach(inv => {
      inv.items.forEach((item, idx) => {
        csvData.push([
          idx === 0 ? 'B2B' : '',
          idx === 0 ? entry.ctin : '',
          idx === 0 ? inv.inum : '',
          idx === 0 ? inv.idt : '',
          idx === 0 ? inv.val : '',
          idx === 0 ? inv.pos : '',
          item.rate,
          item.txval,
          item.iamt,
          item.camt,
          item.samt
        ]);
      });
    });
  });

  // B2CL Invoices
  gstr1Data.b2cl.forEach(entry => {
    entry.invoices.forEach(inv => {
      inv.items.forEach((item, idx) => {
        csvData.push([
          idx === 0 ? 'B2CL' : '',
          '',
          idx === 0 ? inv.inum : '',
          idx === 0 ? inv.idt : '',
          idx === 0 ? inv.val : '',
          idx === 0 ? entry.pos : '',
          item.rate,
          item.txval,
          item.iamt,
          item.camt,
          item.samt
        ]);
      });
    });
  });

  // B2CS Summary
  csvData.push([]);
  csvData.push(['Section', 'Place of Supply', 'Rate', 'Type', 'Taxable Value', 'IGST', 'CGST', 'SGST']);
  gstr1Data.b2cs.forEach(entry => {
    csvData.push([
      'B2CS',
      entry.pos,
      entry.rate,
      entry.typ,
      entry.txval,
      entry.iamt,
      entry.camt,
      entry.samt
    ]);
  });

  return csvData.map(row => row.join(',')).join('\n');
};

// Helper functions
const formatDate = (date) => {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
};

const getStateCode = (stateOrGstin) => {
  if (!stateOrGstin) return '99'; // Unknown
  if (stateOrGstin.length >= 2 && /^\d{2}/.test(stateOrGstin)) {
    return stateOrGstin.substring(0, 2);
  }
  // State name to code mapping (simplified - add more as needed)
  const stateCodes = {
    'MAHARASHTRA': '27',
    'KARNATAKA': '29',
    'DELHI': '07',
    'TAMIL NADU': '33',
    'GUJARAT': '24',
    'RAJASTHAN': '08'
  };
  return stateCodes[stateOrGstin.toUpperCase()] || '99';
};

const aggregateItemsByRate = (items, taxType) => {
  const grouped = {};

  items.forEach(item => {
    const rate = item.gstRate;
    if (!grouped[rate]) {
      grouped[rate] = {
        num: Object.keys(grouped).length + 1,
        rate,
        txval: 0,
        iamt: 0,
        camt: 0,
        samt: 0,
        csamt: 0
      };
    }

    grouped[rate].txval += item.taxableAmount || 0;
    if (taxType === 'IGST') {
      grouped[rate].iamt += item.igst || 0;
    } else {
      grouped[rate].camt += item.cgst || 0;
      grouped[rate].samt += item.sgst || 0;
    }
  });

  return Object.values(grouped);
};

const getFinancialPeriod = (date) => {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}${year}`;
};

const roundTo2 = (num) => {
  return Math.round(num * 100) / 100;
};

export default {
  generateGSTR1,
  generateGSTR1JSON,
  generateGSTR1CSV
};
