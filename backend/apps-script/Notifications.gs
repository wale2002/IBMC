/**
 * Email acknowledgements and pledge reminders.
 */

function sendEmailSafely_(recipient, subject, body, context) {
  const email = normalizeEmail_(recipient);
  if (!email || !isValidEmail_(email)) return { sent: false, reason: 'No valid email address' };
  if (!isTrue_(getSetting_('AUTOMATIC_EMAILS', 'TRUE'))) return { sent: false, reason: 'Automatic emails disabled' };
  if (MailApp.getRemainingDailyQuota() < 1) return { sent: false, reason: 'Daily email quota exhausted' };

  try {
    const options = {
      to: email,
      subject: sanitizeText_(subject, 200),
      body: String(body || ''),
      name: `${getSetting_('ORGANISATION_NAME', 'IBMC')} Endowment Fund`
    };
    const replyTo = normalizeEmail_(getSetting_('CONTACT_EMAIL', ''));
    if (replyTo && isValidEmail_(replyTo)) options.replyTo = replyTo;
    MailApp.sendEmail(options);
    audit_('EMAIL_SENT', context.entityType || 'Notification', context.entityId || '', maskEmail_(email), '', {
      subject: options.subject
    }, 'system');
    return { sent: true };
  } catch (error) {
    audit_('EMAIL_FAILED', context.entityType || 'Notification', context.entityId || '', sanitizeText_(error.message, 500), '', {
      recipient: maskEmail_(email), subject: sanitizeText_(subject, 200)
    }, 'system');
    return { sent: false, reason: error.message || 'Email failed' };
  }
}

function runDailyReminders() {
  refreshInstallmentStatuses_();
  const reminderDays = Number(getSetting_('REMINDER_DAYS_BEFORE', '7')) || 7;
  const overdueRepeatDays = Number(getSetting_('OVERDUE_REPEAT_DAYS', '14')) || 14;
  const today = dateAtNoon_(new Date());
  const donorsById = {};
  listObjects_(SHEETS.donors).forEach(donor => { donorsById[donor['Donor ID']] = donor; });
  const pledgesById = {};
  listObjects_(SHEETS.pledges).forEach(pledge => { pledgesById[pledge['Pledge ID']] = pledge; });

  const summary = { reviewed: 0, emailed: 0, queuedManual: 0, skipped: 0, failed: 0 };
  listObjects_(SHEETS.installments).forEach(item => {
    if (['Paid', 'Cancelled'].includes(item.Status)) return;
    summary.reviewed += 1;
    const dueDate = dateAtNoon_(item['Due Date']);
    const daysUntilDue = daysBetween_(today, dueDate);
    const lastReminder = item['Last Reminder At'] ? new Date(item['Last Reminder At']) : null;
    const daysSinceLast = lastReminder ? daysBetween_(lastReminder, today) : 99999;
    const reminderType = daysUntilDue < 0 ? 'Overdue' : daysUntilDue <= reminderDays ? 'Upcoming' : '';
    if (!reminderType) { summary.skipped += 1; return; }
    if (lastReminder && reminderType === 'Upcoming') { summary.skipped += 1; return; }
    if (lastReminder && reminderType === 'Overdue' && daysSinceLast < overdueRepeatDays) { summary.skipped += 1; return; }

    const donor = donorsById[item['Donor ID']];
    const pledge = pledgesById[item['Pledge ID']];
    if (!donor || !pledge) { summary.failed += 1; return; }
    const preference = String(donor['Preferred Communication'] || 'Email');
    const subject = reminderType === 'Overdue'
      ? `Pledge installment overdue ${item['Pledge ID']}`
      : `Pledge installment due ${formatDate_(dueDate)}`;
    const body = acknowledgementBody_(donor['Full Name'], [
      reminderType === 'Overdue'
        ? 'Our records show that a pledge installment is overdue.'
        : 'This is a reminder that a pledge installment is approaching its due date.',
      `Pledge reference: ${item['Pledge ID']}`,
      `Amount due: ${item.Currency} ${formatMoney_(item['Outstanding Amount'])}`,
      `Due date: ${formatDate_(dueDate)}`,
      'If you have already made this payment, please send the transaction reference to the trustees so the record can be reconciled.'
    ]);

    let status = 'Queued for manual follow-up';
    let error = '';
    if (preference === 'Email') {
      const sendResult = sendEmailSafely_(donor.Email, subject, body, {
        entityType: 'Installment', entityId: item['Installment ID']
      });
      if (sendResult.sent) { status = 'Sent'; summary.emailed += 1; }
      else { status = 'Failed'; error = sendResult.reason; summary.failed += 1; }
    } else {
      summary.queuedManual += 1;
    }

    const now = new Date();
    appendObject_(SHEETS.reminders, {
      'Reminder ID': generateId_(APP.idPrefixes.reminder),
      'Created At': now,
      'Donor ID': donor['Donor ID'],
      'Pledge ID': item['Pledge ID'],
      'Installment ID': item['Installment ID'],
      'Channel': preference,
      'Recipient': preference === 'Email' ? maskEmail_(donor.Email) : donor.Phone,
      'Reminder Type': reminderType,
      'Due Date': dueDate,
      'Amount': item['Outstanding Amount'],
      'Currency': item.Currency,
      'Status': status,
      'Sent At': status === 'Sent' ? now : '',
      'Error': sanitizeText_(error, 500)
    });
    updateObjectRow_(SHEETS.installments, item._row, {
      'Last Reminder At': now,
      'Reminder Count': (Number(item['Reminder Count']) || 0) + 1,
      'Updated At': now
    });
    updateObjectRow_(SHEETS.pledges, pledge._row, { 'Last Reminder At': now, 'Updated At': now });
  });
  audit_('REMINDER_RUN', 'System', 'reminders', JSON.stringify(summary), '', '', 'system');
  return summary;
}
