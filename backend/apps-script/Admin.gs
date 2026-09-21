/**
 * Trustee-only web dashboard data and actions.
 * Deploy this view separately as "user accessing the web app" and restrict
 * access to signed-in Google users. Every method also enforces TRUSTEE_EMAILS.
 */

function getAdminDashboardData() {
  const actor = assertTrustee_();
  const donors = listObjects_(SHEETS.donors);
  const pledges = listObjects_(SHEETS.pledges);
  const contributions = listObjects_(SHEETS.contributions);
  const assets = listObjects_(SHEETS.assets);
  const services = listObjects_(SHEETS.services);
  const installments = listObjects_(SHEETS.installments);
  const auditRows = listObjects_(SHEETS.audit);
  const donorsById = {};
  donors.forEach(donor => { donorsById[String(donor['Donor ID'])] = donor; });

  const currencies = [...new Set(getAllowedCurrencies_().concat(
    pledges.map(row => String(row.Currency || '').toUpperCase()),
    contributions.map(row => String(row.Currency || '').toUpperCase())
  ).filter(Boolean))];
  const totals = {};
  currencies.forEach(currency => {
    totals[currency] = {
      pledged: roundAdminMoney_(pledges
        .filter(row => String(row.Currency).toUpperCase() === currency && !['Cancelled', 'Lapsed'].includes(String(row.Status)))
        .reduce((sum, row) => sum + (Number(row['Total Amount']) || 0), 0)),
      received: roundAdminMoney_(contributions
        .filter(row => String(row.Currency).toUpperCase() === currency && row.Status === 'Received')
        .reduce((sum, row) => sum + (Number(row.Amount) || 0), 0)),
      outstanding: roundAdminMoney_(pledges
        .filter(row => String(row.Currency).toUpperCase() === currency && !['Cancelled', 'Lapsed'].includes(String(row.Status)))
        .reduce((sum, row) => sum + (Number(row['Outstanding Amount']) || 0), 0))
    };
  });

  return {
    organisationName: getSetting_('ORGANISATION_NAME', 'Igbajo Baptist Medical Centre'),
    actor,
    updatedAt: formatDateTime_(new Date()),
    sheetUrl: `https://docs.google.com/spreadsheets/d/${getSpreadsheet_().getId()}/edit`,
    totals,
    counts: {
      activeDonors: donors.filter(row => row.Status === 'Active').length,
      pendingContributions: contributions.filter(row => row.Status === 'Pending Verification').length,
      pendingAssets: assets.filter(row => row.Status === 'Pending Review').length,
      openServices: services.filter(row => ['Offered', 'Accepted', 'Scheduled'].includes(String(row.Status))).length,
      overdueInstallments: installments.filter(row => row.Status === 'Overdue').length
    },
    contributions: contributions
      .filter(row => ['Pending Verification', 'Pending Payment', 'Payment Init Failed', 'Received'].includes(String(row.Status)))
      .sort((a, b) => adminTime_(b['Created At']) - adminTime_(a['Created At']))
      .slice(0, 100)
      .map(row => adminContribution_(row, donorsById)),
    assets: assets
      .filter(row => ['Pending Review', 'Accepted', 'Transfer In Progress'].includes(String(row.Status)))
      .sort((a, b) => adminTime_(b['Created At']) - adminTime_(a['Created At']))
      .slice(0, 100)
      .map(row => adminAsset_(row, donorsById)),
    services: services
      .filter(row => ['Offered', 'Accepted', 'Scheduled'].includes(String(row.Status)))
      .sort((a, b) => adminTime_(b['Created At']) - adminTime_(a['Created At']))
      .slice(0, 100)
      .map(row => adminService_(row, donorsById)),
    audit: auditRows
      .sort((a, b) => adminTime_(b['Occurred At']) - adminTime_(a['Occurred At']))
      .slice(0, 40)
      .map(row => ({
        occurredAt: formatDateTime_(row['Occurred At']),
        actor: sanitizeText_(row.Actor, 160),
        action: sanitizeText_(row.Action, 80),
        entityType: sanitizeText_(row['Entity Type'], 80),
        entityId: sanitizeText_(row['Entity ID'], 100),
        summary: sanitizeText_(row.Summary, 500)
      }))
  };
}

function adminConfirmContribution(contributionId, bankConfirmed, note) {
  const actor = assertTrustee_();
  if (bankConfirmed !== true) throw new Error('Confirm that the payment appears in the bank or gateway record.');
  const reference = sanitizeText_(contributionId, 100);
  const record = findObject_(SHEETS.contributions, 'Contribution ID', reference);
  if (!record) throw new Error('Contribution record was not found.');
  if (record.Status !== 'Pending Verification') throw new Error('Only a contribution awaiting verification can be confirmed here.');
  if (String(record.Gateway || '').toLowerCase() === 'paystack') {
    throw new Error('Use Paystack verification for a gateway payment.');
  }
  const verificationNote = sanitizeText_(note, 500);
  if (verificationNote.length < 5) throw new Error('Add a short bank-reference or verification note.');
  const result = confirmContributionReceived_(record, {
    receivedAt: new Date(),
    paymentMethod: record['Payment Method'] || 'Manual',
    notes: `Verified in trustee dashboard: ${verificationNote}`
  }, actor);
  rebuildDashboard();
  return {
    ok: true,
    message: `Payment confirmed. Receipt ${result.receiptNumber} was issued.`,
    data: getAdminDashboardData()
  };
}

function adminApproveAsset(assetId, dueDiligenceConfirmed, note) {
  const actor = assertTrustee_();
  if (dueDiligenceConfirmed !== true) throw new Error('Complete the valuation, ownership, and acceptance checks first.');
  const reference = sanitizeText_(assetId, 100);
  const record = findObject_(SHEETS.assets, 'Asset ID', reference);
  if (!record) throw new Error('Asset record was not found.');
  if (record.Status !== 'Pending Review') throw new Error('Only an asset in Pending Review can be accepted.');
  const reviewNote = sanitizeText_(note, 500);
  if (reviewNote.length < 5) throw new Error('Add a short due-diligence note.');
  const updated = updateObjectRow_(SHEETS.assets, record._row, {
    'Status': 'Accepted',
    'Reviewer': actor,
    'Reviewed At': new Date(),
    'Notes': mergeNotes_(record.Notes, reviewNote),
    'Updated At': new Date()
  });
  audit_('APPROVE', 'Asset', reference, 'Accepted asset subject to completed transfer checks', record, updated, actor);
  rebuildDashboard();
  return { ok: true, message: `Asset ${reference} was accepted for transfer processing.`, data: getAdminDashboardData() };
}

function adminAcceptService(serviceId, needConfirmed, note) {
  const actor = assertTrustee_();
  if (needConfirmed !== true) throw new Error('Confirm that the offer matches an approved operational need.');
  const reference = sanitizeText_(serviceId, 100);
  const record = findObject_(SHEETS.services, 'Service ID', reference);
  if (!record) throw new Error('Service record was not found.');
  if (record.Status !== 'Offered') throw new Error('Only a new service offer can be accepted.');
  const acceptanceNote = sanitizeText_(note, 500);
  if (acceptanceNote.length < 5) throw new Error('Add a short acceptance or assignment note.');
  const updated = updateObjectRow_(SHEETS.services, record._row, {
    'Status': 'Accepted',
    'Notes': mergeNotes_(record.Notes, acceptanceNote),
    'Updated At': new Date()
  });
  audit_('ACCEPT', 'Service', reference, 'Accepted service offer for scheduling', record, updated, actor);
  rebuildDashboard();
  return { ok: true, message: `Service offer ${reference} was accepted.`, data: getAdminDashboardData() };
}

function adminTime_(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function roundAdminMoney_(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function adminDonor_(record, donorsById) {
  const donor = donorsById[String(record['Donor ID'])] || {};
  return {
    id: sanitizeText_(record['Donor ID'], 100),
    name: sanitizeText_(donor['Full Name'] || 'Unknown donor', 200),
    email: normalizeEmail_(donor.Email),
    phone: sanitizeText_(donor.Phone, 80)
  };
}

function adminContribution_(record, donorsById) {
  return {
    id: sanitizeText_(record['Contribution ID'], 100),
    donor: adminDonor_(record, donorsById),
    createdAt: formatDateTime_(record['Created At']),
    receivedAt: formatDateTime_(record['Received At']),
    amount: roundAdminMoney_(record.Amount),
    currency: sanitizeText_(record.Currency, 10),
    paymentMethod: sanitizeText_(record['Payment Method'], 120),
    status: sanitizeText_(record.Status, 80),
    receiptNumber: sanitizeText_(record['Receipt Number'], 100),
    gateway: sanitizeText_(record.Gateway, 80),
    gatewayReference: sanitizeText_(record['Gateway Reference'], 120),
    purpose: sanitizeText_(record['Purpose Restriction'], 500),
    evidenceUrl: sanitizeText_(record['Evidence URL'], 1500),
    notes: sanitizeText_(record.Notes, 1000)
  };
}

function adminAsset_(record, donorsById) {
  return {
    id: sanitizeText_(record['Asset ID'], 100),
    donor: adminDonor_(record, donorsById),
    createdAt: formatDateTime_(record['Created At']),
    type: sanitizeText_(record['Asset Type'], 120),
    description: sanitizeText_(record.Description, 1000),
    estimatedValue: roundAdminMoney_(record['Estimated Value']),
    currency: sanitizeText_(record.Currency, 10),
    ownershipDetails: sanitizeText_(record['Ownership Details'], 700),
    evidenceUrl: sanitizeText_(record['Evidence URL'], 2000),
    status: sanitizeText_(record.Status, 80),
    notes: sanitizeText_(record.Notes, 1000)
  };
}

function adminService_(record, donorsById) {
  return {
    id: sanitizeText_(record['Service ID'], 100),
    donor: adminDonor_(record, donorsById),
    createdAt: formatDateTime_(record['Created At']),
    skill: sanitizeText_(record['Skill Offered'], 300),
    hours: Number(record['Hours Offered']) || 0,
    availability: sanitizeText_(record.Availability, 500),
    status: sanitizeText_(record.Status, 80),
    notes: sanitizeText_(record.Notes, 1000)
  };
}
