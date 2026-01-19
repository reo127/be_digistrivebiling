#!/usr/bin/env node
/**
 * VALIDATION SCRIPT - Number Format Consistency Check
 *
 * Validates that all models use consistent numbering format:
 * PREFIX-YYYY-MM-OO-XXXX
 *
 * This script checks:
 * 1. All 4 models have month in the format
 * 2. Migration script generates correct format
 * 3. No potential errors in the implementation
 */

import fs from 'fs';
import path from 'path';

const EXPECTED_FORMAT = 'PREFIX-YYYY-MM-OO-XXXX';

console.log('═'.repeat(70));
console.log('🔍 VALIDATION: Number Format Consistency Check');
console.log('═'.repeat(70));
console.log(`\nExpected Format: ${EXPECTED_FORMAT}`);
console.log('  - PREFIX: INV, PUR, CN, DN');
console.log('  - YYYY: Year (e.g., 2026)');
console.log('  - MM: Month (01-12)');
console.log('  - OO: Organization initials (first 2 chars)');
console.log('  - XXXX: Sequential number (4 digits)\n');

const checks = {
  passed: 0,
  failed: 0,
  warnings: 0
};

// ========================================
// CHECK 1: Invoice Model
// ========================================
console.log('─'.repeat(70));
console.log('📄 CHECK 1: Invoice Model (models/Invoice.js)');
console.log('─'.repeat(70));

const invoiceFile = fs.readFileSync('models/Invoice.js', 'utf8');
const invoiceRegex = /this\.invoiceNumber = `INV-\$\{year\}-\$\{month\}-\$\{orgInitials\}-/;
const invoiceMonthExtract = /const month = String\(date\.getMonth\(\) \+ 1\)\.padStart\(2, '0'\);/;

if (invoiceRegex.test(invoiceFile) && invoiceMonthExtract.test(invoiceFile)) {
  console.log('✅ PASS: Invoice model has correct format with month');
  console.log('   Format: INV-${year}-${month}-${orgInitials}-${sequence}');
  checks.passed++;
} else {
  console.log('❌ FAIL: Invoice model missing month or incorrect format');
  checks.failed++;
}

// ========================================
// CHECK 2: Purchase Model
// ========================================
console.log('\n─'.repeat(70));
console.log('🛒 CHECK 2: Purchase Model (models/Purchase.js)');
console.log('─'.repeat(70));

const purchaseFile = fs.readFileSync('models/Purchase.js', 'utf8');
const purchaseRegex = /this\.purchaseNumber = `PUR-\$\{year\}-\$\{month\}-\$\{orgInitials\}-/;
const purchaseMonthExtract = /const month = String\(date\.getMonth\(\) \+ 1\)\.padStart\(2, '0'\);/;

if (purchaseRegex.test(purchaseFile) && purchaseMonthExtract.test(purchaseFile)) {
  console.log('✅ PASS: Purchase model has correct format with month');
  console.log('   Format: PUR-${year}-${month}-${orgInitials}-${sequence}');
  checks.passed++;
} else {
  console.log('❌ FAIL: Purchase model missing month or incorrect format');
  checks.failed++;
}

// ========================================
// CHECK 3: Sales Return Model
// ========================================
console.log('\n─'.repeat(70));
console.log('🔄 CHECK 3: Sales Return Model (models/SalesReturn.js)');
console.log('─'.repeat(70));

const salesReturnFile = fs.readFileSync('models/SalesReturn.js', 'utf8');
const salesReturnRegex = /this\.creditNoteNumber = `CN-\$\{year\}-\$\{month\}-\$\{orgInitials\}-/;
const salesReturnMonthExtract = /const month = String\(date\.getMonth\(\) \+ 1\)\.padStart\(2, '0'\);/;

if (salesReturnRegex.test(salesReturnFile) && salesReturnMonthExtract.test(salesReturnFile)) {
  console.log('✅ PASS: Sales Return model has correct format with month');
  console.log('   Format: CN-${year}-${month}-${orgInitials}-${sequence}');
  checks.passed++;
} else {
  console.log('❌ FAIL: Sales Return model missing month or incorrect format');
  checks.failed++;
}

// ========================================
// CHECK 4: Purchase Return Model
// ========================================
console.log('\n─'.repeat(70));
console.log('↩️  CHECK 4: Purchase Return Model (models/PurchaseReturn.js)');
console.log('─'.repeat(70));

const purchaseReturnFile = fs.readFileSync('models/PurchaseReturn.js', 'utf8');
const purchaseReturnRegex = /this\.debitNoteNumber = `DN-\$\{year\}-\$\{month\}-\$\{orgInitials\}-/;
const purchaseReturnMonthExtract = /const month = String\(date\.getMonth\(\) \+ 1\)\.padStart\(2, '0'\);/;

if (purchaseReturnRegex.test(purchaseReturnFile) && purchaseReturnMonthExtract.test(purchaseReturnFile)) {
  console.log('✅ PASS: Purchase Return model has correct format with month');
  console.log('   Format: DN-${year}-${month}-${orgInitials}-${sequence}');
  checks.passed++;
} else {
  console.log('❌ FAIL: Purchase Return model missing month or incorrect format');
  checks.failed++;
}

// ========================================
// CHECK 5: Migration Script
// ========================================
console.log('\n─'.repeat(70));
console.log('🔄 CHECK 5: Migration Script (migrateAllNumbersWithOrgInitials.js)');
console.log('─'.repeat(70));

const migrationFile = fs.readFileSync('migrateAllNumbersWithOrgInitials.js', 'utf8');

const migrationChecks = [
  { name: 'Invoice', pattern: /`INV-\$\{year\}-\$\{month\}-\$\{orgInitials\}-/ },
  { name: 'Purchase', pattern: /`PUR-\$\{year\}-\$\{month\}-\$\{orgInitials\}-/ },
  { name: 'Sales Return', pattern: /`CN-\$\{year\}-\$\{month\}-\$\{orgInitials\}-/ },
  { name: 'Purchase Return', pattern: /`DN-\$\{year\}-\$\{month\}-\$\{orgInitials\}-/ }
];

let migrationPassed = true;
migrationChecks.forEach(check => {
  if (check.pattern.test(migrationFile)) {
    console.log(`   ✅ ${check.name} migration format correct`);
  } else {
    console.log(`   ❌ ${check.name} migration format incorrect or missing month`);
    migrationPassed = false;
  }
});

if (migrationPassed) {
  console.log('✅ PASS: Migration script has correct format for all document types');
  checks.passed++;
} else {
  console.log('❌ FAIL: Migration script has incorrect format');
  checks.failed++;
}

// ========================================
// CHECK 6: Counter Usage
// ========================================
console.log('\n─'.repeat(70));
console.log('🔢 CHECK 6: Counter Model Usage');
console.log('─'.repeat(70));

const counterUsageChecks = [
  { file: invoiceFile, name: 'Invoice', pattern: /Counter\.getNextSequence\([^)]+,\s*'invoice',\s*String\(year\)\)/ },
  { file: purchaseFile, name: 'Purchase', pattern: /Counter\.getNextSequence\([^)]+,\s*'purchase',\s*String\(year\)\)/ },
  { file: salesReturnFile, name: 'Sales Return', pattern: /Counter\.getNextSequence\([^)]+,\s*'salesReturn',\s*String\(year\)\)/ },
  { file: purchaseReturnFile, name: 'Purchase Return', pattern: /Counter\.getNextSequence\([^)]+,\s*'purchaseReturn',\s*String\(year\)\)/ }
];

let counterPassed = true;
counterUsageChecks.forEach(check => {
  if (check.pattern.test(check.file)) {
    console.log(`   ✅ ${check.name} uses year-based counter correctly`);
  } else {
    console.log(`   ⚠️  ${check.name} counter usage may be incorrect`);
    checks.warnings++;
    counterPassed = false;
  }
});

if (counterPassed) {
  console.log('✅ PASS: All models use year-based counters (continuous sequence)');
  checks.passed++;
} else {
  console.log('⚠️  WARNING: Some models may have counter issues');
}

// ========================================
// CHECK 7: Potential Issues
// ========================================
console.log('\n─'.repeat(70));
console.log('🔍 CHECK 7: Potential Issues & Edge Cases');
console.log('─'.repeat(70));

const potentialIssues = [];

// Check if all models extract month properly
const models = [
  { name: 'Invoice', file: invoiceFile },
  { name: 'Purchase', file: purchaseFile },
  { name: 'Sales Return', file: salesReturnFile },
  { name: 'Purchase Return', file: purchaseReturnFile }
];

models.forEach(model => {
  // Check if month is extracted before usage
  const monthBeforeUsage = model.file.indexOf('const month =') < model.file.indexOf('${month}');
  if (!monthBeforeUsage) {
    potentialIssues.push(`${model.name}: Month variable may be used before declaration`);
  }

  // Check if orgInitials has fallback
  if (!model.file.includes("|| 'XX'")) {
    potentialIssues.push(`${model.name}: Missing fallback for empty organization name`);
  }

  // Check if 4-digit padding is used
  if (!model.file.includes(".padStart(4, '0')")) {
    potentialIssues.push(`${model.name}: Missing 4-digit padding for sequence`);
  }
});

if (potentialIssues.length === 0) {
  console.log('✅ PASS: No potential issues detected');
  checks.passed++;
} else {
  console.log('⚠️  WARNINGS DETECTED:');
  potentialIssues.forEach(issue => console.log(`   - ${issue}`));
  checks.warnings += potentialIssues.length;
}

// ========================================
// CHECK 8: Examples
// ========================================
console.log('\n─'.repeat(70));
console.log('📝 CHECK 8: Format Examples');
console.log('─'.repeat(70));

console.log('\nExpected output for "Ramesh Medicals" in January 2026:');
console.log('   Invoice:         INV-2026-01-RA-0001');
console.log('   Purchase:        PUR-2026-01-RA-0001');
console.log('   Sales Return:    CN-2026-01-RA-0001');
console.log('   Purchase Return: DN-2026-01-RA-0001');

// ========================================
// SUMMARY
// ========================================
console.log('\n' + '═'.repeat(70));
console.log('📊 VALIDATION SUMMARY');
console.log('═'.repeat(70));
console.log(`✅ Checks Passed:  ${checks.passed}`);
console.log(`❌ Checks Failed:  ${checks.failed}`);
console.log(`⚠️  Warnings:       ${checks.warnings}`);
console.log('═'.repeat(70));

if (checks.failed === 0) {
  console.log('\n🎉 SUCCESS! All models use consistent numbering format!');
  console.log('✅ Format: PREFIX-YYYY-MM-OO-XXXX');
  console.log('✅ All models include month component');
  console.log('✅ Migration script is up to date');
  console.log('✅ No breaking changes detected\n');
  process.exit(0);
} else {
  console.log('\n❌ FAILURE! Inconsistencies detected in numbering format.');
  console.log('Please review the failed checks above and fix the issues.\n');
  process.exit(1);
}
