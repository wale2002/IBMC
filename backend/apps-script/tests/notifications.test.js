'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const audits = [];
let automaticEmails = 'FALSE';
let sent = 0;
const context = {
  console: { error: () => {} },
  Date,
  Math,
  Number,
  String,
  Boolean,
  Error,
  Object,
  RegExp,
  getSetting_: key => key === 'AUTOMATIC_EMAILS' ? automaticEmails : '',
  MailApp: {
    getRemainingDailyQuota: () => 10,
    sendEmail: () => { sent += 1; }
  },
  audit_: (...args) => audits.push(args)
};

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'Config.gs'), 'utf8'), context, { filename: 'Config.gs' });
vm.runInContext(fs.readFileSync(path.join(root, 'Domain.gs'), 'utf8'), context, { filename: 'Domain.gs' });
vm.runInContext(fs.readFileSync(path.join(root, 'Notifications.gs'), 'utf8'), context, { filename: 'Notifications.gs' });
context.getSetting_ = (key, fallback) => key === 'AUTOMATIC_EMAILS' ? automaticEmails : fallback;

const skipped = context.sendEmailSafely_('donor@example.com', 'Test subject', 'Test body', {
  entityType: 'Donor', entityId: 'DNR-1'
});
assert.equal(skipped.sent, false);
assert.equal(skipped.reason, 'Automatic emails disabled');
assert.equal(sent, 0);
assert.equal(audits.at(-1)[0], 'EMAIL_NOT_SENT');

automaticEmails = 'TRUE';
context.audit_ = () => { throw new Error('Audit storage unavailable'); };
const delivered = context.sendEmailSafely_('donor@example.com', 'Test subject', 'Test body', {
  entityType: 'Donor', entityId: 'DNR-1'
});
assert.equal(delivered.sent, true);
assert.equal(sent, 1);

context.audit_ = (...args) => audits.push(args);
context.MailApp.getRemainingDailyQuota = () => 0;
assert.equal(context.sendEmailSafely_('donor@example.com', 'Subject', 'Body').reason, 'Daily email quota exhausted');
assert.equal(audits.at(-1)[0], 'EMAIL_NOT_SENT');
context.MailApp.getRemainingDailyQuota = () => { throw new Error('Mail service unavailable'); };
assert.equal(context.sendEmailSafely_('donor@example.com', 'Subject', 'Body').sent, false);
assert.equal(audits.at(-1)[0], 'EMAIL_FAILED');

// A failed upcoming reminder remains eligible once email service recovers.
const installment = {
  _row: 2, 'Installment ID': 'INS-1', 'Pledge ID': 'PLG-1', 'Donor ID': 'DNR-1',
  'Due Date': new Date(), 'Outstanding Amount': 100, Currency: 'NGN',
  Status: 'Due', 'Reminder Count': 0, 'Last Reminder At': ''
};
const pledge = { _row: 2, 'Pledge ID': 'PLG-1', Status: 'Pledged' };
const donor = { 'Donor ID': 'DNR-1', 'Full Name': 'Test', Email: 'donor@example.com', Status: 'Active', 'Preferred Communication': 'Email' };
const rows = { Installments: [installment], Pledges: [pledge], Donors: [donor], Reminders: [] };
let released = 0;
Object.assign(context, {
  assertTrustee_: () => 'trustee@example.com',
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => { released += 1; } }) },
  refreshInstallmentStatuses_: () => {},
  dateAtNoon_: value => { const d = new Date(value); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); },
  daysBetween_: (a, b) => Math.round((context.dateAtNoon_(b) - context.dateAtNoon_(a)) / 86400000),
  listObjects_: sheet => rows[sheet],
  appendObject_: (sheet, row) => rows[sheet].push(row),
  updateObjectRow_: (sheet, row, updates) => Object.assign(rows[sheet].find(item => item._row === row), updates),
  generateId_: () => 'RMD-1',
  formatDate_: value => new Date(value).toISOString().slice(0, 10),
  formatMoney_: value => String(value),
  acknowledgementBody_: (name, lines) => lines.join('\n')
});
context.MailApp.getRemainingDailyQuota = () => 0;
assert.equal(context.runDailyReminders().failed, 1);
assert.equal(installment['Last Reminder At'], '');
assert.equal(installment['Reminder Count'], 0);
context.MailApp.getRemainingDailyQuota = () => 10;
assert.equal(context.runDailyReminders().emailed, 1);
assert.equal(installment['Reminder Count'], 1);
assert.equal(context.runDailyReminders().emailed, 0);
assert.equal(rows.Reminders.length, 2);
installment['Last Reminder At'] = '';
for (const status of ['Paused', 'Cancelled', 'Lapsed', 'Fulfilled']) {
  pledge.Status = status;
  assert.equal(context.runDailyReminders().skipped, 1);
}
assert.equal(released, 7);
context.assertTrustee_ = () => { throw new Error('Not authorised'); };
assert.throws(() => context.runDailyReminders(), /Not authorised/);

console.log('Notification outcome tests passed');
