'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'Index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) throw new Error('Index.html client script was not found');

const script = match[1].replace(
  'const CONFIG = <?!= publicConfigJson ?>;',
  'const CONFIG = { organisationName: "IBMC", intro: "", contactEmail: "", contactPhone: "", privacyNoticeUrl: "", allowedCurrencies: ["NGN"], defaultCurrency: "NGN", paystackEnabled: false, bankTransferInstructions: "" };'
);
new vm.Script(script, { filename: 'Index.client.js' });
console.log('Index client script syntax passed');
