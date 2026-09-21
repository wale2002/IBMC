/**
 * Web app entry points and public submission handlers.
 */

function doGet(e) {
  const view = e && e.parameter ? sanitizeText_(e.parameter.view, 40).toLowerCase() : '';
  if (view === 'admin') {
    const template = HtmlService.createTemplateFromFile('Admin');
    template.organisationName = getSetting_('ORGANISATION_NAME', 'Igbajo Baptist Medical Centre');
    return template.evaluate()
      .setTitle(`${template.organisationName} Trustee Dashboard`)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  const reference = e && e.parameter ? sanitizeText_(e.parameter.reference, 100) : '';
  if (reference) {
    const template = HtmlService.createTemplateFromFile('Callback');
    try {
      template.result = verifyPaystackReference(reference);
    } catch (error) {
      template.result = { ok: false, message: error.message || 'Payment verification failed.' };
    }
    template.organisationName = getSetting_('ORGANISATION_NAME', 'Igbajo Baptist Medical Centre');
    return template.evaluate().setTitle('Donation status');
  }

  const template = HtmlService.createTemplateFromFile('Index');
  template.publicConfigJson = JSON.stringify(getPublicConfig_()).replace(/</g, '\\u003c');
  return template.evaluate()
    .setTitle(`${getSetting_('ORGANISATION_NAME', 'IBMC')} Endowment Fund`)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  const request = e && e.parameter ? e.parameter : {};
  const nonce = sanitizeText_(request.nonce, 120);
  let result;
  try {
    const payload = JSON.parse(String(request.payload || '{}'));
    const submission = submitPublicForm(payload);
    result = {
      ok: Boolean(submission.ok),
      message: sanitizeText_(submission.message, 500),
      reference: sanitizeText_(submission.reference, 100),
      redirectUrl: sanitizeText_(submission.redirectUrl, 500)
    };
  } catch (error) {
    result = {
      ok: false,
      message: sanitizeText_(error && error.message ? error.message : 'The submission could not be recorded.', 500),
      reference: '',
      redirectUrl: ''
    };
  }
  return renderPostMessageResponse_(nonce, result);
}

function renderPostMessageResponse_(nonce, result) {
  const message = JSON.stringify({
    source: 'ibmc-endowment-api',
    nonce: sanitizeText_(nonce, 120),
    result
  })
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return HtmlService.createHtmlOutput(
    `<!doctype html><html><head><meta charset="utf-8"></head><body>` +
    `<script>window.parent.postMessage(${message}, '*');<\/script>` +
    `<noscript>The submission response is ready. Return to the IBMC website.</noscript>` +
    `</body></html>`
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getPublicConfig_() {
  return {
    organisationName: getSetting_('ORGANISATION_NAME', 'Igbajo Baptist Medical Centre'),
    intro: getSetting_('DONOR_PAGE_INTRO', ''),
    contactEmail: getSetting_('CONTACT_EMAIL', ''),
    contactPhone: getSetting_('CONTACT_PHONE', ''),
    allowedCurrencies: getAllowedCurrencies_(),
    defaultCurrency: getSetting_('DEFAULT_CURRENCY', 'NGN'),
    paystackEnabled: isTrue_(getSetting_('PAYSTACK_ENABLED', 'FALSE')) && Boolean(getScriptProperty_('PAYSTACK_SECRET_KEY', '')),
    bankTransferInstructions: getSetting_('BANK_TRANSFER_INSTRUCTIONS', ''),
    privacyNoticeUrl: getSetting_('PRIVACY_NOTICE_URL', '')
  };
}

function rateLimitPublicSubmission_(email, phone) {
  const identity = `${normalizeEmail_(email)}|${normalizePhone_(phone)}`;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, identity, Utilities.Charset.UTF_8);
  const token = Utilities.base64EncodeWebSafe(digest).slice(0, 32);
  const key = `public-rate:${token}`;
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get(key) || 0);
  if (count >= 5) {
    throw new Error('Too many submissions were received for these contact details. Try again in ten minutes.');
  }
  cache.put(key, String(count + 1), 600);
}

const PUBLIC_IMAGE_UPLOAD = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  maxDonationImages: 1,
  maxAssetImages: 3,
  allowedMimeTypes: Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  })
});

function unsignedByte_(value) {
  return value < 0 ? value + 256 : value;
}

function hasImageSignature_(bytes, mimeType) {
  const valueAt = index => unsignedByte_(bytes[index] || 0);
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && valueAt(0) === 0xFF && valueAt(1) === 0xD8 && valueAt(2) === 0xFF;
  }
  if (mimeType === 'image/png') {
    const signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    return bytes.length >= signature.length && signature.every((value, index) => valueAt(index) === value);
  }
  if (mimeType === 'image/webp') {
    const riff = [0x52, 0x49, 0x46, 0x46];
    const webp = [0x57, 0x45, 0x42, 0x50];
    return bytes.length >= 12
      && riff.every((value, index) => valueAt(index) === value)
      && webp.every((value, index) => valueAt(index + 8) === value);
  }
  return false;
}

function normalizeImageUpload_(upload, label) {
  if (!upload || typeof upload !== 'object') throw new Error(`${label} is missing.`);
  const mimeType = String(upload.mimeType || '').trim().toLowerCase();
  const extension = PUBLIC_IMAGE_UPLOAD.allowedMimeTypes[mimeType];
  if (!extension) throw new Error(`${label} must be a JPEG, PNG, or WebP image.`);

  const base64 = String(upload.base64 || '').replace(/\s/g, '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error(`${label} could not be read.`);
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const estimatedBytes = Math.floor(base64.length * 3 / 4) - padding;
  if (estimatedBytes > PUBLIC_IMAGE_UPLOAD.maxBytes) {
    throw new Error(`${label} is larger than 4 MB after optimisation.`);
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (error) {
    throw new Error(`${label} could not be decoded.`);
  }
  if (!bytes.length || bytes.length > PUBLIC_IMAGE_UPLOAD.maxBytes || !hasImageSignature_(bytes, mimeType)) {
    throw new Error(`${label} is not a valid ${extension.toUpperCase()} image.`);
  }
  return { bytes, mimeType, extension };
}

function normalizeSubmissionImages_(kind, details) {
  let rawImages = [];
  let maxFiles = 0;
  if (kind === 'donation' && details.receiptImage) {
    rawImages = [details.receiptImage];
    maxFiles = PUBLIC_IMAGE_UPLOAD.maxDonationImages;
  } else if (kind === 'asset' && Array.isArray(details.assetImages)) {
    rawImages = details.assetImages;
    maxFiles = PUBLIC_IMAGE_UPLOAD.maxAssetImages;
  }
  if (rawImages.length > maxFiles) throw new Error(`Upload no more than ${maxFiles} image${maxFiles === 1 ? '' : 's'}.`);
  return rawImages.map((upload, index) => normalizeImageUpload_(upload, `Image ${index + 1}`));
}

function getUploadRootFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const configuredId = properties.getProperty('UPLOAD_FOLDER_ID');
  let folder;
  if (configuredId) {
    try {
      folder = DriveApp.getFolderById(configuredId);
    } catch (error) {
      console.warn(`Configured upload folder is unavailable: ${error.message || error}`);
    }
  }
  if (!folder) {
    folder = DriveApp.createFolder('IBMC Endowment Private Uploads');
    properties.setProperty('UPLOAD_FOLDER_ID', folder.getId());
  }
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    throw new Error('The configured upload folder must use Restricted access before images can be accepted.');
  }
  return folder;
}

function getOrCreateUploadFolder_(parent, name) {
  const existing = parent.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : parent.createFolder(name);
}

function storeSubmissionImages_(uploads, entityType, entityId) {
  if (!uploads.length) return [];
  const root = getUploadRootFolder_();
  const typeFolder = getOrCreateUploadFolder_(root, entityType);
  const entityFolder = getOrCreateUploadFolder_(typeFolder, entityId);
  return uploads.map((upload, index) => {
    const fileName = `${entityId}-${index + 1}.${upload.extension}`;
    const blob = Utilities.newBlob(upload.bytes, upload.mimeType, fileName);
    const file = entityFolder.createFile(blob);
    file.setDescription(`Private ${entityType.toLowerCase()} evidence for ${entityId}`);
    return file.getUrl();
  });
}

function combineEvidenceUrls_(existingUrl, uploadedUrls) {
  return [sanitizeText_(existingUrl, 500), ...uploadedUrls]
    .filter(Boolean)
    .join('\n')
    .slice(0, 500);
}

function submitPublicForm(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Submission is missing.');
  const kind = requireText_(payload.kind, 'Submission type', 30).toLowerCase();
  if (sanitizeText_(payload.website, 200)) throw new Error('Submission could not be accepted.');
  const details = payload.details || {};
  const imageUploads = normalizeSubmissionImages_(kind, details);
  const donorPayload = validateDonorPayload_(payload.donor || {});
  rateLimitPublicSubmission_(donorPayload.email, donorPayload.phone);
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  let result;
  try {
    const donor = upsertDonor_(donorPayload, 'public');
    switch (kind) {
      case 'donation': result = createDonation_(donor, details, imageUploads); break;
      case 'pledge': result = createPledge_(donor, details); break;
      case 'asset': result = createAsset_(donor, details, imageUploads); break;
      case 'service': result = createService_(donor, details); break;
      default: throw new Error('Unknown submission type.');
    }
  } finally {
    lock.releaseLock();
  }

  if (result.initialisePayment) {
    try {
      const payment = initialisePaystackPayment_(result.entityId);
      result.redirectUrl = payment.authorizationUrl;
      result.message = 'Your donation was recorded. Continue to Paystack to complete payment.';
      result.emailTemplate.body += `\n\nSecure payment link: ${payment.authorizationUrl}`;
    } catch (error) {
      result.redirectUrl = '';
      result.message = error.message;
      result.emailTemplate.body += '\n\nOnline checkout did not start. Contact the trustees and quote the reference above.';
    }
  }

  if (result.emailTemplate) {
    sendEmailSafely_(donorPayload.email, result.emailTemplate.subject, result.emailTemplate.body, {
      entityType: result.entityType,
      entityId: result.entityId
    });
  }
  notifyTrusteesOfSubmission_(result, donorPayload);

  return {
    ok: true,
    message: result.message,
    reference: result.entityId,
    redirectUrl: result.redirectUrl || ''
  };
}

function createDonation_(donor, details, imageUploads) {
  const amount = toPositiveNumber_(details.amount, 'Donation amount');
  const currency = validateCurrency_(details.currency, true);
  const paymentMethod = requireText_(details.paymentMethod, 'Payment method', 40);
  const pledgeId = sanitizeText_(details.pledgeId, 80);
  validatePledgeLink_(pledgeId, donor['Donor ID'], currency);

  const paystackRequested = paymentMethod === 'Paystack';
  if (paystackRequested) {
    if (!isTrue_(getSetting_('PAYSTACK_ENABLED', 'FALSE'))) throw new Error('Online payment is not enabled yet.');
    validateCurrency_(currency, false);
    if (!donor.Email || !isValidEmail_(donor.Email)) throw new Error('A valid email is required for online payment.');
  }

  const contributionId = generateId_(APP.idPrefixes.contribution);
  const uploadedUrls = storeSubmissionImages_(imageUploads || [], 'Contributions', contributionId);
  const evidenceUrl = combineEvidenceUrls_(details.evidenceUrl, uploadedUrls);
  const now = new Date();
  const record = {
    'Contribution ID': contributionId,
    'Donor ID': donor['Donor ID'],
    'Pledge ID': pledgeId,
    'Created At': now,
    'Received At': '',
    'Donation Type': 'Cash',
    'Amount': amount,
    'Currency': currency,
    'Payment Method': paymentMethod,
    'Status': paystackRequested ? 'Pending Payment' : 'Pending Verification',
    'Receipt Number': '',
    'Gateway': paystackRequested ? 'Paystack' : '',
    'Gateway Reference': paystackRequested ? contributionId : '',
    'Gateway Transaction ID': '',
    'Gateway Fee': '',
    'Gateway Channel': '',
    'Purpose Restriction': sanitizeText_(details.purposeRestriction, 500),
    'Evidence URL': evidenceUrl,
    'Notes': sanitizeText_(details.notes, 1000),
    'Updated At': now
  };
  appendObject_(SHEETS.contributions, record);
  audit_('CREATE', 'Contribution', contributionId, `Recorded ${currency} donation submission`, '', record, 'public');

  return {
    entityType: 'Contribution',
    entityId: contributionId,
    evidenceUrl,
    initialisePayment: paystackRequested,
    message: paystackRequested
      ? 'Your donation was recorded and is ready for online payment.'
      : 'Your donation was recorded and awaits trustee verification.',
    emailTemplate: {
      subject: `Donation submission ${contributionId}`,
      body: acknowledgementBody_(donor['Full Name'], [
        'Thank you for supporting the IBMC Endowment Fund.',
        `Reference: ${contributionId}`,
        `Amount: ${currency} ${formatMoney_(amount)}`,
        `Status: ${record.Status}`,
        paystackRequested ? 'Complete the payment using the secure payment page.' : 'A trustee will verify receipt and issue a formal acknowledgement.'
      ])
    }
  };
}

function createPledge_(donor, details) {
  const totalAmount = toPositiveNumber_(details.totalAmount, 'Total pledge amount');
  const currency = validateCurrency_(details.currency, true);
  const frequency = requireText_(details.frequency, 'Frequency', 30);
  const startDate = parseDateOnly_(details.startDate, 'Start date');
  const installmentAmount = frequency === 'One-off'
    ? totalAmount
    : toPositiveNumber_(details.installmentAmount, 'Installment amount');
  const endDate = details.endDate ? parseDateOnly_(details.endDate, 'End date') : null;
  const schedule = buildInstallmentSchedule_(totalAmount, installmentAmount, frequency, startDate, endDate);
  const pledgeId = generateId_(APP.idPrefixes.pledge);
  const now = new Date();
  const record = {
    'Pledge ID': pledgeId,
    'Donor ID': donor['Donor ID'],
    'Created At': now,
    'Total Amount': totalAmount,
    'Currency': currency,
    'Donation Type': 'Cash',
    'Frequency': frequency,
    'Installment Amount': installmentAmount,
    'Start Date': startDate,
    'End Date': endDate || '',
    'Received Amount': 0,
    'Outstanding Amount': totalAmount,
    'Status': 'Pledged',
    'Purpose Restriction': sanitizeText_(details.purposeRestriction, 500),
    'Conditions': sanitizeText_(details.conditions, 1000),
    'Last Reminder At': '',
    'Next Due Date': schedule[0].dueDate,
    'Updated At': now
  };
  appendObject_(SHEETS.pledges, record);
  schedule.forEach(item => {
    appendObject_(SHEETS.installments, {
      'Installment ID': generateId_(APP.idPrefixes.installment),
      'Pledge ID': pledgeId,
      'Donor ID': donor['Donor ID'],
      'Due Date': item.dueDate,
      'Amount': item.amount,
      'Currency': currency,
      'Received Amount': 0,
      'Outstanding Amount': item.amount,
      'Status': 'Scheduled',
      'Last Reminder At': '',
      'Reminder Count': 0,
      'Updated At': now
    });
  });
  audit_('CREATE', 'Pledge', pledgeId, `Created ${schedule.length}-installment pledge`, '', record, 'public');
  return {
    entityType: 'Pledge', entityId: pledgeId,
    message: 'Your pledge was recorded. Keep the reference for future payments.',
    emailTemplate: {
      subject: `Pledge acknowledgement ${pledgeId}`,
      body: acknowledgementBody_(donor['Full Name'], [
        'Thank you for making a pledge to the IBMC Endowment Fund.',
        `Pledge reference: ${pledgeId}`,
        `Total commitment: ${currency} ${formatMoney_(totalAmount)}`,
        `Frequency: ${frequency}`,
        `First due date: ${formatDate_(schedule[0].dueDate)}`,
        'Use the pledge reference when making payments so the trustees can apply them correctly.'
      ])
    }
  };
}

function createAsset_(donor, details, imageUploads) {
  const assetId = generateId_(APP.idPrefixes.asset);
  const uploadedUrls = storeSubmissionImages_(imageUploads || [], 'Assets', assetId);
  const evidenceUrl = combineEvidenceUrls_(details.evidenceUrl, uploadedUrls);
  const now = new Date();
  const record = {
    'Asset ID': assetId,
    'Donor ID': donor['Donor ID'],
    'Created At': now,
    'Asset Type': requireText_(details.assetType, 'Asset type', 80),
    'Description': requireText_(details.description, 'Asset description', 1000),
    'Estimated Value': details.estimatedValue ? toPositiveNumber_(details.estimatedValue, 'Estimated value') : '',
    'Currency': details.currency ? validateCurrency_(details.currency, true) : '',
    'Ownership Details': sanitizeText_(details.ownershipDetails, 1000),
    'Evidence URL': evidenceUrl,
    'Status': 'Pending Review',
    'Reviewer': '', 'Reviewed At': '', 'Transfer Date': '',
    'Conditions': sanitizeText_(details.conditions, 1000),
    'Notes': '', 'Updated At': now
  };
  appendObject_(SHEETS.assets, record);
  audit_('CREATE', 'Asset', assetId, 'Recorded asset offer for due diligence', '', record, 'public');
  return {
    entityType: 'Asset', entityId: assetId, evidenceUrl,
    message: 'Your asset offer was recorded for trustee review. Acceptance is subject to valuation and title checks.',
    emailTemplate: {
      subject: `Asset offer ${assetId}`,
      body: acknowledgementBody_(donor['Full Name'], [
        'Thank you for offering an asset to the IBMC Endowment Fund.',
        `Reference: ${assetId}`,
        `Asset type: ${record['Asset Type']}`,
        'A trustee will contact you after the required valuation, ownership, and acceptance checks.'
      ])
    }
  };
}

function createService_(donor, details) {
  const serviceId = generateId_(APP.idPrefixes.service);
  const now = new Date();
  const record = {
    'Service ID': serviceId,
    'Donor ID': donor['Donor ID'],
    'Created At': now,
    'Skill Offered': requireText_(details.skillOffered, 'Skill offered', 200),
    'Hours Offered': toPositiveNumber_(details.hoursOffered, 'Hours offered'),
    'Availability': requireText_(details.availability, 'Availability', 500),
    'Conditions': sanitizeText_(details.conditions, 1000),
    'Status': 'Offered', 'Assigned To': '', 'Scheduled Date': '',
    'Completed Hours': 0, 'Notes': '', 'Updated At': now
  };
  appendObject_(SHEETS.services, record);
  audit_('CREATE', 'Service', serviceId, 'Recorded service or volunteer offer', '', record, 'public');
  return {
    entityType: 'Service', entityId: serviceId,
    message: 'Your offer of time or expertise was recorded. A trustee will contact you if it matches an approved need.',
    emailTemplate: {
      subject: `Service offer ${serviceId}`,
      body: acknowledgementBody_(donor['Full Name'], [
        'Thank you for offering your time or expertise to IBMC.',
        `Reference: ${serviceId}`,
        `Skill: ${record['Skill Offered']}`,
        `Hours offered: ${record['Hours Offered']}`
      ])
    }
  };
}

function validatePledgeLink_(pledgeId, donorId, currency) {
  if (!pledgeId) return null;
  const pledge = findObject_(SHEETS.pledges, 'Pledge ID', pledgeId);
  if (!pledge) throw new Error('Pledge reference was not found.');
  if (String(pledge['Donor ID']) !== String(donorId)) throw new Error('Pledge reference does not match the donor details.');
  if (String(pledge.Currency).toUpperCase() !== String(currency).toUpperCase()) throw new Error('Payment currency must match the pledge currency.');
  if (['Cancelled', 'Lapsed'].includes(pledge.Status)) throw new Error('This pledge cannot receive payments.');
  return pledge;
}

function formatMoney_(amount) {
  return Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function acknowledgementBody_(name, lines) {
  const organisation = getSetting_('ORGANISATION_NAME', 'Igbajo Baptist Medical Centre');
  return [`Dear ${sanitizeText_(name, 160)},`, '', ...lines, '', `Regards,`, `${organisation} Endowment Fund Trustees`].join('\n');
}
