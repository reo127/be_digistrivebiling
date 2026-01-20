# Frontend Implementation Guide for Batch-Wise Display

## ✅ Backend Complete

Backend APIs are ready:
- `GET /api/products/with-batches` - Products with their batches
- `GET /api/products/batches-for-invoice` - Formatted batches for invoice dropdown
- Frontend API methods added in `utils/api.js`

---

## 📋 Frontend Changes Needed

### **1. Product List Page**
**File:** `/app/dashboard/products/page.js`

**Changes:**
```javascript
// Change API call from:
const data = await productsAPI.getAll();

// To:
const data = await productsAPI.getAllWithBatches();

// Update table to show batches:
{data.map(product => (
  product.batches.length > 0 ? (
    // Show each batch as separate row
    product.batches.map((batch, batchIdx) => (
      <tr key={`${product._id}-${batch._id}`}>
        <td>{product.name}</td>
        <td>{batch.batchNo || 'N/A'}</td>
        <td>₹{batch.sellingPrice}</td>
        <td>{batch.quantity}</td>
        <td>{batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : 'N/A'}</td>
        <td>Actions...</td>
      </tr>
    ))
  ) : (
    // Product with no batches
    <tr key={product._id}>
      <td>{product.name}</td>
      <td colSpan="5">No stock available</td>
    </tr>
  )
))}
```

---

### **2. Invoice Creation Page**
**File:** `/app/dashboard/invoices/new/page.js`

**Changes:**
```javascript
// Load batches instead of products:
const batches = await productsAPI.getBatchesForInvoice();

// Product dropdown shows batches:
<select onChange={handleBatchSelect}>
  <option value="">Select Product</option>
  {batches.map(batch => (
    <option key={batch.batchId} value={JSON.stringify(batch)}>
      {batch.label}
      {/* e.g., "ABC Medicine - ₹300 (Batch: B001, Stock: 50, Exp: 31/12/2025)" */}
    </option>
  ))}
</select>

// On selection, auto-fill:
const handleBatchSelect = (e) => {
  const batch = JSON.parse(e.target.value);
  setSelectedItem({
    batchId: batch.batchId,
    productId: batch.productId,
    productName: batch.productName,
    sellingPrice: batch.sellingPrice,
    gstRate: batch.gstRate,
    availableQuantity: batch.availableQuantity,
    // ... etc
  });
};

// When submitting invoice, send batchId in items:
{
  items: [{
    batch: selectedItem.batchId,  // ← Send batch ID
    product: selectedItem.productId,
    quantity: enteredQuantity,
    sellingPrice: selectedItem.sellingPrice,
    // ... etc
  }]
}
```

---

### **3. Purchase Edit Page**
**File:** `/app/dashboard/purchases/[id]/page.js`

**Changes:**
```javascript
// Display batch number that was auto-generated:
{purchase.items.map(item => (
  <div key={item._id}>
    <label>Batch Number:</label>
    <input 
      value={item.batchNo || 'Auto-generated'}
      disabled  // Show but don't allow edit
    />
  </div>
))}
```

---

## 🎯 Implementation Order

### Step 1: Product List (Easiest)
1. Change API call to `getAllWithBatches()`
2. Update table headers: Add "Batch No" column
3. Map through batches instead of products

### Step 2: Invoice Creation (Medium)
1. Change API call to `getBatchesForInvoice()`
2. Update dropdown to show batch labels
3. Store `batchId` when item added
4. Send `batch` field in invoice items

### Step 3: Purchase Display (Easy)
1. Show `item.batchNo` in purchase view
2. Make it read-only

---

## ⚠️ Testing Checklist

- [ ] Products page shows batches correctly
- [ ] Products with multiple batches show multiple rows
- [ ] Invoice dropdown shows all batches
- [ ] Can select specific batch in invoice
- [ ] Invoice saves with correct batch reference
- [ ] Stock deduction happens from correct batch
- [ ] Old invoices/products still work
- [ ] Purchase form shows batch numbers

---

## 🚀 Ready to Implement

All backend is done. Frontend changes are straightforward:
1. Change API calls
2. Update UI to display batch data
3. Pass batchId when creating invoices

**No breaking changes!** Old data will continue to work.

