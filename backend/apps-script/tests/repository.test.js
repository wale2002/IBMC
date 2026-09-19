'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const donors = [
  {
    _row: 2,
    'Donor ID': 'DNR-1',
    'Full Name': 'First Donor',
    Email: 'first@example.com',
    Phone: '+2348000000001',
    Address: 'Old address',
    Country: 'Nigeria',
    Organisation: 'Existing organisation',
    'Preferred Communication': 'Email',
    'Consent At': new Date('2026-01-01T12:00:00Z'),
    Status: 'Active'
  },
  {
    _row: 3,
    'Donor ID': 'DNR-2',
    'Full Name': 'Second Donor',
    Email: 'second@example.com',
    Phone: '+2348000000002',
    Status: 'Active'
  }
];
const audits = [];
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
  SHEETS: { donors: 'Donors' }
};

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'Domain.gs'), 'utf8'), context, { filename: 'Domain.gs' });
vm.runInContext(fs.readFileSync(path.join(root, 'Repository.gs'), 'utf8'), context, { filename: 'Repository.gs' });
Object.assign(context, {
  listObjects_: sheet => sheet === 'Donors' ? donors.map(donor => ({ ...donor })) : [],
  updateObjectRow_: (sheet, rowNumber, updates) => {
    const record = donors.find(donor => donor._row === rowNumber);
    Object.assign(record, updates);
    return { ...record };
  },
  audit_: (...args) => audits.push(args)
});

const updated = context.upsertDonor_({
  fullName: 'First Donor Updated',
  email: 'first@example.com',
  phone: '+2348000000099',
  address: 'New address',
  country: 'Nigeria',
  organisation: '',
  preferredCommunication: 'WhatsApp'
}, 'public');

assert.equal(updated.Phone, '+2348000000001');
assert.equal(updated.Address, 'Old address');
assert.equal(updated.Organisation, 'Existing organisation');
assert.equal(updated['Preferred Communication'], 'Email');
assert.equal(audits.at(-1)[0], 'CONTACT_REVIEW_REQUESTED');
assert.equal(audits.at(-1)[5].Phone, '+2348000000099');
assert.equal(donors.length, 2);

assert.throws(() => context.upsertDonor_({
  fullName: 'Conflicting Donor',
  email: 'first@example.com',
  phone: '+2348000000002',
  country: 'Nigeria',
  preferredCommunication: 'Email'
}, 'public'), /could not be matched safely/);

console.log('Repository donor matching tests passed');
