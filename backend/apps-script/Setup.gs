/**
 * One-time workbook setup and trustee menu.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('IBMC Endowment')
    .addItem('Set up or repair workbook', 'setupSystem')
    .addItem('Install daily automation', 'installAutomation')
    .addSeparator()
    .addItem('Refresh dashboard', 'rebuildDashboard')
    .addItem('Verify selected Paystack payment', 'verifySelectedPayment')
    .addItem('Confirm selected manual receipt', 'confirmSelectedManualReceipt')
    .addItem('Approve selected asset', 'approveSelectedAsset')
    .addItem('Accept selected service offer', 'acceptSelectedService')
    .addToUi();
}

function setupSystem() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open the target Google Sheet before running setupSystem.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());
  spreadsheet.setSpreadsheetTimeZone(APP.timeZone);

  Object.keys(SCHEMA).forEach(sheetName => ensureSchemaSheet_(spreadsheet, sheetName, SCHEMA[sheetName]));
  if (!spreadsheet.getSheetByName(SHEETS.dashboard)) spreadsheet.insertSheet(SHEETS.dashboard);
  seedSettings_();
  applySheetRules_();
  rebuildDashboard();
  CacheService.getScriptCache().removeAll(DEFAULT_SETTINGS.map(row => `setting:${row[0]}`));
  SpreadsheetApp.flush();

  SpreadsheetApp.getUi().alert(
    'IBMC Endowment setup complete',
    'Review the Settings sheet, configure Script Properties, then install automation and deploy the web app.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function ensureSchemaSheet_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);

  const existingWidth = Math.max(sheet.getLastColumn(), headers.length);
  const existing = sheet.getRange(1, 1, 1, existingWidth).getDisplayValues()[0];
  const hasExistingData = sheet.getLastRow() > 1 || existing.some(Boolean);
  if (hasExistingData) {
    const current = existing.slice(0, headers.length);
    const matches = headers.every((header, index) => current[index] === header);
    if (!matches) {
      throw new Error(`Sheet ${sheetName} already contains data with a different header. Rename it before setup.`);
    }
  } else {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sheet.setFrozenRows(1);
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange
    .setBackground('#17365D')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.setRowHeight(1, 34);
  sheet.getDataRange().setVerticalAlignment('middle');
  sheet.autoResizeColumns(1, headers.length);
  for (let column = 1; column <= headers.length; column += 1) {
    const width = Math.max(95, Math.min(240, sheet.getColumnWidth(column)));
    sheet.setColumnWidth(column, width);
  }
  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), headers.length).createFilter();
  }
  return sheet;
}

function seedSettings_() {
  const sheet = getSheet_(SHEETS.settings);
  const current = listObjects_(SHEETS.settings);
  const keys = new Set(current.map(row => String(row.Key)));
  DEFAULT_SETTINGS.forEach(row => {
    if (!keys.has(row[0])) sheet.appendRow(row);
  });
  sheet.setColumnWidth(1, 210);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(3, 420);
}

function applyValidation_(sheetName, columnName, choices) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);
  const column = headers.indexOf(columnName) + 1;
  if (!column) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(choices, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, column, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
}

function formatColumns_(sheetName, names, format) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);
  names.forEach(name => {
    const column = headers.indexOf(name) + 1;
    if (column) sheet.getRange(2, column, sheet.getMaxRows() - 1, 1).setNumberFormat(format);
  });
}

function applySheetRules_() {
  applyValidation_(SHEETS.donors, 'Status', STATUS.donor);
  applyValidation_(SHEETS.donors, 'Preferred Communication', ['Email', 'WhatsApp', 'Phone']);
  applyValidation_(SHEETS.pledges, 'Status', STATUS.pledge);
  applyValidation_(SHEETS.pledges, 'Frequency', ['One-off', 'Monthly', 'Quarterly', 'Annually']);
  applyValidation_(SHEETS.installments, 'Status', STATUS.installment);
  applyValidation_(SHEETS.contributions, 'Status', STATUS.contribution);
  applyValidation_(SHEETS.assets, 'Status', STATUS.asset);
  applyValidation_(SHEETS.services, 'Status', STATUS.service);

  formatColumns_(SHEETS.pledges, ['Total Amount', 'Installment Amount', 'Received Amount', 'Outstanding Amount'], '#,##0.00');
  formatColumns_(SHEETS.installments, ['Amount', 'Received Amount', 'Outstanding Amount'], '#,##0.00');
  formatColumns_(SHEETS.contributions, ['Amount', 'Gateway Fee'], '#,##0.00');
  formatColumns_(SHEETS.assets, ['Estimated Value'], '#,##0.00');
  formatColumns_(SHEETS.investments, ['Opening Value', 'Contributions', 'Investment Income', 'Fees', 'Distributions', 'Closing Value'], '#,##0.00');

  [SHEETS.settings, SHEETS.audit].forEach(name => {
    const sheet = getSheet_(name);
    if (!sheet.isSheetHidden()) sheet.hideSheet();
  });
}

function installAutomation() {
  assertTrustee_();
  const functions = new Set(['runDailyReminders', 'reconcilePendingPayments']);
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (functions.has(trigger.getHandlerFunction())) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runDailyReminders').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('reconcilePendingPayments').timeBased().everyHours(6).create();
  SpreadsheetApp.getUi().alert('Automation installed: reminders run daily and pending Paystack payments reconcile every six hours.');
}

function rebuildDashboard() {
  const sheet = getSheet_(SHEETS.dashboard);
  sheet.clear();
  sheet.getCharts().forEach(chart => sheet.removeChart(chart));
  sheet.setHiddenGridlines(true);
  sheet.getRange('A1:D1').merge().setValue('IBMC Endowment Fund Dashboard')
    .setFontSize(18).setFontWeight('bold').setFontColor('#000000')
    .setHorizontalAlignment('left');
  sheet.getRange('A2:D2').merge().setValue(`Updated ${formatDateTime_(new Date())}`)
    .setFontColor('#666666');

  const metrics = [
    ['Metric', 'NGN', 'USD', 'Operational count'],
    ['Total pledged', '=SUMIFS(Pledges!D:D,Pledges!E:E,"NGN",Pledges!M:M,"<>Cancelled",Pledges!M:M,"<>Lapsed")', '=SUMIFS(Pledges!D:D,Pledges!E:E,"USD",Pledges!M:M,"<>Cancelled",Pledges!M:M,"<>Lapsed")', ''],
    ['Total received', '=SUMIFS(Contributions!G:G,Contributions!H:H,"NGN",Contributions!J:J,"Received")', '=SUMIFS(Contributions!G:G,Contributions!H:H,"USD",Contributions!J:J,"Received")', ''],
    ['Outstanding pledges', '=SUMIFS(Pledges!L:L,Pledges!E:E,"NGN",Pledges!M:M,"<>Cancelled",Pledges!M:M,"<>Lapsed")', '=SUMIFS(Pledges!L:L,Pledges!E:E,"USD",Pledges!M:M,"<>Cancelled",Pledges!M:M,"<>Lapsed")', ''],
    ['Active donors', '', '', '=COUNTIF(Donors!L:L,"Active")'],
    ['Overdue installments', '', '', '=COUNTIF(Installments!I:I,"Overdue")'],
    ['Assets awaiting transfer', '', '', '=COUNTIF(Assets!J:J,"Accepted")+COUNTIF(Assets!J:J,"Transfer In Progress")'],
    ['Open service offers', '', '', '=COUNTIF(Services!H:H,"Offered")+COUNTIF(Services!H:H,"Accepted")+COUNTIF(Services!H:H,"Scheduled")']
  ];
  sheet.getRange(4, 1, metrics.length, metrics[0].length).setValues(metrics);
  sheet.getRange(4, 1, 1, 4).setBackground('#17365D').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange(5, 2, 3, 2).setNumberFormat('#,##0.00');
  sheet.getRange(4, 1, metrics.length, 4).setBorder(true, true, true, true, true, true, '#D9D9D9', SpreadsheetApp.BorderStyle.SOLID);
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidths(2, 3, 160);

  sheet.getRange('A14').setValue('Operating notes').setFontSize(14).setFontWeight('bold');
  sheet.getRange('A15:D18').setValues([
    ['1', 'Do not add NGN and USD totals together without an approved exchange-rate policy.', '', ''],
    ['2', 'A contribution counts as received only after gateway or trustee verification.', '', ''],
    ['3', 'Investment values are entered and reconciled separately from donation receipts.', '', ''],
    ['4', 'Donor identities are intentionally excluded from this dashboard.', '', '']
  ]);
  sheet.getRange('B15:D18').mergeAcross().setWrap(true);
  sheet.setFrozenRows(4);
}

function assertTrustee_() {
  const allowlist = getScriptProperty_('TRUSTEE_EMAILS', '')
    .split(',').map(normalizeEmail_).filter(Boolean);
  if (!allowlist.length) {
    throw new Error('TRUSTEE_EMAILS is not configured in Script Properties.');
  }
  const active = normalizeEmail_(Session.getActiveUser().getEmail());
  if (!active || !allowlist.includes(active)) {
    throw new Error('Your account is not authorised for trustee actions.');
  }
  return active;
}

function getSelectedRecord_(expectedSheetName) {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet || sheet.getName() !== expectedSheetName) {
    throw new Error(`Select a data row on the ${expectedSheetName} sheet.`);
  }
  const row = sheet.getActiveRange().getRow();
  if (row < 2) throw new Error('Select a data row, not the header.');
  const headers = getHeaders_(sheet);
  return rowToObject_(headers, sheet.getRange(row, 1, 1, headers.length).getValues()[0], row);
}

function verifySelectedPayment() {
  assertTrustee_();
  const record = getSelectedRecord_(SHEETS.contributions);
  if (record.Gateway !== 'Paystack' || !record['Gateway Reference']) {
    throw new Error('The selected row does not contain a Paystack reference.');
  }
  const result = verifyPaystackReference(record['Gateway Reference']);
  SpreadsheetApp.getUi().alert(result.message);
}

function confirmSelectedManualReceipt() {
  const actor = assertTrustee_();
  const record = getSelectedRecord_(SHEETS.contributions);
  const result = confirmContributionReceived_(record, {
    receivedAt: new Date(),
    paymentMethod: record['Payment Method'] || 'Manual',
    notes: record.Notes || 'Confirmed by trustee'
  }, actor);
  SpreadsheetApp.getUi().alert(`Receipt confirmed: ${result.receiptNumber}`);
}

function approveSelectedAsset() {
  const actor = assertTrustee_();
  const record = getSelectedRecord_(SHEETS.assets);
  if (record.Status !== 'Pending Review') throw new Error('Only an asset in Pending Review can be accepted from this menu.');
  const updated = updateObjectRow_(SHEETS.assets, record._row, {
    'Status': 'Accepted', 'Reviewer': actor, 'Reviewed At': new Date(), 'Updated At': new Date()
  });
  audit_('APPROVE', 'Asset', record['Asset ID'], 'Accepted asset subject to completed title and valuation checks', record, updated, actor);
  SpreadsheetApp.getUi().alert(`Asset ${record['Asset ID']} marked Accepted.`);
}

function acceptSelectedService() {
  const actor = assertTrustee_();
  const record = getSelectedRecord_(SHEETS.services);
  if (record.Status !== 'Offered') throw new Error('Only a new service offer can be accepted from this menu.');
  const updated = updateObjectRow_(SHEETS.services, record._row, {
    'Status': 'Accepted', 'Updated At': new Date()
  });
  audit_('ACCEPT', 'Service', record['Service ID'], 'Accepted service offer for scheduling', record, updated, actor);
  SpreadsheetApp.getUi().alert(`Service ${record['Service ID']} marked Accepted.`);
}
