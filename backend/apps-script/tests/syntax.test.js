'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const order = [
  'Config.gs', 'Domain.gs', 'Repository.gs', 'Ledger.gs',
  'Notifications.gs', 'PaymentGateway.gs', 'Setup.gs', 'Admin.gs', 'Code.gs'
];
const combined = order.map(name => `\n/* ${name} */\n${fs.readFileSync(path.join(root, name), 'utf8')}`).join('\n');
new vm.Script(combined, { filename: 'IBMC_Endowment_MVP.gs' });
console.log(`Syntax check passed for ${order.length} Apps Script files`);
