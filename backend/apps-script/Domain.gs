/**
 * Pure validation and scheduling functions. These functions have no dependency
 * on Google services and are covered by the included Node test file.
 */

function requireText_(value, fieldName, maxLength) {
  const text = sanitizeText_(value, maxLength || 500);
  if (!text) throw new Error(`${fieldName} is required.`);
  return text;
}

function sanitizeText_(value, maxLength) {
  const limit = maxLength || 500;
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function normalizeEmail_(value) {
  return sanitizeText_(value, 254).toLowerCase();
}

function normalizePhone_(value) {
  const text = sanitizeText_(value, 40);
  const leadingPlus = text.startsWith('+');
  const digits = text.replace(/\D/g, '');
  return `${leadingPlus ? '+' : ''}${digits}`;
}

function isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail_(value));
}

function toPositiveNumber_(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${fieldName} must be greater than zero.`);
  }
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function parseDateOnly_(value, fieldName) {
  const text = requireText_(value, fieldName, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error(`${fieldName} must use YYYY-MM-DD.`);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    throw new Error(`${fieldName} is not a valid date.`);
  }
  return date;
}

function addMonthsClamped_(date, months) {
  const source = new Date(date.getTime());
  const targetMonth = source.getMonth() + months;
  const targetYear = source.getFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonth + 1, 0, 12).getDate();
  return new Date(targetYear, normalizedMonth, Math.min(source.getDate(), lastDay), 12);
}

function nextFrequencyDate_(date, frequency) {
  const copy = new Date(date.getTime());
  switch (frequency) {
    case 'Monthly': return addMonthsClamped_(copy, 1);
    case 'Quarterly': return addMonthsClamped_(copy, 3);
    case 'Annually': return addMonthsClamped_(copy, 12);
    case 'One-off': return null;
    default: throw new Error('Frequency must be One-off, Monthly, Quarterly, or Annually.');
  }
}

function buildInstallmentSchedule_(totalAmount, installmentAmount, frequency, startDate, endDate) {
  const total = toPositiveNumber_(totalAmount, 'Total pledge amount');
  const installment = frequency === 'One-off'
    ? total
    : toPositiveNumber_(installmentAmount, 'Installment amount');
  const start = startDate instanceof Date ? startDate : parseDateOnly_(startDate, 'Start date');
  const end = endDate
    ? (endDate instanceof Date ? endDate : parseDateOnly_(endDate, 'End date'))
    : null;
  if (end && end < start) throw new Error('End date cannot be before start date.');

  const rows = [];
  let remaining = total;
  let dueDate = new Date(start.getTime());
  const monthStep = { Monthly: 1, Quarterly: 3, Annually: 12, 'One-off': 0 }[frequency];
  if (monthStep === undefined) throw new Error('Frequency must be One-off, Monthly, Quarterly, or Annually.');
  let installmentIndex = 0;
  let guard = 0;
  while (remaining > 0.0001) {
    if (end && dueDate > end) {
      throw new Error('The end date does not allow enough installments to cover the total pledge.');
    }
    const amount = Math.min(installment, remaining);
    rows.push({ dueDate: new Date(dueDate.getTime()), amount: Math.round(amount * 100) / 100 });
    remaining = Math.round((remaining - amount) * 100) / 100;
    if (remaining <= 0) break;
    if (monthStep === 0) throw new Error('A one-off pledge cannot have more than one installment.');
    installmentIndex += 1;
    dueDate = addMonthsClamped_(start, monthStep * installmentIndex);
    guard += 1;
    if (guard > 600) throw new Error('Pledge schedule exceeds 600 installments.');
  }
  return rows;
}

function calculatePledgeStatus_(totalAmount, receivedAmount, currentStatus) {
  const total = Number(totalAmount) || 0;
  const received = Number(receivedAmount) || 0;
  if (['Cancelled', 'Lapsed'].includes(currentStatus)) return currentStatus;
  if (total > 0 && received >= total - 0.005) return 'Fulfilled';
  if (currentStatus === 'Paused') return currentStatus;
  if (received > 0) return 'Partially Fulfilled';
  return 'Pledged';
}

function toMinorUnits_(amount, currency) {
  const normalizedCurrency = String(currency || '').toUpperCase();
  if (!['NGN', 'USD'].includes(normalizedCurrency)) {
    throw new Error('Online payment supports NGN and USD in this MVP.');
  }
  return String(Math.round(toPositiveNumber_(amount, 'Amount') * 100));
}

function validateDonorPayload_(payload) {
  const result = {
    fullName: requireText_(payload.fullName, 'Full name', 160),
    email: normalizeEmail_(payload.email),
    phone: normalizePhone_(payload.phone),
    address: sanitizeText_(payload.address, 300),
    country: sanitizeText_(payload.country, 80) || 'Nigeria',
    organisation: sanitizeText_(payload.organisation, 160),
    preferredCommunication: sanitizeText_(payload.preferredCommunication, 30) || 'Email',
    consent: Boolean(payload.consent)
  };
  if (!result.email && !result.phone) throw new Error('Email or phone is required.');
  if (result.email && !isValidEmail_(result.email)) throw new Error('Enter a valid email address.');
  if (result.phone && result.phone.replace(/\D/g, '').length < 7) throw new Error('Enter a valid phone number.');
  if (!result.consent) throw new Error('Consent is required to record your details.');
  return result;
}

function validateCurrency_(value, allowAnyRecordedCurrency) {
  const currency = requireText_(value, 'Currency', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must use a three-letter code.');
  if (!allowAnyRecordedCurrency && !getAllowedCurrencies_().includes(currency)) {
    throw new Error(`Online payment is not enabled for ${currency}.`);
  }
  return currency;
}

function maskEmail_(email) {
  const value = normalizeEmail_(email);
  const at = value.indexOf('@');
  if (at <= 1) return value;
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}
