'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const home = fs.readFileSync(path.join(repoRoot, 'dist', 'index.html'), 'utf8');
const pledge = fs.readFileSync(path.join(repoRoot, 'dist', 'pledge', 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(repoRoot, 'dist', 'admin', 'index.html'), 'utf8');
const siteScript = fs.readFileSync(path.join(repoRoot, 'dist', 'site.js'), 'utf8');
const runtimeConfig = fs.readFileSync(path.join(repoRoot, 'dist', 'runtime-config.js'), 'utf8');

assert(home.indexOf('runtime-config.js') < home.indexOf('site.js'));
assert(pledge.indexOf('runtime-config.js') < pledge.indexOf('site.js'));
assert(home.includes('data-live-intake'));
assert(pledge.includes('data-live-only'));
assert(home.includes('./admin/'));
assert(pledge.includes('../admin/'));
assert(admin.includes('appsScriptAdminUrl'));
assert(admin.includes('Continue with Google'));
assert(siteScript.includes('appsScriptWebAppUrl'));
assert(siteScript.includes('script.google.com'));
const configuredUrl = runtimeConfig.match(/appsScriptWebAppUrl:\s*"([^"]+)"/);
assert(configuredUrl);
assert.match(
  configuredUrl[1],
  /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/
);
assert.match(runtimeConfig, /appsScriptAdminUrl:\s*"[^"]*"/);

function boot(configuredUrl) {
  const element = (value = '') => ({
    value, hidden: true, textContent: '', href: './pledge/',
    classList: { toggle() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, querySelectorAll() { return []; }
  });
  const inputs = new Map();
  const form = element();
  form.querySelector = selector => {
    if (!inputs.has(selector)) {
      inputs.set(selector, element(selector.includes('contributionType') ? 'Cash gift' : selector.includes('currency') ? 'NGN' : ''));
    }
    return inputs.get(selector);
  };
  const link = element();
  const liveOnly = element();
  const elements = new Map([['#pledge-form', form]]);
  const document = {
    body: element(),
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    querySelectorAll(selector) {
      if (selector === '[data-live-intake]') return [link];
      if (selector === '[data-live-only]') return [liveOnly];
      return [];
    }
  };
  vm.runInNewContext(siteScript, {
    document, URL, Date, Intl,
    window: { IBMC_CONFIG: { appsScriptWebAppUrl: configuredUrl }, scrollY: 0, addEventListener() {} }
  }, { filename: 'site.js' });
  return { link, liveOnly, elements };
}

for (const invalid of ['', 'not a URL', 'https://example.com/macros/s/test/exec',
  'http://script.google.com/macros/s/test/exec', 'https://script.google.com/macros/s/test/dev',
  'https://user:pass@script.google.com/macros/s/test/exec', 'https://script.google.com:444/macros/s/test/exec']) {
  const state = boot(invalid);
  assert.equal(state.link.href, './pledge/');
  assert.equal(state.liveOnly.hidden, true);
}
const deployed = 'https://script.google.com/macros/s/test-deployment_123/exec';
const live = boot(deployed);
assert.equal(live.link.href, deployed);
assert.equal(live.link.target, '_blank');
assert.equal(live.link.rel, 'noopener');
assert.equal(live.liveOnly.hidden, false);
assert.equal(live.elements.get('[data-intake-badge]').textContent, 'Live intake');

console.log('Public site deployment bridge tests passed');
