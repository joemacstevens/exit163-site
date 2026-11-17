-- 2026-11-12: follow-ups ("I'll find out and text you back") ------------------
-- Applied to the live database on 2026-11-13 (SQL editor). The code (lib/followups.js) only uses it
-- when FOLLOWUPS=on, and treats a missing table as "follow-ups aren't available".
-- Spec: research/FOLLOWUP-SPEC.md
--
-- A follow-up is one question a texter agreed to have answered by text later.
-- research_tickets stays anonymous: the phone number lives only here, and research works
-- from `question` and the ticket. Only the send step (lib/followups.js sendApproved) reads phone.
create table if not exists followups (
  id           bigint generated always as identity primary key,
  phone        text not null references sms_users(phone) on delete cascade,
  ticket_id    bigint references research_tickets(id) on delete set null,
  channel      text not null default 'sms',   -- sms | test (test rows are never texted)
  question     text not null,                 -- what to find out, no personal details
  town_slug    text references towns(slug),
  category     text,
  needed_by    date,                          -- when the answer stops being useful, if they said
  due_at       timestamptz not null,          -- when we promised to text back
  agreed_at    timestamptz not null default now(), -- when they said yes (kept even if FORGET wipes the chat)
  status       text not null default 'open'
               check (status in ('open','drafted','approved','sending','sent','closed','canceled')),
               -- open: waiting on research      drafted: answer written, waiting on approval
               -- approved: ready to send        sending: claimed by a send run
               -- sent: texted                   closed: answered in conversation, no text needed
               -- canceled: they opted out
  found        boolean,                       -- true = an answer, false = an honest "couldn't confirm"
  answer_text  text,                          -- the text to send
  source_url   text,                          -- where the answer came from
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index if not exists followups_status_idx on followups (status, due_at);
create index if not exists followups_phone_idx on followups (phone, created_at desc);
alter table followups enable row level security;
