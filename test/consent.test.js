// Tests for consent enforcement and proof-of-consent logging.
// Run: npm test -- consent.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { db, q } = require('../lib/db');
const { logConsent, hasConsent, getConsentHistory } = require('../lib/consent');

// Mock phone for tests
const TEST_PHONE = '+15551234567';

describe('Consent enforcement', () => {
  after(async () => {
    // Clean up after all tests
    await q(db().from('consent_log').delete().eq('phone', TEST_PHONE)).catch(() => {});
    await q(db().from('sms_users').delete().eq('phone', TEST_PHONE)).catch(() => {});
    await q(db().from('sms_messages').delete().eq('phone', TEST_PHONE)).catch(() => {});
  });

  it('should log web form consent', async () => {
    await logConsent({
      phone: TEST_PHONE,
      method: 'web_form',
      source: 'hero',
      eventType: 'initial_consent',
      disclosureText: 'By providing your number and checking this box...',
      consentVersion: 'v1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    });

    const history = await getConsentHistory(TEST_PHONE);
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].method, 'web_form');
    assert.strictEqual(history[0].source, 'hero');
    assert.strictEqual(history[0].event_type, 'initial_consent');
    assert.ok(history[0].disclosure_text.includes('By providing your number'));
  });

  it('should detect consent exists', async () => {
    await logConsent({
      phone: TEST_PHONE,
      method: 'web_form',
      source: 'footer',
      eventType: 'initial_consent',
      disclosureText: 'Test disclosure',
    });

    const has = await hasConsent(TEST_PHONE);
    assert.strictEqual(has, true);
  });

  it('should return false when no consent exists', async () => {
    const TEST_PHONE_2 = '+15559999999';
    const has = await hasConsent(TEST_PHONE_2);
    assert.strictEqual(has, false);
  });

  it('should log keyword opt-in', async () => {
    await logConsent({
      phone: TEST_PHONE,
      method: 'keyword',
      source: 'JOIN',
      eventType: 'initial_consent',
    });

    const history = await getConsentHistory(TEST_PHONE);
    assert.ok(history.length >= 1);
    const joinRecord = history.find(r => r.source === 'JOIN');
    assert.ok(joinRecord);
    assert.strictEqual(joinRecord.method, 'keyword');
  });

  it('/api/join should reject missing consent', async () => {
    const req = {
      method: 'POST',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    };
    const body = {
      phone: '5551234567',
      consent: false, // Not checked
    };

    // Mock readBody to return our test body
    const originalReadBody = require('../lib/http').readBody;
    require('../lib/http').readBody = async () => body;

    const join = require('../api/join');
    let statusCode, jsonData;
    const res = {
      setHeader: () => {},
      status: (code) => { statusCode = code; return res; },
      json: (data) => { jsonData = data; },
    };

    await join(req, res);

    assert.strictEqual(statusCode, 400);
    assert.strictEqual(jsonData.ok, false);
    assert.ok(jsonData.error.includes('check the box'));

    // Restore original
    require('../lib/http').readBody = originalReadBody;
  });

  it('/api/join should accept explicit consent', async () => {
    const TEST_PHONE_3 = '+15558888888';
    const req = {
      method: 'POST',
      headers: { 'user-agent': 'Test' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const body = {
      phone: TEST_PHONE_3.replace('+1', ''),
      consent: true,
      source: 'hero',
      disclosure_text: 'Test disclosure',
      consent_version: 'v1',
    };

    const originalReadBody = require('../lib/http').readBody;
    require('../lib/http').readBody = async () => body;

    const join = require('../api/join');
    let statusCode, jsonData;
    const res = {
      setHeader: () => {},
      status: (code) => { statusCode = code; return res; },
      json: (data) => { jsonData = data; },
    };

    await join(req, res);

    // Should succeed
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonData.ok, true);

    // Check consent was logged
    const history = await getConsentHistory(TEST_PHONE_3);
    assert.ok(history.length > 0);
    const heroRecord = history.find(r => r.source === 'hero');
    assert.ok(heroRecord);

    // Cleanup
    await q(db().from('consent_log').delete().eq('phone', TEST_PHONE_3)).catch(() => {});
    await q(db().from('sms_users').delete().eq('phone', TEST_PHONE_3)).catch(() => {});

    // Restore
    require('../lib/http').readBody = originalReadBody;
  });
});
