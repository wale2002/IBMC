'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const state = {
  Pledges: [{
    _row: 2, 'Pledge ID': 'PLG-1', 'Donor ID': 'DNR-1', Currency: 'NGN',
    'Total Amount': 1000, 'Received Amount': 0, 'Outstanding Amount': 1000,
    Status: 'Pledged', 'Next Due Date': new Date(2027, 0, 1, 12)
  }],
  Installments: [
    { _row: 2, 'Installment ID': 'INS-1', 'Pledge ID': 'PLG-1', 'Due Date': new Date(2027, 0, 1, 12), Amount: 300, 'Received Amount': 0, 'Outstanding Amount': 300, Status: 'Scheduled' },
    { _row: 3, 'Installment ID': 'INS-2', 'Pledge ID': 'PLG-1', 'Due Date': new Date(2027, 1, 1, 12), Amount: 300, 'Received Amount': 0, 'Outstanding Amount': 300, Status: 'Scheduled' },
    { _row: 4, 'Installment ID': 'INS-3', 'Pledge ID': 'PLG-1', 'Due Date': new Date(2027, 2, 1, 12), Amount: 400, 'Received Amount': 0, 'Outstanding Amount': 400, Status: 'Scheduled' }
  ],
  Contributions: [{ _row: 2, 'Contribution ID': 'CTB-1', 'Pledge ID': 'PLG-1', Currency: 'NGN', Amount: 350, Status: 'Received' }]
};

const context = {
  console, Date, Math, Number, String, Boolean, Error, Object, RegExp,
  SHEETS: { pledges: 'Pledges', installments: 'Installments', contributions: 'Contributions' },
  getAllowedCurrencies_: () => ['NGN', 'USD'],
  dateAtNoon_: value => {
    const date = new Date(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  },
  findObject_: (sheet, header, expected) => state[sheet].find(row => String(row[header]) === String(expected)) || null,
  listObjects_: sheet => state[sheet],
  updateObjectRow_: (sheet, rowNumber, updates) => {
    const record = state[sheet].find(row => row._row === rowNumber);
    Object.assign(record, updates);
    return record;
  },
  audit_: () => {}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'Domain.gs'), 'utf8'), context, { filename: 'Domain.gs' });
vm.runInContext(fs.readFileSync(path.join(root, 'Ledger.gs'), 'utf8'), context, { filename: 'Ledger.gs' });

context.applyContributionToPledge_(state.Contributions[0], 'test@example.com');

assert.equal(state.Installments[0].Status, 'Paid');
assert.equal(state.Installments[0]['Outstanding Amount'], 0);
assert.equal(state.Installments[1].Status, 'Partially Paid');
assert.equal(state.Installments[1]['Received Amount'], 50);
assert.equal(state.Installments[1]['Outstanding Amount'], 250);
assert.equal(state.Pledges[0]['Received Amount'], 350);
assert.equal(state.Pledges[0]['Outstanding Amount'], 650);
assert.equal(state.Pledges[0].Status, 'Partially Fulfilled');
assert.equal(state.Pledges[0]['Next Due Date'].getTime(), state.Installments[1]['Due Date'].getTime());

console.log('Ledger allocation tests passed');
