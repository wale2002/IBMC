'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scriptFiles = fs.readdirSync(root).filter(name => name.endsWith('.gs'));
const scripts = scriptFiles.map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
const html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));

const functionNames = new Set(Array.from(scripts.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g), match => match[1]));
[
  'doGet', 'submitPublicForm', 'setupSystem', 'installAutomation',
  'runDailyReminders', 'reconcilePendingPayments', 'verifySelectedPayment',
  'confirmSelectedManualReceipt', 'approveSelectedAsset', 'acceptSelectedService'
].forEach(name => assert(functionNames.has(name), `Missing Apps Script entry point: ${name}`));

const ids = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), match => match[1]));
Array.from(html.matchAll(/byId\('([^']+)'\)/g), match => match[1])
  .forEach(id => assert(ids.has(id), `Index.html references missing element id: ${id}`));

assert(!/sk_(?:test|live)_[A-Za-z0-9]+/.test(scripts + html), 'A Paystack secret appears to be embedded in source');
assert(manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets'));
assert(manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.external_request'));
assert(manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.send_mail'));
assert.equal(manifest.timeZone, 'Africa/Lagos');

console.log(`Static integration checks passed for ${scriptFiles.length} Apps Script files and ${ids.size} HTML ids`);
