# Follow-up research routine

For the scheduled tasks `exit163-followups-am` (10:30am) and `exit163-followups-pm` (5:00pm), and for anyone doing the same job by hand. Background: `research/FOLLOWUP-SPEC.md`.

## What this is

Exit163 is a text line for things to do in Bergen County, NJ. When the buddy can't answer a specific question, it may offer "Want me to find out and text you back?" If the person says yes, they are promised a text "by tomorrow night" (8pm NJ the next day). Your job is the finding out: research each open question, and save a draft answer for Joe to approve. Joe approves and sends. You never do.

A promise is on the line for every question here. A wrong answer texted on our own initiative costs more trust than a slow one, which is why the source bar below is strict and why nothing goes out without Joe.

## Hard rules

- **Never text anyone, never approve, never send.** Do not run the `approve`, `reject` or `send` commands of `scripts/followups.js`, and do not call `/api/followup` or `/api/blast`. The only database write you make is the `draft` command.
- **You don't know who asked, and you don't look.** The questions come without a phone number or a name on purpose. Don't query `followups`, `sms_users` or `sms_messages` directly.
- **Read only on the web.** No logging in, signing up, following, liking, commenting, posting, messaging or filling in forms. If Chrome is connected and already signed in to Facebook or Instagram, you may read a public page or event there. If it asks you to sign in, skip that source.
- **Never invent anything.** Every fact in a draft must be on the source page you loaded in this run.
- **Don't commit, push or deploy**, and don't edit code. In the project you write only inside `research/followups/`. Temporary files go outside the project: your scratchpad directory if you were given one, otherwise a folder from `mktemp -d`.
- If a tool call is **refused for permission** (denied, blocked by a classifier, not allowed), don't try another route to the same thing. Say so in your summary. A page that fails to load, times out or returns 404 is different: retry once or move on to another source.

## Steps

Work in `/Users/noahajeo/Projects/Exit 163/site`.

### 1. Get the open questions

```bash
node --env-file=.env.local scripts/followups.js research
```

It prints a JSON list, soonest promise first. Each item has:

- `id`, `question`, `town_slug`, `category`
- `needed_by`: the day the answer stops being useful, if known
- `promised_by`: when the person was told they'd hear back
- `late`: the promise has already passed
- `last_call`: no later run fits before the promise is due (in practice, the 5pm run on the due date). This run is the person's last chance at a real answer.
- `sources`: pages from our source registry that might hold the answer. They are leads. Check only the ones that could plausibly state this fact, the organizer's own page first, and skip the rest.

If the list is empty (`[]`), skip to step 5.

Take at most six questions in one run, soonest promise first, and spend at most about 15 minutes on each. Name any you didn't reach in your summary.

A question comes back to this list if Joe rejects its draft. `research/followups/notes-<id>.md` then says what the earlier run did, so read it first when it exists.

### 2. Research each question

Look in this order, and stop as soon as something meets the bar:

1. **Our own database.** A newer harvest may already hold the answer. `node --env-file=.env.local scripts/eval-lookup.js "winter wonderland"` prints matching upcoming events and places, read-only. It matches rows containing any one of the words you give, so more words means more rows, not fewer: use one distinctive word or one quoted phrase. A row is a lead, not proof: open the `source:` link printed with it and confirm the fact there.
2. **The organizer's own pages.** Start from the plausible `sources`. Town calendars on CivicPlus (`/calendar.aspx`) show only the current month, so ask for the month you need: `/calendar.aspx?view=list&year=2026&month=12`, using the month of `needed_by`. Each `sources` entry may carry `notes` on how that page behaves. `js_heavy` pages need `firecrawl scrape <url>`: run it from your temporary folder, not the project, and use at most 10 Firecrawl credits per run. `login_required` pages only through Chrome as described above.
3. **The web.** Search for the event, venue or organizer by name with the town and "NJ", then go to the organizer's own page or the official ticket page. Ticket pages are often an embedded widget (Eventbrite and the like) that a summary of the page won't show; look for the ticket link in the page itself. `research/sources/REGISTRY.json` has `search_recipes` that work well for Bergen towns.

**Read the page's real words before you rely on them.** A web fetch tool usually returns a summary written by another model, and it can paraphrase or leave things out. Before a fact goes into a draft, read it in the page text itself: `curl -sL <url>` (a plain read-only GET; add `--http1.1` if it fails with a protocol error) or `firecrawl scrape`, saved to your temporary folder.

**The bar for an answer.** All of these hold:

- The fact is stated on the venue's or organizer's own page (their site, their official Facebook or Instagram, the borough's site for a borough event) or on the official ticket page.
- You loaded that page in this run and read the fact in its own words.
- The page is about this season: it names the date or the year (2026, or 2026/27 for a winter season).

These are leads, not answers: an aggregator, a news roundup, a search snippet, last year's page or flyer, a comment under a post, and an undated page (an FAQ with no year on it, even on the organizer's own site, when the same site still shows last season's material). If two official pages disagree, that is not an answer either: put it in your notes.

### 3. Decide: draft now, or leave it open

Every question has a main thing being asked ("is Santa there on Dec 12?", "where does it move if it rains?").

- **The main thing is answered and meets the bar:** draft it now (step 3a).
- **Only a side detail is answered, or nothing is, and `last_call` is false:** leave it open. A draft takes the question off this list, so later runs would stop looking. Record what you found in the notes file (step 4).
- **`last_call` or `late` is true:** the person must hear back from this run. Draft whatever you can stand behind (step 3a): the parts that meet the bar, then plainly what isn't posted. If nothing meets the bar, draft an honest close (step 3b). On this run only, you may include a fact from an undated page on the organizer's own site if you say so ("their FAQ says ..., though it isn't dated for this year").

#### 3a. An answer

Write the text the person will get, in the buddy's voice:

- Plain text. No markdown, no asterisks, no headers. Under 450 characters (the command refuses anything over 750).
- Open by tying it to what they asked: "Found out: ..."
- Like a friend texting: short sentences, contractions, warm. Give the answer first, then the details that matter and that the page states: day, time, place, cost, and any requirement (registration, residents only, rain plan).
- Only facts you read on the source page. Say plainly what isn't posted.
- A link only if they need it to book or register, and then the shortest one that works. At most one emoji. Don't end with a question, don't add a deal or a plug, and don't say where you looked.
- Write "Exit163" as one word if you name it at all (you rarely need to).

Put the text in a file in your temporary folder and save it:

```bash
node --env-file=.env.local scripts/followups.js draft <id> --answer-file <path to the text file> --source <the page URL>
```

`--source` takes one URL: the page that states the main fact. Other pages go in the notes. Running `draft` again replaces the draft.

Then record what you learned in `research/followups/finds-<today, YYYY-MM-DD>.json`, so the next person who asks gets it straight away:

- The file is an object with `events` and `places` arrays. Take the field list from the "Output" section of `research/BRIEF.md`. Use that file for the format only: its dates, budgets and other rules were written for a different job and don't apply here.
- Record only what the source page states, with that page as `source_url`. If our database already has the event, write your find with the same title, town and start date, so an import updates that row and doesn't add a twin.
- If two official pages differ on a detail, leave the detail out and say so in the notes.
- No find for a question you left open.

Create the file if it isn't there, add to it if it is, and check it:

```bash
node --env-file=.env.local scripts/import-research.js research/followups/finds-<today>.json --dry
```

Always with `--dry`: it only validates. Importing for real needs Joe's OK.

#### 3b. An honest close (last call, nothing confirmed)

Say what you looked into, that you couldn't confirm it, and the surest real next step (who would know, or where it would be posted), using only a detail you read on a page in this run. Example: "I dug into the Oradell tree lighting and couldn't confirm a rain plan. The borough hasn't posted one. Borough Hall is the surest bet Saturday morning."

```bash
node --env-file=.env.local scripts/followups.js draft <id> --not-found --answer-file <path to the text file>
```

### 4. Write the notes

For every question you worked on, drafted or not, write or update `research/followups/notes-<id>.md`:

- each page you checked, with its URL, and what it said and didn't say
- leads that didn't meet the bar, and why
- for a draft: any judgment call Joe should know about
- what you'd try next

Keep it short. The next run reads it, and so does Joe if the draft looks off.

### 5. Email Joe and report

```bash
node --env-file=.env.local scripts/followups.js digest --send --note "<one line, only if there is something to add>"
```

Run this every time, even when there were no open questions: drafts from an earlier run may still be waiting on Joe, and the command only sends an email when something needs him. Use `--note` for one thing he should know that the list doesn't show, such as "2 new facts in research/followups/finds-2026-11-14.json, waiting on your OK to import". Leave `--note` off when there is nothing to add.

Finish with a short summary for Joe, leading with what needs him:

- each draft saved: the question, the draft text and its source link
- each honest close, and why nothing could be confirmed
- each question left open, what you checked and what you'd try next
- whether the email went out
- the finds file, if you wrote one
- anything that was refused, failed or didn't get reached

If there was nothing open and nothing waiting, say that in one line and stop.

## Rehearsing

Test questions (channel `test`, never texted) are hidden from the commands above. To practice on them, add `--test` to `research` and `digest`, and leave `--send` off.
