# Follow-ups: "I'll find out and text you back"

Spec, 2026-11-12. Step 1 of the build order is built and merged to `main` (PR #13). The `followups` table has been in the live database since 2026-11-13, and the yes path passed against the real buddy that day (`research/test-runs/2026-11-13T14-48-46-followups-live.md`). It stays off until `FOLLOWUPS=on` is set. Step 2 (the research routine and the email to Joe) was built the same day: `research/FOLLOWUP-ROUTINE.md`, scheduled tasks `exit163-followups-am` and `exit163-followups-pm`. Where the build differs from the first draft of this spec, the text below has been updated.

When the buddy has no answer to a specific question, it offers to find out. If the person says yes, the question goes to research, and the buddy texts the answer (or an honest "couldn't confirm it") by a promised time. Every answer found also goes into the database, so the next person who asks gets it straight away.

## Decisions for Joe

Each has my recommendation. The rest of the spec assumes the recommended answer.

1. **Who checks an answer before it is texted?** Recommended: you approve every one at launch. A wrong answer sent on the buddy's own initiative costs more trust than a slow one. Move to automatic sending later, and only for answers taken from the venue's or organizer's own page.
2. **Where does the research run?** Recommended: a local scheduled routine twice a day, like the weekly pipeline. It can use the logged-in Facebook and Instagram sources (41 in the registry need a login), which a server job cannot. The cost is that it only runs when the Mac is on.
3. **Who can get a follow-up?** Recommended: anyone who says yes to the offer, whether or not they replied JOIN. They asked for this one text.
4. **May the scheduled routine write drafts to the live database?** It has to save its draft answers somewhere. Recommended: yes for drafts, never for sending. Sending stays behind your approval, the same idea as `approved.txt`.
5. **Texting rules.** I am not a lawyer. Two things to confirm before launch: that the registered Twilio campaign's description and sample messages cover a requested follow-up text, and that a "yes" in the thread is enough consent for someone who never replied JOIN.

## What the code does today

- The buddy is told never to promise a later text (`lib/agent.js:45`). On a miss it says "check back Thursday" (`checkBackPhrase`, `lib/agent.js:250`).
- A miss already files a research ticket (`lib/conversation.js:205`), but tickets are anonymous on purpose: no phone, no name (`lib/tickets.js`). Nothing links a ticket back to the person who asked.
- Outbound texts exist (`sendSms` in `lib/twilio.js`) and are used only by `/api/blast`, which enforces 8am to 9pm NJ.
- The one cron runs at 08:00 UTC, which is 3am in NJ, so nothing can be sent from it.
- A text the buddy sends first is dropped from the chat history on the next inbound message: `toTurns` (`lib/conversation.js:229`) removes leading assistant turns, and history only reaches back 24 hours. Without a fix, "what time does it start?" in reply to a follow-up would get a blank stare.
- Scale of the opportunity: in the 28-persona eval, 7 of 85 turns were honest misses after the data import (23 of 99 before it). The live `research_tickets` table has 0 rows, because production does not run this code yet, so there is no real-world miss volume to size against.

## The flow

1. **Miss.** The buddy searches, finds nothing, and says so honestly, as it does now.
2. **Offer.** If the ask qualifies (rules below), the same reply ends with the offer instead of "check back Thursday".
3. **Yes.** On a yes, the buddy calls a new `follow_up` tool. Its reply uses the promise wording the tool returns.
4. **Research.** The routine works the open questions twice a day and saves a draft answer with its source.
5. **Approve.** You get an email with each draft and its source link, and approve, edit or reject.
6. **Send.** Approved answers go out through a new endpoint, inside 8am to 9pm.
7. **Carry on.** If they reply, the buddy knows what it sent and continues the conversation.

Example:

> **Them:** is the Oradell tree lighting still on with the rain saturday?
> **Buddy:** I haven't heard either way, and the borough hasn't posted a change. Want me to find out and text you back?
> **Them:** yes pls
> **Buddy:** On it. I'll text you by tomorrow night.
> *(next day)* **Buddy:** Found out: the Oradell tree lighting moved inside to the firehouse on Kinderkamack, same time, Saturday 5pm. Free, and Santa's still coming.

If nothing turns up by the promised time, the person still gets one text: "I dug into the Oradell tree lighting and couldn't confirm anything about the rain plan. The borough office is the surest bet Saturday morning." The loop always closes.

## When the buddy offers

- Only after an honest miss on something checkable: a named event, venue or performer; a fact about a known item (sold out, time, price, stroller-friendly, rain plan); or a specific kind of thing on specific dates ("a Diwali event next weekend").
- Not for broad asks ("anything fun Saturday?"). Those keep today's behavior: the closest real thing, or the check-back line.
- Not when the answer is needed sooner than the promise. If it's for today or tomorrow, say so honestly and don't offer. The tool enforces this: `needed_by` must be at least two days out. This rules out a Friday ask about Saturday, which is a real loss; it goes away when research runs faster than once a day (build order, step 3).
- At most one offer per conversation and two open follow-ups per person.
- The buddy says "I'll text you" only after the tool has confirmed. If the tool refuses, it falls back to the check-back line.
- The yes is checked in code, not left to the model: `follow_up` is refused unless the buddy's last text made the offer or the person asked outright for a text back (`lib/conversation.js`, `onFollowUp`).

## The `follow_up` tool

Input: `question` (the ask in one plain sentence, no personal details), `needed_by` (date the answer stops being useful, if known), `town`, `category`.

Output on success: `{ ok: true, id, promise: "by tomorrow night" }`. On refusal: `{ ok: false, reason }` (cap reached, needed too soon, switched off).

- It must not join `QUIET_TOOLS` (`lib/agent.js:164`). Quiet tools send the reply without the model seeing the result, which would let a promise go out after a refusal. This turn has no search, so the extra model round fits inside the 12-second limit.
- A second small tool, `close_follow_up(id)`, lets the buddy cancel one it has just answered in conversation.
- Promise time, v1: always "by tomorrow night" (8pm NJ the next day). That covers two research runs and your approval. The tool returns the wording so the model never invents a time.

## Data

New table `followups`:

| Column | Notes |
|---|---|
| `id` | |
| `phone` | references `sms_users`, deleted with the user |
| `ticket_id` | references `research_tickets` |
| `question` | the ask, scrubbed like ticket text |
| `needed_by`, `due_at` | when it stops being useful; when we promised |
| `agreed_at` | when they said yes; kept as the consent record even though FORGET deletes chat history |
| `status` | `open` (waiting on research), `drafted`, `approved`, `sending`, `sent`, `closed` (answered in conversation, no text needed), `canceled` (they opted out) |
| `answer_text`, `source_url`, `found` | the draft, its source, whether it is an answer or an honest close |
| `created_at`, `sent_at` | |

- **Tickets stay anonymous.** The phone number lives only in `followups`. The research routine reads the question and the ticket, never the phone; only the send step joins them.
- **FORGET** deletes the person's follow-ups (add to `forgetAll`, `lib/memory.js:149`). **STOP** cancels open ones.
- Sent rows are deleted after 30 days by the nightly job.
- Not in v1: merging the same question from several people into one piece of research.

## Research routine

Two local scheduled tasks, `exit163-followups-am` (10:30am) and `exit163-followups-pm` (5:00pm), daily and clear of the phone routines. Both follow `research/FOLLOWUP-ROUTINE.md`, which is the working copy of these steps. `scripts/followups.js research` gives them the open questions (no phone) with matching registry sources. For each open follow-up, oldest promise first:

1. Search our own database again. A new harvest may already have the answer.
2. Check the sources in `research/sources/REGISTRY.json` that match the town and category, including the logged-in ones.
3. Search the web.
4. **Bar for an answer:** the venue's or organizer's own page, or the ticket page, seen that day, with its link saved. An aggregator or a Facebook comment alone is not enough. A "sold out" or "canceled" needs the same bar.
5. Save a draft in the buddy's voice: under 450 characters, plain text, only facts from that source.
6. Write what it found as a harvest row, so the event or detail reaches the database through the existing import (which still needs your OK).
7. If nothing meets the bar, leave it open. On the last run before the promise is due, draft the honest close.

The routine keeps its notes (`notes-<id>.md`) and what it found (`finds-<date>.json`) in `research/followups/`. "Last run before the promise is due" is worked out in code (`lastCall` in `lib/followups.js`): in practice, the 5pm run on the due date.

## Approve and send

- After each run, one email to you (`scripts/followups.js digest --send`) listing each question, draft and source link, with the commands to approve and send. It is sent only when something needs you: a draft to approve, an approved answer not yet texted, a send that got stuck, or an open question that is late.
- A second email comes from the server, not the Mac: the nightly job (`api/reflect.js`, 3am NJ) emails you when any promise is due within a day and has not been texted. That covers the days the Mac is off and the routine never runs.
- v1 approval is `scripts/followups.js` in a session: `list`, `draft <id>`, `approve <id>`, `reject <id>` (back to open) and `send`, in the style of `scripts/partner.js`. To edit a draft, run `draft` again.
- New endpoint `POST /api/followup` with `ADMIN_TOKEN`, dry run by default like `/api/blast`. It sends only rows marked `approved`, skips opted-out numbers, refuses outside 8am to 9pm, and logs the text to `sms_messages`.
- It claims each row by moving `approved` to `sending` in one update before texting, so a double run cannot text someone twice.
- One text per follow-up. No deal line: deals show only in replies to something the person just asked.
- If a draft is still unapproved at its due time, it shows at the top of the next email marked late. Nothing is sent without approval.

## Keeping the conversation going

- Add open and recently sent follow-ups (last 72 hours) to the context the buddy gets each turn, in `describeProfile` (`lib/agent.js:211`):
  - Open: "You promised to text them back about X by Y. Don't promise it again; if they ask, say you're still on it."
  - Sent: "On DATE you texted them this follow-up: ..." with the source facts, so a reply like "what time?" can be answered.
- This is the fix for the dropped-history problem above. `toTurns` itself does not change.

## Prompt and rubric changes

- Replace the "never promise to text them later" line (`lib/agent.js:45`) with the offer rules above. The check-back wording stays for broad misses.
- `research/eval/RUBRIC.md`: the voice rule "never promises to text later" becomes "never promises a text back unless `follow_up` succeeded". Add a turn outcome `followed_up` for a miss that ended in an accepted offer.
- The feature is opt-in: `FOLLOWUPS=on` adds the tools and the new wording. Without it the prompt and tools are exactly what they were, so deploying the code changes nothing until the table exists and the switch is set.

## Tests

New scenarios for `scripts/test-buddy.js`:

- A specific miss gets the offer; a broad miss does not.
- Yes creates one follow-up and the reply uses the tool's promise wording; "no thanks" creates nothing.
- A third request while two are open is refused, and the reply makes no promise.
- "I need it tonight" gets no offer.
- A reply to a sent follow-up is answered from the follow-up's facts.
- FORGET removes follow-ups; STOP cancels them.

These are in `scripts/scenarios-followups.json` (run with `FOLLOWUPS=on SCENARIOS=scripts/scenarios-followups.json`). The offline test is `node scripts/test-followups.js`, in the style of `scripts/test-deals.js`: consent check, cap, quiet hours, opted-out skip, no double send, FORGET and STOP.

## What to measure

- Share of honest misses that get an offer, and share of offers accepted.
- Share of follow-ups answered rather than closed honestly.
- Share texted by the promised time. The target is all of them.
- Replies within 24 hours of a follow-up.
- Guardrail: STOPs within 24 hours of a follow-up.

## Build order

1. **The loop, by hand.** Table, the two tools, prompt change, context lines, `scripts/followups.js`, `/api/followup`, tests. You or a session do the research. This alone makes the promise real.
2. **The routine.** `exit163-followups-am` and `-pm` do the research and drafts; the email digest arrives; you approve. Built 2026-11-13.
3. **Less waiting.** A one-tap approve page (opened from the email, with a Send button rather than a link that sends, since mail scanners follow links), and a server-side research job for when the Mac is off.
4. **Automatic sending** for answers that meet the source bar, once the approval history shows the drafts are reliable.

## Not in this spec

Standing watches, calling venues, ticket on-sale alerts, and merging duplicate questions.
