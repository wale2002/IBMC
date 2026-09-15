/**
 * Paystack integration. The secret key stays in Script Properties.
 * The MVP verifies trusted callback references and polls pending transactions.
 */

function initialisePaystackPayment_(contributionId) {
  const contribution = findObject_(SHEETS.contributions, 'Contribution ID', contributionId);
  if (!contribution) throw new Error('Contribution record was not found.');
  const donor = findObject_(SHEETS.donors, 'Donor ID', contribution['Donor ID']);
  if (!donor || !isValidEmail_(donor.Email)) throw new Error('A valid donor email is required.');

  const secretKey = getScriptProperty_('PAYSTACK_SECRET_KEY', '');
  const callbackUrl = getScriptProperty_('WEB_APP_URL', '');
  if (!secretKey) throw new Error('PAYSTACK_SECRET_KEY is not configured.');
  if (!callbackUrl || !/^https:\/\//i.test(callbackUrl)) throw new Error('WEB_APP_URL is not configured.');

  const payload = {
    email: donor.Email,
    amount: toMinorUnits_(contribution.Amount, contribution.Currency),
    currency: String(contribution.Currency).toUpperCase(),
    reference: contributionId,
    callback_url: callbackUrl,
    metadata: JSON.stringify({
      contribution_id: contributionId,
      donor_id: contribution['Donor ID'],
      pledge_id: contribution['Pledge ID'] || '',
      custom_fields: [{ display_name: 'IBMC reference', variable_name: 'ibmc_reference', value: contributionId }]
    })
  };

  try {
    const response = UrlFetchApp.fetch('https://api.paystack.co/transaction/initialize', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${secretKey}` },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const body = JSON.parse(response.getContentText() || '{}');
    if (code < 200 || code >= 300 || !body.status || !body.data || !body.data.authorization_url) {
      throw new Error(body.message || `Paystack returned HTTP ${code}.`);
    }
    updateObjectRow_(SHEETS.contributions, contribution._row, {
      'Status': 'Pending Payment',
      'Gateway Reference': body.data.reference || contributionId,
      'Updated At': new Date()
    });
    audit_('PAYMENT_INITIALISED', 'Contribution', contributionId, 'Initialised Paystack checkout', '', {
      reference: body.data.reference || contributionId
    }, 'system');
    return { authorizationUrl: body.data.authorization_url, reference: body.data.reference || contributionId };
  } catch (error) {
    updateObjectRow_(SHEETS.contributions, contribution._row, {
      'Status': 'Payment Init Failed', 'Updated At': new Date()
    });
    audit_('PAYMENT_INIT_FAILED', 'Contribution', contributionId, sanitizeText_(error.message, 500), '', '', 'system');
    throw new Error('The donation was recorded, but online payment could not start. Contact the trustees with your reference.');
  }
}

function fetchPaystackTransaction_(reference) {
  const secretKey = getScriptProperty_('PAYSTACK_SECRET_KEY', '');
  if (!secretKey) throw new Error('PAYSTACK_SECRET_KEY is not configured.');
  const response = UrlFetchApp.fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    method: 'get',
    headers: { Authorization: `Bearer ${secretKey}` },
    muteHttpExceptions: true
  });
  const raw = response.getContentText() || '{}';
  const code = response.getResponseCode();
  let body;
  try { body = JSON.parse(raw); } catch (error) { body = {}; }
  if (code < 200 || code >= 300 || !body.status || !body.data) {
    throw new Error(body.message || `Paystack verification returned HTTP ${code}.`);
  }
  const rawIdMatch = /"id"\s*:\s*(\d+)/.exec(raw);
  body.data._rawTransactionId = rawIdMatch ? rawIdMatch[1] : String(body.data.id || '');
  return body.data;
}

function verifyPaystackReference(reference) {
  const cleanReference = requireText_(reference, 'Payment reference', 100);
  const contribution = findObject_(SHEETS.contributions, 'Gateway Reference', cleanReference)
    || findObject_(SHEETS.contributions, 'Contribution ID', cleanReference);
  if (!contribution) throw new Error('Payment reference was not found.');
  if (contribution.Status === 'Received') {
    return { ok: true, message: `Payment already verified. Receipt: ${contribution['Receipt Number']}` };
  }

  const transaction = fetchPaystackTransaction_(cleanReference);
  if (String(transaction.status).toLowerCase() !== 'success') {
    return { ok: false, message: `Payment is not complete. Current gateway status: ${transaction.status || 'unknown'}.` };
  }
  const expectedMinor = Number(toMinorUnits_(contribution.Amount, contribution.Currency));
  const actualMinor = Number(transaction.amount);
  if (actualMinor !== expectedMinor) throw new Error('Gateway amount does not match the recorded contribution.');
  if (String(transaction.currency).toUpperCase() !== String(contribution.Currency).toUpperCase()) {
    throw new Error('Gateway currency does not match the recorded contribution.');
  }

  const actor = activeActor_();
  const result = confirmContributionReceived_(contribution, {
    receivedAt: transaction.paid_at ? new Date(transaction.paid_at) : new Date(),
    paymentMethod: 'Paystack',
    gatewayTransactionId: transaction._rawTransactionId,
    gatewayFee: Number(transaction.fees || 0) / 100,
    gatewayChannel: sanitizeText_(transaction.channel, 80),
    notes: 'Verified against Paystack transaction API'
  }, actor);
  return { ok: true, message: `Payment verified. Receipt: ${result.receiptNumber}` };
}

function reconcilePendingPayments() {
  if (!isTrue_(getSetting_('PAYSTACK_ENABLED', 'FALSE'))) {
    return { checked: 0, received: 0, pending: 0, failed: 0, skipped: true, reason: 'Paystack disabled' };
  }
  if (!getScriptProperty_('PAYSTACK_SECRET_KEY', '')) {
    return { checked: 0, received: 0, pending: 0, failed: 0, skipped: true, reason: 'Paystack key not configured' };
  }
  const pending = listObjects_(SHEETS.contributions)
    .filter(row => row.Gateway === 'Paystack' && ['Pending Payment', 'Payment Init Failed'].includes(row.Status))
    .slice(0, 25);
  const summary = { checked: 0, received: 0, pending: 0, failed: 0 };
  pending.forEach(record => {
    summary.checked += 1;
    try {
      const result = verifyPaystackReference(record['Gateway Reference'] || record['Contribution ID']);
      if (result.ok) summary.received += 1;
      else summary.pending += 1;
    } catch (error) {
      summary.failed += 1;
      audit_('PAYMENT_RECONCILE_ERROR', 'Contribution', record['Contribution ID'], sanitizeText_(error.message, 500), '', '', 'system');
    }
  });
  return summary;
}

function confirmContributionReceived_(contribution, evidence, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const fresh = findObject_(SHEETS.contributions, 'Contribution ID', contribution['Contribution ID']);
    if (!fresh) throw new Error('Contribution record was not found.');
    return confirmContributionReceivedUnlocked_(fresh, evidence, actor);
  } finally {
    lock.releaseLock();
  }
}

function confirmContributionReceivedUnlocked_(contribution, evidence, actor) {
  if (!contribution || !contribution._row) throw new Error('Contribution record is invalid.');
  if (contribution.Status === 'Received') {
    return { receiptNumber: contribution['Receipt Number'], contribution };
  }
  if (['Rejected', 'Refunded', 'Chargeback'].includes(contribution.Status)) {
    throw new Error(`Cannot confirm a contribution with status ${contribution.Status}.`);
  }
  toPositiveNumber_(contribution.Amount, 'Contribution amount');
  validateCurrency_(contribution.Currency, true);
  if (contribution['Pledge ID']) {
    validatePledgeLink_(contribution['Pledge ID'], contribution['Donor ID'], contribution.Currency);
  }
  const receiptNumber = contribution['Receipt Number'] || generateReceiptNumber_(contribution['Contribution ID']);
  const updated = updateObjectRow_(SHEETS.contributions, contribution._row, {
    'Received At': evidence.receivedAt || new Date(),
    'Payment Method': evidence.paymentMethod || contribution['Payment Method'],
    'Status': 'Received',
    'Receipt Number': receiptNumber,
    'Gateway Transaction ID': evidence.gatewayTransactionId || contribution['Gateway Transaction ID'],
    'Gateway Fee': evidence.gatewayFee === undefined ? contribution['Gateway Fee'] : evidence.gatewayFee,
    'Gateway Channel': evidence.gatewayChannel || contribution['Gateway Channel'],
    'Notes': mergeNotes_(contribution.Notes, evidence.notes),
    'Updated At': new Date()
  });
  if (updated['Pledge ID']) applyContributionToPledge_(updated, actor);
  audit_('CONFIRM_RECEIPT', 'Contribution', contribution['Contribution ID'], `Issued receipt ${receiptNumber}`, contribution, updated, actor);

  const donor = findObject_(SHEETS.donors, 'Donor ID', contribution['Donor ID']);
  if (donor && donor.Email) {
    sendEmailSafely_(donor.Email, `Donation receipt ${receiptNumber}`, acknowledgementBody_(donor['Full Name'], [
      'We have received your donation to the IBMC Endowment Fund.',
      `Receipt: ${receiptNumber}`,
      `Reference: ${contribution['Contribution ID']}`,
      `Amount: ${contribution.Currency} ${formatMoney_(contribution.Amount)}`,
      `Date received: ${formatDate_(evidence.receivedAt || new Date())}`,
      'Please retain this acknowledgement with your records.'
    ]), { entityType: 'Contribution', entityId: contribution['Contribution ID'] });
  }
  return { receiptNumber, contribution: updated };
}

function generateReceiptNumber_(contributionId) {
  const prefix = getSetting_('RECEIPT_PREFIX', 'IBMC').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'IBMC';
  const year = Utilities.formatDate(new Date(), APP.timeZone, 'yyyy');
  const token = String(contributionId).replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase();
  return `${prefix}-${year}-${token}`;
}

function mergeNotes_(existing, additional) {
  return [sanitizeText_(existing, 700), sanitizeText_(additional, 700)].filter(Boolean).join(' | ').slice(0, 1000);
}
