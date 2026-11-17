# Exit 163 conversation scoring rubric (v1, 2026-11-12)

The goal the agent is graded against: **be the number one, personalized source for things to do in
Bergen County.** A subscriber texts a real question; a great answer leaves them with a plan they could
act on tonight, that fits who they are, and that is true.

Grade every **turn**, then every **conversation**, then the **run**.

## What the grader has
- A transcript (`research/eval/runs/*.md`): each turn is `Them:`/`Me:` then the agent's reply, with reply
  time, length, and the tool calls or searches it made. Scripted runs also show `profile after` and
  `facts after` (what the agent saved about the person).
- The agent's rules: `lib/agent.js` (the SYSTEM prompt) and `lib/tools.js` (what the tools can do).
- A read-only lookup of what the database really held:
  `node --env-file=.env.local scripts/eval-lookup.js <word> [more words]` (run from `site/`).
  Use it to tell "we didn't know" from "we knew and the agent missed it", and to check that a named
  place, time or price is real. Never write to the database.

## Step 1. Classify each turn's outcome
Exactly one of:

| outcome | meaning | who fixes it |
| --- | --- | --- |
| `hit` | Gave a specific, true, fitting answer. | nobody |
| `partial` | Something usable, but it misses part of the ask (wrong day, too far, wrong crowd, no time). | depends on why; say why |
| `honest_miss` | Said it doesn't know, and the lookup confirms we had nothing. | **research** (data gap) |
| `followed_up` | An honest miss on something checkable that ended with the person accepting a text back (`follow_up` returned ok). Only with follow-ups on. It still counts as a miss on the ask itself until the answer is sent. | **research**, by the promised time |
| `search_miss` | We had a fitting item and the agent didn't surface it (bad keywords, wrong filters, tool limits, or it saw the item and dismissed it). | **builder** |
| `wrong` | Stated something the database doesn't support, invented a detail, or recommended something that plainly doesn't fit (a kids' pick for adults, a closed place). | **builder**, urgent |
| `handled` | A turn that isn't a recommendation (name, memory, opt-in, business question) and was handled correctly. | nobody |
| `mishandled` | Same kind of turn, handled badly. | **builder** |

## Step 2. Score each conversation, 0 to 4 on each dimension
0 = failed, 1 = poor, 2 = acceptable, 3 = good, 4 = what a well-connected local friend would say.

1. **Usefulness (weight 30).** Could the person act on it? Best pick first, with town, day, time, cost,
   and a link when tickets or reservations are needed. 4 = they have a plan. 0 = they have nothing.
2. **Knowledge (weight 25).** Did we actually know things for this ask? Count the share of turns that
   were `hit`. Many `honest_miss` turns score low here even though the agent behaved well: the product
   failed the person. Note separately whether the miss was data (`honest_miss`) or retrieval (`search_miss`).
3. **Honesty (weight 20).** Every named place, date, time, price and claim is supported by a tool result,
   the weekly issue, or the lookup. Unknowns are flagged ("time's not posted"). Any `wrong` turn caps this
   at 1, and an invented venue or event makes it 0.
4. **Personal fit (weight 15).** Used what it knew: town and drive distance, who they're with, ages,
   tastes, budget, dislikes, constraints stated earlier in the thread. Did not suggest things already
   ruled out. For scripted runs, also check `facts after`: the right facts saved, one per item, nothing
   sensitive (health, religion, money trouble, relationship details beyond who they go out with), no
   kids' names.
5. **Depth (weight 5).** Did follow-ups get new, better answers, or the same two picks again and a
   dead end? Did it offer a sensible next step?
6. **Voice (weight 5).** Reads like a friend texting: plain text, under 750 characters (aim 450), at most
   one emoji, no "database" talk, no markdown, doesn't open two replies the same way, doesn't end every
   message with a question, doesn't oversell the Friday email (once per conversation at most), never
   promises to text later unless the `follow_up` tool returned ok in that turn (with follow-ups off,
   never).

**Conversation score (0-100)** = sum over dimensions of (score / 4 × weight).
Caps: any `wrong` turn caps the conversation at 50. An invented venue or event caps it at 25.

## Step 3. Write issues the fixers can act on
For every turn that isn't `hit` or `handled`, write one issue:
- `owner`: `builder` (prompt, tools, search, memory code) or `research` (we need data or a source).
- `type`: `data_gap` | `search_miss` | `invented` | `bad_fit` | `memory` | `voice` | `tool_limit` | `flow`.
- `evidence`: the user's ask in a few words, what the agent said in a few words, and for `search_miss`
  the lookup line that proves we had it.
- `fix`: the smallest change you believe would fix it. For `data_gap`, name what kind of source would
  have had the answer (e.g. "promoter Instagram accounts for Latin nights in Hackensack").

## Output
Write `research/eval/scores/<run-label>.json`:
```json
{
  "run": "2026-11-12-paces",
  "rubric": "v1",
  "graded_at": "2026-11-12",
  "conversations": [
    {
      "id": "night-out-40s",
      "source_file": "research/eval/runs/....md",
      "turns": [{"n": 1, "ask": "DJ + dancing Saturday, 30s-40s", "outcome": "search_miss", "note": "..."}],
      "scores": {"usefulness": 1, "knowledge": 1, "honesty": 4, "fit": 2, "depth": 1, "voice": 3},
      "score": 41,
      "summary": "One or two sentences."
    }
  ],
  "totals": {
    "conversations": 0, "turns": 0, "mean_score": 0,
    "by_dimension": {"usefulness": 0, "knowledge": 0, "honesty": 0, "fit": 0, "depth": 0, "voice": 0},
    "outcomes": {"hit": 0, "partial": 0, "honest_miss": 0, "followed_up": 0, "search_miss": 0, "wrong": 0, "handled": 0, "mishandled": 0}
  },
  "issues_for_builder": [
    {"rank": 1, "type": "search_miss", "conversations": ["..."], "evidence": "...", "fix": "...", "impact": "how many turns this would have turned into hits"}
  ],
  "gaps_for_research": [
    {"rank": 1, "topic": "DJ and dance nights for 30s-40s", "asked_in": ["..."], "what_we_had": "...", "sources_that_would_help": "..."}
  ]
}
```
Rank `issues_for_builder` and `gaps_for_research` by how many turns each would fix. Check that the
file parses. Then write a short `research/eval/scores/<run-label>.md` a person can read in two minutes:
the mean score, the five best and five worst conversations, and the ranked lists.

## Grading rules
- Grade what the subscriber experienced, not how hard the question was. "We didn't know" is a low
  Knowledge score, with the issue routed to research.
- Don't reward confident answers you can't verify; look them up.
- Be consistent: a re-run after fixes is graded with this same rubric so the scores can be compared.
- You grade. You do not edit the agent, the data or the transcripts.
