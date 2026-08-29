# TODO — kayla-portfolio

Open work and ideas, in rough priority order. Dated so stale items are obvious.
Keep entries short; the *why* matters more than the *how*.

## Ideas — Jason, 2026-08-28

### A. Opportunity calendar — weekly agent that finds shows, competitions, grants
- A scheduled agent (Claude Code **scheduled routine** on Jason's Claude
  subscription — see the `schedule` skill — using web search) runs weekly:
  searches for art exhibitions/open calls, competitions, residencies and
  grants Kayla qualifies for (painter, RISD grad, Houston-born, Seattle-based;
  criteria kept in a small JSON/MD profile it reads), de-dupes against what
  it has already found, and **adds each opportunity to a Google Calendar**
  (deadline as the event, details/link in the description). Google Calendar
  + Gmail connectors are available to Claude Code.
- **Email notifications** to Kayla when something is coming up (e.g. 14 and
  3 days before a deadline) — the routine can send via Gmail, or a calendar
  reminder does it for free.
- Output should be a short digest, not a firehose: top 5 new items per week
  with a one-line "why this fits" and the deadline. A "not interested"
  list keeps rejected items from resurfacing.

### B. Art-job watcher — remote or Seattle
- Same mechanism, daily or every few days: search for remote or Seattle-area
  art jobs (teaching artist, gallery, museum, illustration, muralist,
  design-adjacent — profile-driven), remember what's been seen, and **email
  Kayla only when a new one appears** (title, employer, pay if listed, link,
  why it matches). Weekly zero-new weeks send nothing.
- Both A and B: the agent processes the search results with Claude (fit
  scoring, summarizing) — that is the point of running it as a Claude
  routine rather than a plain RSS/keyword alert.
- Start with A (higher value, lower noise); B reuses the same scaffolding.

## Done

- 2026-08-28 — Forms made honest: inquiry + newsletter posts relay through the
  Worker (`/forms/*`), KV copy first, real `{ ok }`, honeypot + privacy line,
  email/phone validation on both ends. New admin **Inquiries** tab (sources:
  original / contact page / other; to-do/done/delete; reply-by-email with editable
  templates) + a contact-page message form. Worker now emails Kayla about every
  inquiry at kaylacarabesart@gmail.com. SPF `-all` + DMARC `p=reject` in DNS.

- 2026-08 — Polisite platform adopted this repo's SEO markers, image
  pipeline, optimistic-lock admin and IndexedDB drafts (nothing to port
  back; this site was the source).
