'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = {
  console,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Error,
  Object,
  RegExp,
  getAllowedCurrencies_: () => ['NGN', 'USD']
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'Domain.gs'), 'utf8'), context, { filename: 'Domain.gs' });
vm.runInContext(fs.readFileSync(path.join(root, 'Repository.gs'), 'utf8'), context, { filename: 'Repository.gs' });

function iso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

assert.equal(context.normalizeEmail_('  DONOR@Example.COM '), 'donor@example.com');
assert.equal(context.normalizePhone_(' +234 (803) 123-4567 '), '+2348031234567');
assert.equal(context.sanitizeText_('  hello\n  world ', 50), 'hello world');
assert.equal(context.safeCellValue_('=IMPORTXML("https://example.com")'), '\'=IMPORTXML("https://example.com")');
assert.equal(context.isValidEmail_('donor@example.com'), true);
assert.equal(context.isValidEmail_('not-an-email'), false);

const schedule = context.buildInstallmentSchedule_(100000, 30000, 'Monthly', '2026-01-31', '2026-05-31');
assert.deepEqual(Array.from(schedule, item => item.amount), [30000, 30000, 30000, 10000]);
assert.deepEqual(Array.from(schedule, item => iso(item.dueDate)), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);

const oneOff = context.buildInstallmentSchedule_(5000, '', 'One-off', '2026-09-14', '');
assert.equal(oneOff.length, 1);
assert.equal(oneOff[0].amount, 5000);

assert.throws(
  () => context.buildInstallmentSchedule_(100000, 30000, 'Monthly', '2026-01-31', '2026-02-28'),
  /does not allow enough installments/
);
assert.equal(context.calculatePledgeStatus_(100, 0, 'Pledged'), 'Pledged');
assert.equal(context.calculatePledgeStatus_(100, 25, 'Pledged'), 'Partially Fulfilled');
assert.equal(context.calculatePledgeStatus_(100, 100, 'Pledged'), 'Fulfilled');
assert.equal(context.calculatePledgeStatus_(100, 100, 'Cancelled'), 'Cancelled');
assert.equal(context.calculatePledgeStatus_(100, 100, 'Paused'), 'Fulfilled');
assert.equal(context.toMinorUnits_(1234.56, 'NGN'), '123456');
assert.throws(() => context.toMinorUnits_(25, 'GBP'), /supports NGN and USD/);

const donor = context.validateDonorPayload_({
  fullName: 'Test Donor', email: 'test@example.com', phone: '', consent: true
});
assert.equal(donor.fullName, 'Test Donor');
assert.equal(donor.country, 'Nigeria');
assert.throws(() => context.validateDonorPayload_({ fullName: 'No Contact', consent: true }), /Email or phone/);
assert.throws(() => context.validateDonorPayload_({ fullName: 'No Consent', email: 'x@example.com' }), /Consent/);

console.log('Domain tests passed');
