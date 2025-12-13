/**
 * Generate E-Way Bill JSON for GST portal
 * For inter-state sales > Rs. 50,000
 */

/**
 * Generate E-Way Bill data from invoice
 * @param {Object} invoice - Invoice document
 * @param {Object} shopSettings - Shop settings with GSTIN
 * @returns {Object} - E-Way Bill JSON
 */
export const generateEWayBill = (invoice, shopSettings) => {
  // Validate e-way bill requirement
  if (invoice.taxType !== 'IGST' || invoice.grandTotal <= 50000) {
    throw new Error('E-Way Bill not required for this invoice');
  }

  // Document details
  const docDetails = {
    doc_num: invoice.invoiceNumber,
    doc_date: formatDate(invoice.invoiceDate),
    doc_type: 'INV', // Invoice
    from_gstin: shopSettings.gstin,
    to_gstin: invoice.customerGstin || 'URP', // Unregistered person if no GSTIN
    supply_type: 'O', // Outward
    sub_supply_type: '1', // Supply
    doc_value: invoice.grandTotal
  };

  // Seller details (From)
  const fromDetails = {
    gstin: shopSettings.gstin,
    legal_name: shopSettings.shopName,
    trade_name: shopSettings.shopName,
    address1: shopSettings.address,
    address2: '',
    place: shopSettings.city,
    pincode: shopSettings.pincode,
    state_code: getStateCode(shopSettings.gstin),
    actual_from_state_code: getStateCode(shopSettings.gstin)
  };

  // Buyer details (To)
  const toDetails = {
    gstin: invoice.customerGstin || '',
    legal_name: invoice.customerName,
    trade_name: invoice.customerName,
    address1: invoice.customerAddress || '',
    address2: '',
    place: invoice.customerCity || '',
    pincode: '',
    state_code: invoice.customerGstin ? getStateCode(invoice.customerGstin) : getStateCode(invoice.customerState),
    actual_to_state_code: invoice.customerGstin ? getStateCode(invoice.customerGstin) : getStateCode(invoice.customerState)
  };

  // Item details
  const itemList = invoice.items.map((item, index) => ({
    item_no: index + 1,
    product_name: item.productName,
    product_desc: item.productName,
    hsn_code: item.hsnCode || '',
    quantity: item.quantity,
    qtyUnit: item.unit || 'PCS',
    cgst_rate: invoice.taxType === 'CGST_SGST' ? item.gstRate / 2 : 0,
    sgst_rate: invoice.taxType === 'CGST_SGST' ? item.gstRate / 2 : 0,
    igst_rate: invoice.taxType === 'IGST' ? item.gstRate : 0,
    cess_rate: 0,
    cess_non_advol: 0,
    taxable_amount: item.taxableAmount || 0,
    cess_amount: 0,
    other_value: 0,
    total_value: item.totalAmount || 0
  }));

  // Transport details
  const transportDetails = {
    transporter_id: '', // Transporter GSTIN
    transporter_name: invoice.transporterName || '',
    trans_mode: '1', // Road
    trans_distance: invoice.distance || 0,
    trans_doc_no: '',
    trans_doc_date: '',
    vehicle_no: invoice.vehicleNumber || '',
    vehicle_type: 'R' // Regular
  };

  // Value details (totals)
  const valueDetails = {
    total_assessable_value: invoice.subtotal,
    total_cgst_value: invoice.totalCGST || 0,
    total_sgst_value: invoice.totalSGST || 0,
    total_igst_value: invoice.totalIGST || 0,
    total_cess_value: 0,
    total_cess_non_advol_value: 0,
    other_value: 0,
    total_invoice_value: invoice.grandTotal,
    round_off_amount: invoice.roundOff || 0,
    total_in_words: '' // Can add amount in words
  };

  return {
    version: '1.0',
    user_gstin: shopSettings.gstin,
    data_source: 'erp',
    transaction_date: formatDate(invoice.invoiceDate),

    doc_details: docDetails,
    from_details: fromDetails,
    to_details: toDetails,
    item_list: itemList,
    transport_details: transportDetails,
    value_details: valueDetails,

    // Additional fields
    bill_from: {
      gstin: shopSettings.gstin,
      legal_name: shopSettings.shopName,
      trade_name: shopSettings.shopName,
      address1: shopSettings.address,
      location: shopSettings.city,
      pincode: shopSettings.pincode,
      state_code: getStateCode(shopSettings.gstin)
    },

    bill_to: {
      gstin: invoice.customerGstin || '',
      legal_name: invoice.customerName,
      trade_name: invoice.customerName,
      address1: invoice.customerAddress || '',
      location: invoice.customerCity || '',
      pincode: '',
      state_code: invoice.customerGstin ? getStateCode(invoice.customerGstin) : getStateCode(invoice.customerState)
    },

    dispatch_from: fromDetails,
    ship_to: toDetails
  };
};

/**
 * Generate consolidated E-Way Bills for multiple invoices
 */
export const generateBulkEWayBills = (invoices, shopSettings) => {
  const ewayBills = [];

  invoices.forEach(invoice => {
    try {
      if (invoice.eWayBillRequired) {
        const ewayBill = generateEWayBill(invoice, shopSettings);
        ewayBills.push({
          invoice_number: invoice.invoiceNumber,
          ewayBill,
          status: 'ready'
        });
      }
    } catch (error) {
      ewayBills.push({
        invoice_number: invoice.invoiceNumber,
        error: error.message,
        status: 'error'
      });
    }
  });

  return {
    total_invoices: invoices.length,
    eway_bills_generated: ewayBills.filter(e => e.status === 'ready').length,
    errors: ewayBills.filter(e => e.status === 'error').length,
    bills: ewayBills
  };
};

/**
 * Format E-Way Bill for CSV download
 */
export const generateEWayBillCSV = (ewayBill) => {
  const csv = [];

  // Header
  csv.push([
    'Supply Type', 'Sub Type', 'Document Type', 'Document Number', 'Document Date',
    'From GSTIN', 'From Trade Name', 'From Address', 'From Place', 'From Pincode', 'From State',
    'To GSTIN', 'To Trade Name', 'To Address', 'To Place', 'To Pincode', 'To State',
    'Product Name', 'Product Description', 'HSN Code', 'Quantity', 'Unit', 'Taxable Amount',
    'CGST Rate', 'SGST Rate', 'IGST Rate', 'Cess Rate',
    'Transporter Name', 'Transport Mode', 'Vehicle Number', 'Distance',
    'Total Invoice Value'
  ]);

  // Data
  ewayBill.item_list.forEach((item, index) => {
    csv.push([
      ewayBill.doc_details.supply_type,
      ewayBill.doc_details.sub_supply_type,
      ewayBill.doc_details.doc_type,
      index === 0 ? ewayBill.doc_details.doc_num : '',
      index === 0 ? ewayBill.doc_details.doc_date : '',
      index === 0 ? ewayBill.from_details.gstin : '',
      index === 0 ? ewayBill.from_details.trade_name : '',
      index === 0 ? ewayBill.from_details.address1 : '',
      index === 0 ? ewayBill.from_details.place : '',
      index === 0 ? ewayBill.from_details.pincode : '',
      index === 0 ? ewayBill.from_details.state_code : '',
      index === 0 ? ewayBill.to_details.gstin : '',
      index === 0 ? ewayBill.to_details.trade_name : '',
      index === 0 ? ewayBill.to_details.address1 : '',
      index === 0 ? ewayBill.to_details.place : '',
      index === 0 ? ewayBill.to_details.pincode : '',
      index === 0 ? ewayBill.to_details.state_code : '',
      item.product_name,
      item.product_desc,
      item.hsn_code,
      item.quantity,
      item.qtyUnit,
      item.taxable_amount,
      item.cgst_rate,
      item.sgst_rate,
      item.igst_rate,
      item.cess_rate,
      index === 0 ? ewayBill.transport_details.transporter_name : '',
      index === 0 ? ewayBill.transport_details.trans_mode : '',
      index === 0 ? ewayBill.transport_details.vehicle_no : '',
      index === 0 ? ewayBill.transport_details.trans_distance : '',
      index === 0 ? ewayBill.value_details.total_invoice_value : ''
    ]);
  });

  return csv.map(row => row.join(',')).join('\n');
};

// Helper functions
const formatDate = (date) => {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const getStateCode = (stateOrGstin) => {
  if (!stateOrGstin) return '99';
  if (/^\d{2}/.test(stateOrGstin)) {
    return stateOrGstin.substring(0, 2);
  }
  // State name to code mapping
  const stateCodes = {
    'MAHARASHTRA': '27',
    'KARNATAKA': '29',
    'DELHI': '07',
    'TAMIL NADU': '33',
    'GUJARAT': '24',
    'RAJASTHAN': '08',
    'UTTAR PRADESH': '09',
    'WEST BENGAL': '19',
    'MADHYA PRADESH': '23',
    'ANDHRA PRADESH': '28',
    'TELANGANA': '36',
    'KERALA': '32',
    'PUNJAB': '03',
    'HARYANA': '06',
    'BIHAR': '10'
  };
  return stateCodes[stateOrGstin.toUpperCase()] || '99';
};

export default {
  generateEWayBill,
  generateBulkEWayBills,
  generateEWayBillCSV
};
