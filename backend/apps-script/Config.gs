/**
 * IBMC Endowment Fund MVP configuration and schema.
 * Store secrets and environment values in Apps Script Properties.
 */

const APP = Object.freeze({
  name: 'IBMC Endowment Fund',
  version: '1.1.0',
  timeZone: 'Africa/Lagos',
  dateFormat: 'yyyy-MM-dd',
  dateTimeFormat: 'yyyy-MM-dd HH:mm:ss',
  idPrefixes: Object.freeze({
    donor: 'DNR',
    pledge: 'PLG',
    installment: 'INS',
    contribution: 'CTB',
    asset: 'AST',
    service: 'SVC',
    reminder: 'RMD',
    investment: 'INV',
    audit: 'AUD'
  })
});

const SHEETS = Object.freeze({
  settings: 'Settings',
  donors: 'Donors',
  pledges: 'Pledges',
  installments: 'Installments',
  contributions: 'Contributions',
  assets: 'Assets',
  services: 'Services',
  reminders: 'Reminders',
  investments: 'Investments',
  audit: 'AuditLog',
  dashboard: 'Dashboard'
});

const SCHEMA = Object.freeze({
  Settings: ['Key', 'Value', 'Description'],
  Donors: [
    'Donor ID', 'Created At', 'Updated At', 'Full Name', 'Email', 'Phone',
    'Address', 'Country', 'Organisation', 'Preferred Communication',
    'Consent At', 'Status', 'Notes'
  ],
  Pledges: [
    'Pledge ID', 'Donor ID', 'Created At', 'Total Amount', 'Currency',
    'Donation Type', 'Frequency', 'Installment Amount', 'Start Date',
    'End Date', 'Received Amount', 'Outstanding Amount', 'Status',
    'Purpose Restriction', 'Conditions', 'Last Reminder At', 'Next Due Date',
    'Updated At'
  ],
  Installments: [
    'Installment ID', 'Pledge ID', 'Donor ID', 'Due Date', 'Amount',
    'Currency', 'Received Amount', 'Outstanding Amount', 'Status',
    'Last Reminder At', 'Reminder Count', 'Updated At'
  ],
  Contributions: [
    'Contribution ID', 'Donor ID', 'Pledge ID', 'Created At', 'Received At',
    'Donation Type', 'Amount', 'Currency', 'Payment Method', 'Status',
    'Receipt Number', 'Gateway', 'Gateway Reference', 'Gateway Transaction ID',
    'Gateway Fee', 'Gateway Channel', 'Purpose Restriction', 'Evidence URL',
    'Notes', 'Updated At'
  ],
  Assets: [
    'Asset ID', 'Donor ID', 'Created At', 'Asset Type', 'Description',
    'Estimated Value', 'Currency', 'Ownership Details', 'Evidence URL',
    'Status', 'Reviewer', 'Reviewed At', 'Transfer Date', 'Conditions',
    'Notes', 'Updated At'
  ],
  Services: [
    'Service ID', 'Donor ID', 'Created At', 'Skill Offered', 'Hours Offered',
    'Availability', 'Conditions', 'Status', 'Assigned To', 'Scheduled Date',
    'Completed Hours', 'Notes', 'Updated At'
  ],
  Reminders: [
    'Reminder ID', 'Created At', 'Donor ID', 'Pledge ID', 'Installment ID',
    'Channel', 'Recipient', 'Reminder Type', 'Due Date', 'Amount', 'Currency',
    'Status', 'Sent At', 'Error'
  ],
  Investments: [
    'Investment ID', 'Period End', 'Manager', 'Opening Value', 'Contributions',
    'Investment Income', 'Fees', 'Distributions', 'Closing Value', 'Currency',
    'Report URL', 'Reconciled By', 'Reconciled At', 'Notes'
  ],
  AuditLog: [
    'Audit ID', 'Occurred At', 'Actor', 'Action', 'Entity Type', 'Entity ID',
    'Summary', 'Before JSON', 'After JSON'
  ]
});

const DEFAULT_SETTINGS = Object.freeze([
  ['ORGANISATION_NAME', 'Igbajo Baptist Medical Centre', 'Name shown to donors'],
  ['CONTACT_EMAIL', '', 'Donor-relations reply address'],
  ['CONTACT_PHONE', '', 'Donor-relations telephone'],
  ['ALLOWED_CURRENCIES', 'NGN,USD', 'Currencies enabled for online Paystack payments'],
  ['DEFAULT_CURRENCY', 'NGN', 'Default currency on the public form'],
  ['REMINDER_DAYS_BEFORE', '7', 'Days before an installment is due'],
  ['OVERDUE_REPEAT_DAYS', '14', 'Minimum days between overdue reminders'],
  ['BANK_TRANSFER_INSTRUCTIONS', '', 'Public manual-payment instructions'],
  ['PRIVACY_NOTICE_URL', '', 'Published privacy notice'],
  ['DONOR_PAGE_INTRO', 'Support long-term healthcare for Igbajo and surrounding communities.', 'Public form introduction'],
  ['RECEIPT_PREFIX', 'IBMC', 'Prefix used for receipt numbers'],
  ['AUTOMATIC_EMAILS', 'FALSE', 'TRUE enables acknowledgements and reminders'],
  ['PAYSTACK_ENABLED', 'FALSE', 'TRUE enables online payments after credentials are configured']
]);

const STATUS = Object.freeze({
  donor: ['Active', 'Inactive', 'Anonymised'],
  pledge: ['Pledged', 'Partially Fulfilled', 'Fulfilled', 'Paused', 'Cancelled', 'Lapsed'],
  installment: ['Scheduled', 'Due', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled'],
  contribution: ['Pending Payment', 'Pending Verification', 'Payment Init Failed', 'Received', 'Rejected', 'Refunded', 'Chargeback'],
  asset: ['Pending Review', 'Accepted', 'Transfer In Progress', 'Transferred', 'Rejected'],
  service: ['Offered', 'Accepted', 'Scheduled', 'Completed', 'Declined']
});

function getScriptProperty_(key, fallbackValue) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  return value === null || value === '' ? fallbackValue : value;
}

function getSetting_(key, fallbackValue) {
  const cache = CacheService.getScriptCache();
  const cacheKey = `setting:${key}`;
  const cached = cache.get(cacheKey);
  if (cached !== null) return cached;

  let value = fallbackValue;
  try {
    const sheet = getSheet_(SHEETS.settings);
    const values = sheet.getDataRange().getDisplayValues();
    for (let i = 1; i < values.length; i += 1) {
      if (String(values[i][0]).trim() === key) {
        value = values[i][1];
        break;
      }
    }
  } catch (error) {
    value = fallbackValue;
  }

  const safeValue = value === undefined || value === null ? '' : String(value);
  cache.put(cacheKey, safeValue, 300);
  return safeValue;
}

function getAllowedCurrencies_() {
  return getSetting_('ALLOWED_CURRENCIES', 'NGN,USD')
    .split(',')
    .map(value => value.trim().toUpperCase())
    .filter(Boolean);
}

function isTrue_(value) {
  return String(value).trim().toUpperCase() === 'TRUE';
}
