// Consent logging for Twilio toll-free verification compliance.
// Every SMS opt-in must leave an immutable, timestamped proof-of-consent record.

const { db, q } = require('./db');

/**
 * Log a consent event (initial consent, double opt-in confirmation, or opt-out).
 * @param {object} p
 * @param {string} p.phone - E.164 phone number
 * @param {'web_form'|'keyword'} p.method
 * @param {string} p.source - form id ('hero', 'footer', 'weekend') or keyword ('JOIN', 'BERGEN', 'WEEKEND')
 * @param {'initial_consent'|'double_optin_confirm'|'opt_out'} p.eventType
 * @param {string} [p.disclosureText] - exact disclosure shown (required for web forms, null for keywords)
 * @param {string} [p.consentVersion] - version identifier (e.g., 'v1', '2026-11-24')
 * @param {string} [p.ipAddress] - IP address (web forms only)
 * @param {string} [p.userAgent] - User agent (web forms only)
 * @param {string} [p.messageSid] - Twilio message SID (keyword opt-ins only)
 * @returns {Promise<void>}
 */
async function logConsent({
  phone,
  method,
  source,
  eventType,
  disclosureText = null,
  consentVersion = null,
  ipAddress = null,
  userAgent = null,
  messageSid = null,
}) {
  if (!phone || !method || !source || !eventType) {
    throw new Error('logConsent: phone, method, source, and eventType are required');
  }

  const record = {
    phone,
    method,
    source,
    event_type: eventType,
    disclosure_text: disclosureText,
    consent_version: consentVersion,
    ip_address: ipAddress,
    user_agent: userAgent,
    message_sid: messageSid,
  };

  await q(db().from('consent_log').insert(record));

  // Update the consent_logged_at timestamp on sms_users
  if (eventType === 'initial_consent' || eventType === 'double_optin_confirm') {
    await q(db().from('sms_users').update({ consent_logged_at: new Date().toISOString() }).eq('phone', phone))
      .catch((e) => console.error('consent_logged_at update failed', e.message));
  }
}

/**
 * Check if a phone number has valid consent (initial consent or double opt-in).
 * @param {string} phone - E.164 phone number
 * @returns {Promise<boolean>}
 */
async function hasConsent(phone) {
  const records = await q(
    db()
      .from('consent_log')
      .select('event_type')
      .eq('phone', phone)
      .in('event_type', ['initial_consent', 'double_optin_confirm'])
      .order('created_at', { ascending: false })
      .limit(1)
  );
  return records.length > 0;
}

/**
 * Get the consent history for a phone number (for debugging/audits).
 * @param {string} phone - E.164 phone number
 * @returns {Promise<Array>}
 */
async function getConsentHistory(phone) {
  return q(
    db()
      .from('consent_log')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: true })
  );
}

module.exports = { logConsent, hasConsent, getConsentHistory };
