'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const adminServer = fs.readFileSync(path.join(root, 'Admin.gs'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'Admin.html'), 'utf8');
const code = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');

for (const handler of ['getAdminDashboardData', 'adminConfirmContribution', 'adminApproveAsset', 'adminAcceptService']) {
  assert.match(adminServer, new RegExp(`function\\s+${handler}\\s*\\(`));
}
assert.match(adminServer, /function getAdminDashboardData\(\)\s*\{\s*const actor = assertTrustee_\(\)/);
assert.match(adminServer, /function adminConfirmContribution[\s\S]*bankConfirmed !== true/);
assert.match(adminServer, /function adminApproveAsset[\s\S]*dueDiligenceConfirmed !== true/);
assert.match(adminServer, /function adminAcceptService[\s\S]*needConfirmed !== true/);
assert.match(code, /view === 'admin'/);
assert.match(code, /createTemplateFromFile\('Admin'\)/);
assert(adminHtml.includes('Endowment office'));
assert(adminHtml.includes('FOR THE GLORY OF GOD'));
assert(adminHtml.includes('HEALING'));
assert(adminHtml.includes('I matched this payment against the bank record.'));
assert(adminHtml.includes('google.script.run'));
assert.match(adminHtml, /@media\(max-width:820px\)[\s\S]*table,tbody,tr,td \{ display:block/);
assert.match(adminHtml, /td::before \{ content:attr\(data-label\)/);
assert.match(adminHtml, /data-label="Reference"/);
assert.match(adminHtml, /function friendlyAuditSummary\(item\)/);
assert.doesNotMatch(adminHtml, /grid-template-columns:150px 105px 1fr/);
const clientScript = adminHtml.match(/<script>([\s\S]*?)<\/script>/);
assert(clientScript, 'Admin client script was not found');
new vm.Script(clientScript[1], { filename: 'Admin.client.js' });

console.log('Admin dashboard security and integration checks passed');
