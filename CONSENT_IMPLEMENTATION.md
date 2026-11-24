# Consent Enforcement Implementation

This PR implements server-side consent enforcement and proof-of-consent logging to meet Twilio toll-free verification requirements (TFV error 30446: Express Written Consent).

## What Changed

### 1. Database Migration (`db/migrations/2026-11-24-consent-log.sql`)

**New table: `consent_log`**
- Immutable, append-only audit trail of all consent events
- Captures: phone, method (web_form/keyword), source (hero/footer/JOIN/etc), disclosure text, IP/UA, timestamp
- Event types: `initial_consent`, `double_optin_confirm`, `opt_out`
- **Never delete rows from this table** — it's proof-of-consent for Twilio audits

**New column: `sms_users.consent_logged_at`**
- Tracks when consent was last logged for quick filtering

**Automatic backfill:**
- Migration includes idempotent backfill of existing `blast_opt_in` users
- Skips phones that already have an `initial_consent` record
- Uses method='keyword', source='BACKFILL', consent_version='backfill-pre-2026-11-24'
- One SQL file does everything

### 2. Consent Logging Module (`lib/consent.js`)

New helper functions:
- `logConsent()` - creates immutable consent records
- `hasConsent()` - checks if a phone has valid consent
- `getConsentHistory()` - retrieves full audit trail for a number

### 3. Server-Side Enforcement (`api/join.js`)

**Breaking change:** Web signups now reject `400 Bad Request` if:
- Phone number provided AND
- `consent` field is not explicitly `true`

**What it logs:**
- Phone number (E.164)
- Form source (hero/footer)
- Exact disclosure text shown to user
- Consent version (v1)
- IP address (from X-Forwarded-For or socket)
- User agent
- Timestamp (UTC)

**Fail-safe:** If consent logging fails (e.g., table doesn't exist yet):
- Logs error to console
- **Still requires consent: true**
- Continues signup (doesn't 500 the user)
- This allows deployment before migration

### 4. Keyword Opt-In Logging (`lib/conversation.js`)

Now logs consent for:
- **Initial keyword opt-in:** JOIN, BERGEN, WEEKEND keywords
- **Double opt-in confirmation:** Sending JOIN again after already opted in
- **Opt-out:** STOP keyword

Each event creates a `consent_log` record with the keyword as the source.

### 5. Weekly Blast Filtering (`api/blast.js`)

**Breaking change:** Friday blast now only sends to recipients who:
- Have `blast_opt_in = true`
- Have `opted_out = false`
- **AND have at least one consent record** (single query, no N+1)

**Optimized:** Uses one query to fetch all consented phones, then filters in memory (not N+1 loop)

This ensures only consented users receive marketing texts.

### 6. Front-End Updates (`index.html`)

Both hero and footer forms now send:
```json
{
  "phone": "5551234567",
  "email": "user@example.com",
  "consent": true,
  "source": "hero",
  "disclosure_text": "By providing your number and checking this box, you agree to receive recurring automated marketing texts from Exit 163 (about 1 message/week, plus replies when you text us). Msg & data rates may apply. Consent is not a condition of any purchase. Reply STOP to cancel, HELP for help. Privacy · Terms.",
  "consent_version": "v1"
}
```

### 7. Tests (`test/consent.test.js`)

New test coverage:
- ✅ Web form consent logging
- ✅ Consent detection
- ✅ Keyword opt-in logging (JOIN, BERGEN, WEEKEND)
- ✅ STOP opt-out logging
- ✅ Server-side rejection of missing consent
- ✅ Server-side acceptance of explicit consent

## What You Need to Do

### Before Merge

1. **Run tests:**
   ```bash
   npm test
   ```
   All tests should pass, including the new `consent.test.js`.

2. **Apply the migration:**
   ```bash
   # Connect to your Supabase database
   psql $DATABASE_URL < db/migrations/2026-11-24-consent-log.sql
   ```
   
   This creates the table, adds the column, **AND backfills existing opt-ins automatically**.

3. **Verify the migration:**
   ```sql
   -- Check table exists and has backfilled data
   SELECT event_type, method, source, COUNT(*) 
   FROM consent_log 
   GROUP BY event_type, method, source;
   
   -- Should see: initial_consent | keyword | BACKFILL | <count>
   
   -- Check new column exists
   SELECT consent_logged_at FROM sms_users LIMIT 1;
   ```

4. **Review front-end changes** in `index.html` - ensure the consent checkbox is working and sending data correctly

### After Merge

1. **Monitor consent logging:**
   ```sql
   -- Check recent consent events
   SELECT 
     event_type, 
     method, 
     source, 
     COUNT(*) as count,
     MAX(created_at) as latest
   FROM consent_log
   WHERE created_at > NOW() - INTERVAL '7 days'
   GROUP BY event_type, method, source
   ORDER BY latest DESC;
   ```

3. **Verify blast filtering works:**
   - Run a dry-run blast: `POST /api/blast` with `dry_run: true`
   - Check the recipient count matches users with consent records
   - Should match since migration includes automatic backfill

## Breaking Changes

### For Web Forms
- **Before:** Any phone submission would send confirmation SMS
- **After:** Server rejects submissions where `consent !== true`
- **Impact:** Front-end MUST send `consent: true` in POST body

### For Weekly Blast
- **Before:** Sent to all `blast_opt_in = true` users
- **After:** Only sends to users with consent records
- **Impact:** None (migration includes automatic backfill)

## Environment Variables

No new environment variables required. Uses existing:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Rollback Plan

If you need to rollback:

1. **Revert code changes:**
   ```bash
   git revert <commit-hash>
   ```

2. **Keep the migration** - `consent_log` table is harmless and may contain valuable audit data

3. **Temporarily disable consent check in api/blast.js:**
   ```javascript
   // Comment out the consent filter
   const recipients = allRecipients;
   ```

## Twilio TFV Submission

After this is deployed and tested, you can submit for Twilio toll-free verification with:

1. **Screenshots showing:**
   - Unchecked checkbox on signup forms ✅ (already captured)
   - Full disclosure text visible ✅ (already captured)
   - Keyword opt-in line on homepage ✅ (already captured)

2. **New evidence of server-side enforcement:**
   - Point to `api/join.js` lines 85-92 (consent enforcement)
   - Point to `lib/consent.js` (proof-of-consent logging)
   - Mention consent_log table is immutable audit trail

3. **Consent record retention:**
   - "Consent records are stored indefinitely in an append-only consent_log table"
   - "Records include: timestamp, disclosure text, IP address, user agent, source form"

## Questions?

- **Why log both initial_consent AND double_optin_confirm?**  
  Because Twilio wants proof of the double opt-in flow. Web forms create `initial_consent`, then when user replies JOIN, we log `double_optin_confirm`.

- **What if someone opts in via keyword but we don't have their IP?**  
  That's fine - keyword opt-ins don't require IP/UA. The inbound SMS itself is proof.

- **What happens if I deploy before running the migration?**  
  Fail-safe: consent logging errors are caught and logged, but signup continues. The server still enforces `consent: true` requirement. Run the migration ASAP to start capturing records.

- **Can I delete old consent records?**  
  **NO.** Never delete consent_log records. This is your legal proof-of-consent for Twilio audits.

- **What about GDPR right to be forgotten?**  
  GDPR allows retention of records "necessary for compliance with a legal obligation" (GDPR Art 6(1)(c)). Consent records are required by telecom regulations. For GDPR requests, the FORGET command wipes personal data (name, town, chat history) but preserves the consent audit trail with just the phone number.
