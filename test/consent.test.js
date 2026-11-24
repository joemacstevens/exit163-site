// Tests for consent enforcement and proof-of-consent logging.
// Run: npm test -- consent.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

describe('Consent enforcement', () => {
  it('should log and check web form consent', async () => {
    // Clear module cache
    const dbPath = path.join(__dirname, '../lib/db.js');
    const consentPath = path.join(__dirname, '../lib/consent.js');
    delete require.cache[require.resolve(dbPath)];
    delete require.cache[require.resolve(consentPath)];

    // Mock consent log storage
    const consentLog = [];
    const smsUsers = new Map();

    const mockSupabase = {
      from: (table) => ({
        select: (...args) => ({
          eq: (col, val) => ({
            in: (col2, vals) => ({
              order: () => ({
                limit: () => ({
                  then: async (cb) => {
                    if (table === 'consent_log') {
                      const filtered = consentLog.filter(r => r.phone === val && vals.includes(r.event_type));
                      return cb({ data: filtered, error: null });
                    }
                    return cb({ data: [], error: null });
                  },
                }),
              }),
            }),
            order: () => ({
              then: async (cb) => {
                if (table === 'consent_log') {
                  const filtered = consentLog.filter(r => r.phone === val);
                  return cb({ data: filtered, error: null });
                }
                return cb({ data: [], error: null });
              },
            }),
          }),
        }),
        insert: (data) => ({
          then: async (cb) => {
            if (table === 'consent_log') {
              const record = Array.isArray(data) ? data[0] : data;
              consentLog.push({ ...record, created_at: new Date().toISOString() });
            }
            if (table === 'sms_users') {
              const record = Array.isArray(data) ? data[0] : data;
              smsUsers.set(record.phone, record);
            }
            return cb({ data: null, error: null });
          },
        }),
        update: (data) => ({
          eq: (col, val) => ({
            then: async (cb) => {
              if (table === 'sms_users' && smsUsers.has(val)) {
                Object.assign(smsUsers.get(val), data);
              }
              return cb({ data: null, error: null });
            },
            catch: (fn) => ({ then: (cb) => cb({ data: null, error: null }) }),
          }),
        }),
      }),
    };

    // Mock db module
    require.cache[require.resolve(dbPath)] = {
      id: require.resolve(dbPath),
      filename: require.resolve(dbPath),
      loaded: true,
      exports: {
        db: () => mockSupabase,
        q: async (p) => {
          const result = await p;
          return result.data !== undefined ? result.data : result;
        },
      },
    };

    const { logConsent, hasConsent, getConsentHistory } = require('../lib/consent');

    // Test logging
    await logConsent({
      phone: '+15551234567',
      method: 'web_form',
      source: 'hero',
      eventType: 'initial_consent',
      disclosureText: 'By providing your number and checking this box...',
      consentVersion: 'v1',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    });

    // Test history retrieval
    const history = await getConsentHistory('+15551234567');
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].method, 'web_form');
    assert.strictEqual(history[0].source, 'hero');
    assert.strictEqual(history[0].event_type, 'initial_consent');

    // Test has consent
    const has = await hasConsent('+15551234567');
    assert.strictEqual(has, true);

    // Test no consent
    const noConsent = await hasConsent('+15559999999');
    assert.strictEqual(noConsent, false);
  });

  it('/api/join should reject missing consent', async () => {
    // Clear module cache
    const dbPath = path.join(__dirname, '../lib/db.js');
    const httpPath = path.join(__dirname, '../lib/http.js');
    const joinPath = path.join(__dirname, '../api/join.js');
    delete require.cache[require.resolve(dbPath)];
    delete require.cache[require.resolve(httpPath)];
    delete require.cache[require.resolve(joinPath)];

    // Mock empty DB
    const mockSupabase = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: () => ({ select: () => ({ single: async () => ({ data: {}, error: null }) }) }),
      }),
    };

    require.cache[require.resolve(dbPath)] = {
      id: require.resolve(dbPath),
      filename: require.resolve(dbPath),
      loaded: true,
      exports: {
        db: () => mockSupabase,
        q: async (p) => {
          const result = await p;
          return result.data !== undefined ? result.data : result;
        },
      },
    };

    // Mock readBody (use valid 10-digit US number)
    require.cache[require.resolve(httpPath)] = {
      id: require.resolve(httpPath),
      filename: require.resolve(httpPath),
      loaded: true,
      exports: {
        readBody: async () => ({ phone: '2015551234', consent: false }),
        withTimeout: (p) => p,
      },
    };

    const join = require('../api/join');
    let statusCode, jsonData;
    const req = { method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    const res = {
      setHeader: () => {},
      status: (code) => { statusCode = code; return res; },
      json: (data) => { jsonData = data; },
    };

    await join(req, res);

    assert.strictEqual(statusCode, 400);
    assert.ok(jsonData, 'jsonData should be defined');
    assert.strictEqual(jsonData.ok, false);
    assert.strictEqual(jsonData.field, 'phone');
    assert.ok(jsonData.error && jsonData.error.includes('check the box'), `Expected error to include 'check the box', got: ${jsonData.error}`);
  });

  it('/api/join should accept explicit consent (consent logging tested separately)', async () => {
    // Clear module cache
    const dbPath = path.join(__dirname, '../lib/db.js');
    const httpPath = path.join(__dirname, '../lib/http.js');
    const consentPath = path.join(__dirname, '../lib/consent.js');
    const joinPath = path.join(__dirname, '../api/join.js');
    const twilioPath = path.join(__dirname, '../lib/twilio.js');
    const newsletterPath = path.join(__dirname, '../lib/newsletter.js');
    
    delete require.cache[require.resolve(dbPath)];
    delete require.cache[require.resolve(httpPath)];
    delete require.cache[require.resolve(consentPath)];
    delete require.cache[require.resolve(joinPath)];
    delete require.cache[require.resolve(twilioPath)];
    delete require.cache[require.resolve(newsletterPath)];

    const mockSupabase = {
      from: (table) => ({
        select: () => { 
          const chain = {
            eq: () => chain,
            gte: () => chain,
            limit: () => chain,
            order: () => chain,
            maybeSingle: async () => ({ data: null, error: null }),
            then: async (cb) => cb({ data: [], error: null }),
          };
          return chain;
        },
        insert: (data) => ({
          select: () => ({ single: async () => ({ data: {}, error: null }) }),
          then: async (cb) => cb({ data: null, error: null }),
        }),
        update: () => ({ 
          eq: () => ({ 
            then: async (cb) => cb({ data: null, error: null }),
            catch: () => ({ then: (cb) => cb({ data: null, error: null }) }),
          }) 
        }),
      }),
    };

    require.cache[require.resolve(dbPath)] = {
      id: require.resolve(dbPath),
      filename: require.resolve(dbPath),
      loaded: true,
      exports: {
        db: () => mockSupabase,
        q: async (p) => {
          const result = await p;
          if (result.error) throw new Error(result.error.message);
          return result.data !== undefined ? result.data : result;
        },
      },
    };

    require.cache[require.resolve(httpPath)] = {
      id: require.resolve(httpPath),
      filename: require.resolve(httpPath),
      loaded: true,
      exports: {
        readBody: async () => ({ 
          phone: '2015551234', 
          consent: true, 
          source: 'hero',
          disclosure_text: 'Test',
          consent_version: 'v1',
        }),
        withTimeout: (p) => p,
      },
    };

    require.cache[require.resolve(twilioPath)] = {
      id: require.resolve(twilioPath),
      filename: require.resolve(twilioPath),
      loaded: true,
      exports: { 
        sendSms: async () => {},
      },
    };

    require.cache[require.resolve(newsletterPath)] = {
      id: require.resolve(newsletterPath),
      filename: require.resolve(newsletterPath),
      loaded: true,
      exports: {
        addSubscriber: async () => ({ isNew: false }),
        sendWelcome: async () => {},
        EMAIL_RE: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
      },
    };

    const join = require('../api/join');
    let statusCode, jsonData;
    const req = { method: 'POST', headers: { 'user-agent': 'Test' }, socket: { remoteAddress: '127.0.0.1' } };
    const res = {
      setHeader: () => {},
      status: (code) => { statusCode = code; return res; },
      json: (data) => { jsonData = data; },
    };

    await join(req, res);

    // Should succeed
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonData.ok, true);
    assert.strictEqual(jsonData.phone, 'sent');
  });
});
