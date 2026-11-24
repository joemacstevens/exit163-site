-- Proof-of-consent audit log for Twilio toll-free verification (TFV error 30446).
-- Every opt-in (web form or keyword) must leave a timestamped, immutable record.
-- Never delete rows from this table.

create table if not exists consent_log (
  id               bigint generated always as identity primary key,
  phone            text not null,              -- E.164
  method           text not null check (method in ('web_form', 'keyword')),
  source           text not null,              -- 'hero', 'footer', 'weekend', 'JOIN', 'BERGEN', 'WEEKEND'
  disclosure_text  text,                       -- exact disclosure shown (web) or null (keyword)
  consent_version  text,                       -- optional version id ('v1', '2026-11-24', etc.)
  ip_address       text,                       -- available for web forms
  user_agent       text,                       -- available for web forms
  message_sid      text,                       -- Twilio message SID for keyword opt-ins
  event_type       text not null check (event_type in ('initial_consent', 'double_optin_confirm', 'opt_out')),
  created_at       timestamptz not null default now()
);

create index if not exists consent_log_phone_idx on consent_log (phone, created_at desc);
create index if not exists consent_log_event_idx on consent_log (event_type, created_at desc);

alter table consent_log enable row level security;

-- Add consent tracking flag to sms_users
alter table sms_users add column if not exists consent_logged_at timestamptz;

comment on table consent_log is 'Immutable proof-of-consent audit trail for Twilio TFV compliance. Never delete.';
comment on column consent_log.disclosure_text is 'Exact consent disclosure text shown to user, or NULL for keyword opt-ins where disclosure is in the confirmation SMS';
comment on column consent_log.event_type is 'initial_consent = form submit or keyword; double_optin_confirm = JOIN reply; opt_out = STOP';
