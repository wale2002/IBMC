/**
 * Google Sheets persistence helpers.
 */

function getSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  const configuredId = properties.getProperty('SPREADSHEET_ID');
  if (configuredId) return SpreadsheetApp.openById(configuredId);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('SPREADSHEET_ID is not configured. Run setupSystem from the target spreadsheet.');
  properties.setProperty('SPREADSHEET_ID', active.getId());
  return active;
}

function getSheet_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error(`Required sheet not found: ${sheetName}. Run setupSystem.`);
  return sheet;
}

function getHeaders_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(String);
}

function safeCellValue_(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function appendObject_(sheetName, record) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);
  if (!headers.length) throw new Error(`Sheet ${sheetName} has no header row.`);
  const row = headers.map(header => safeCellValue_(record[header] === undefined ? '' : record[header]));
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function rowToObject_(headers, rowValues, rowNumber) {
  const result = { _row: rowNumber };
  headers.forEach((header, index) => { result[header] = rowValues[index]; });
  return result;
}

function listObjects_(sheetName) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1)
    .map((row, index) => rowToObject_(headers, row, index + 2))
    .filter(record => headers.some(header => record[header] !== ''));
}

function findObject_(sheetName, headerName, expectedValue) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return null;
  const headers = values[0].map(String);
  const columnIndex = headers.indexOf(headerName);
  if (columnIndex < 0) throw new Error(`Column ${headerName} not found in ${sheetName}.`);
  const expected = String(expectedValue).trim().toLowerCase();
  for (let i = 1; i < values.length; i += 1) {
    if (String(values[i][columnIndex]).trim().toLowerCase() === expected) {
      return rowToObject_(headers, values[i], i + 1);
    }
  }
  return null;
}

function updateObjectRow_(sheetName, rowNumber, updates) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);
  if (rowNumber < 2 || rowNumber > sheet.getLastRow()) throw new Error(`Invalid row ${rowNumber} in ${sheetName}.`);
  const range = sheet.getRange(rowNumber, 1, 1, headers.length);
  const current = range.getValues()[0];
  headers.forEach((header, index) => {
    if (Object.prototype.hasOwnProperty.call(updates, header)) {
      current[index] = safeCellValue_(updates[header]);
    }
  });
  range.setValues([current]);
  return rowToObject_(headers, current, rowNumber);
}

function generateId_(prefix) {
  const date = Utilities.formatDate(new Date(), APP.timeZone, 'yyyyMMdd');
  const token = Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
  return `${prefix}-${date}-${token}`;
}

function formatDate_(date) {
  if (!date) return '';
  return Utilities.formatDate(new Date(date), APP.timeZone, APP.dateFormat);
}

function formatDateTime_(date) {
  if (!date) return '';
  return Utilities.formatDate(new Date(date), APP.timeZone, APP.dateTimeFormat);
}

function dateAtNoon_(date) {
  const value = new Date(date);
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
}

function daysBetween_(earlier, later) {
  const ms = dateAtNoon_(later).getTime() - dateAtNoon_(earlier).getTime();
  return Math.floor(ms / 86400000);
}

function jsonForAudit_(value) {
  if (value === undefined || value === null || value === '') return '';
  const text = JSON.stringify(value, (key, item) => {
    if (key === '_row') return undefined;
    return item;
  });
  return text.length > 5000 ? `${text.slice(0, 4990)}...` : text;
}

function activeActor_() {
  try {
    return Session.getActiveUser().getEmail() || 'system';
  } catch (error) {
    return 'system';
  }
}

function audit_(action, entityType, entityId, summary, before, after, actor) {
  appendObject_(SHEETS.audit, {
    'Audit ID': generateId_(APP.idPrefixes.audit),
    'Occurred At': new Date(),
    'Actor': actor || activeActor_(),
    'Action': sanitizeText_(action, 80),
    'Entity Type': sanitizeText_(entityType, 80),
    'Entity ID': sanitizeText_(entityId, 80),
    'Summary': sanitizeText_(summary, 500),
    'Before JSON': jsonForAudit_(before),
    'After JSON': jsonForAudit_(after)
  });
}

function findDonor_(email, phone) {
  const normalizedEmail = normalizeEmail_(email);
  const normalizedPhone = normalizePhone_(phone);
  const donors = listObjects_(SHEETS.donors);
  return donors.find(donor => {
    const emailMatch = normalizedEmail && normalizeEmail_(donor.Email) === normalizedEmail;
    const phoneMatch = normalizedPhone && normalizePhone_(donor.Phone) === normalizedPhone;
    return emailMatch || phoneMatch;
  }) || null;
}

function upsertDonor_(donorPayload, actor) {
  const existing = findDonor_(donorPayload.email, donorPayload.phone);
  const now = new Date();
  if (existing) {
    const updates = {
      'Updated At': now,
      'Full Name': existing['Full Name'] || donorPayload.fullName,
      'Email': existing.Email || donorPayload.email,
      'Phone': existing.Phone || donorPayload.phone,
      'Address': existing.Address || donorPayload.address,
      'Country': existing.Country || donorPayload.country,
      'Organisation': existing.Organisation || donorPayload.organisation,
      'Preferred Communication': existing['Preferred Communication'] || donorPayload.preferredCommunication,
      'Consent At': existing['Consent At'] || now,
      'Status': existing.Status === 'Anonymised' ? 'Active' : (existing.Status || 'Active')
    };
    const updated = updateObjectRow_(SHEETS.donors, existing._row, updates);
    audit_('MATCH', 'Donor', existing['Donor ID'], 'Matched submission to an existing donor; existing contact fields were preserved', existing, updated, actor);
    return updated;
  }

  const donorId = generateId_(APP.idPrefixes.donor);
  const record = {
    'Donor ID': donorId,
    'Created At': now,
    'Updated At': now,
    'Full Name': donorPayload.fullName,
    'Email': donorPayload.email,
    'Phone': donorPayload.phone,
    'Address': donorPayload.address,
    'Country': donorPayload.country,
    'Organisation': donorPayload.organisation,
    'Preferred Communication': donorPayload.preferredCommunication,
    'Consent At': now,
    'Status': 'Active',
    'Notes': ''
  };
  appendObject_(SHEETS.donors, record);
  audit_('CREATE', 'Donor', donorId, 'Created donor record', '', record, actor);
  return findObject_(SHEETS.donors, 'Donor ID', donorId);
}
