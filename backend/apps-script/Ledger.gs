/**
 * Pledge fulfilment and installment allocation.
 */

function applyContributionToPledge_(contribution, actor) {
  const pledgeId = sanitizeText_(contribution['Pledge ID'], 80);
  if (!pledgeId) return;
  const pledge = findObject_(SHEETS.pledges, 'Pledge ID', pledgeId);
  if (!pledge) throw new Error(`Linked pledge not found: ${pledgeId}`);
  if (String(pledge.Currency).toUpperCase() !== String(contribution.Currency).toUpperCase()) {
    throw new Error('Contribution and pledge currencies do not match.');
  }

  let unallocated = Number(contribution.Amount) || 0;
  const today = dateAtNoon_(new Date());
  const installments = listObjects_(SHEETS.installments)
    .filter(item => String(item['Pledge ID']) === pledgeId && item.Status !== 'Cancelled')
    .sort((a, b) => new Date(a['Due Date']) - new Date(b['Due Date']));

  installments.forEach(item => {
    if (unallocated <= 0.0001) return;
    const outstanding = Math.max(0, Number(item['Outstanding Amount']) || 0);
    if (outstanding <= 0) return;
    const applied = Math.min(outstanding, unallocated);
    const received = (Number(item['Received Amount']) || 0) + applied;
    const remaining = Math.max(0, (Number(item.Amount) || 0) - received);
    const due = dateAtNoon_(item['Due Date']);
    const status = remaining <= 0.005
      ? 'Paid'
      : received > 0
        ? 'Partially Paid'
        : due < today ? 'Overdue' : due.getTime() === today.getTime() ? 'Due' : 'Scheduled';
    updateObjectRow_(SHEETS.installments, item._row, {
      'Received Amount': Math.round(received * 100) / 100,
      'Outstanding Amount': Math.round(remaining * 100) / 100,
      'Status': status,
      'Updated At': new Date()
    });
    unallocated = Math.round((unallocated - applied) * 100) / 100;
  });

  const receivedTotal = listObjects_(SHEETS.contributions)
    .filter(item => String(item['Pledge ID']) === pledgeId && item.Status === 'Received' && String(item.Currency).toUpperCase() === String(pledge.Currency).toUpperCase())
    .reduce((sum, item) => sum + (Number(item.Amount) || 0), 0);
  const total = Number(pledge['Total Amount']) || 0;
  const outstandingTotal = Math.max(0, Math.round((total - receivedTotal) * 100) / 100);
  const refreshedInstallments = listObjects_(SHEETS.installments)
    .filter(item => String(item['Pledge ID']) === pledgeId && !['Paid', 'Cancelled'].includes(item.Status))
    .sort((a, b) => new Date(a['Due Date']) - new Date(b['Due Date']));
  const updated = updateObjectRow_(SHEETS.pledges, pledge._row, {
    'Received Amount': Math.round(receivedTotal * 100) / 100,
    'Outstanding Amount': outstandingTotal,
    'Status': calculatePledgeStatus_(total, receivedTotal, pledge.Status),
    'Next Due Date': refreshedInstallments.length ? refreshedInstallments[0]['Due Date'] : '',
    'Updated At': new Date()
  });
  audit_('APPLY_CONTRIBUTION', 'Pledge', pledgeId, `Applied contribution ${contribution['Contribution ID']}`, pledge, updated, actor);
}

function refreshInstallmentStatuses_() {
  const today = dateAtNoon_(new Date());
  listObjects_(SHEETS.installments).forEach(item => {
    if (['Paid', 'Cancelled'].includes(item.Status)) return;
    const outstanding = Number(item['Outstanding Amount']) || 0;
    const received = Number(item['Received Amount']) || 0;
    const due = dateAtNoon_(item['Due Date']);
    let status = 'Scheduled';
    if (outstanding <= 0.005) status = 'Paid';
    else if (received > 0) status = 'Partially Paid';
    else if (due < today) status = 'Overdue';
    else if (due.getTime() === today.getTime()) status = 'Due';
    if (status !== item.Status) {
      updateObjectRow_(SHEETS.installments, item._row, { 'Status': status, 'Updated At': new Date() });
    }
  });
}
