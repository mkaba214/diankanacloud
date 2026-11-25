# Diankana Cloud — Ask AI Upgrade: Requirements

Nov 24, 2026 · @Mohamed Kaba

## Overview

This specifies an upgrade to the "Ask" feature on Diankana Cloud (diankanacloud.com), a bilingual FR/EN static site. Today, Ask is a local, client-side BM25 keyword search over `ARTICLES` and Wikipedia data, with no generative AI. This upgrade adds an optional generative layer (RAG) on top of that search: local retrieval stays the primary, free, instant mechanism; a free-tier LLM call synthesizes a natural-language answer from the retrieved passages when available; the system falls back to the existing local search automatically under load, errors, or rate limits, with no visible degradation to the user.

## Current state

- Static site built from a single `index.html`; `npm run build` generates `dist/` (stylesheet, per-page HTML, sitemap, robots.txt); GitHub Actions publishes on every push to `main`.
- "Ask" is implemented by `askBot()`: tokenizes the question, expands synonyms via a `CONCEPTS` table, builds a document pool from `siteDocs()` (passages from `ARTICLES`) plus Wikipedia paragraphs (`data/wikipedia-guinea.*.json`), scores with BM25 (k1=1.4, b=0.7) plus coverage/introduction/year boosts, and shows the best match plus up to two more above 45% of the top score.
- Hidden `ARTICLES` entries (`hidden:true`) are searched but not published as visible articles.
- Firebase is used today only for `firestore.rules` (comments/contact) — no backend or AI functionality currently exists.

## Goals and non-goals

**Goals**

- Add a generative answer on top of existing retrieval, without losing the free/instant local fallback.
- Keep steady-state cost at $0 by staying inside a free-tier LLM API's rate limits.
- Never let a traffic spike or API outage break or visibly degrade the Ask experience.
- Improve answer coverage by expanding `data/` content, not only by adding AI.
- Keep `data/` current through periodic, review-gated web research focused on upcoming developments rather than historical background.

**Non-goals (this iteration)**

- No change to the BM25 scoring/retrieval algorithm itself.
- No paid tier, no self-hosted model, no in-browser (WASM) LLM.
- No chat history or multi-turn conversation — each question is answered independently, as today.

## Functional requirements

1. Local BM25 retrieval runs first and always, exactly as implemented today, with no behavior change.
2. The top 3–5 retrieved passages, plus the user's question and detected language (fr/en), are sent to a new backend endpoint.
3. The backend calls a free-tier LLM API (Groq, recommended) with a prompt instructing it to answer only from the supplied passages, in the same language as the question, and to say when the passages don't contain the answer.
4. If the backend call succeeds within a bounded timeout, its generated answer is shown in `#ask-answer` in place of the raw passage.
5. If the backend is skipped (circuit breaker open), errors, or times out, the client falls back to displaying today's local BM25 result exactly as it does now — no visible error, no broken state.
6. The circuit breaker proactively avoids calling the LLM API when the free-tier rate limit is at risk, rather than waiting for a failed call.

## Architecture and data flow

&#91;embedded content: Ask request flow — local search, AI layer, fallback\]

If the Groq call itself errors or times out after being attempted (not just when the circuit breaker pre-emptively skips it), the same "Show local result" fallback applies — the client never shows a broken or hanging state.

## Backend requirements

- A Firebase Cloud Function (e.g. `askAI`), HTTPS callable or HTTP endpoint.
- **Request**: `{ question: string, lang: "fr"|"en", passages: [{ title: string, text: string }] }` — the top 3–5 passages from client-side BM25.
- **Response**: `{ source: "ai", answer: string }` or `{ source: "local" }` (tells the client to fall back).
- API key stored as a Firebase secret (`firebase functions:secrets:set GROQ_API_KEY`) — never shipped to the client or committed to the repo.
- Timeout budget: the function responds within \~4 seconds total; the client-side timeout is set slightly longer (e.g. 5s).
- **Circuit breaker**: track request count per rolling minute (a Firestore doc, or an in-memory counter if some imprecision across instances is acceptable); if usage is above a configured threshold (e.g. 80% of the free-tier per-minute limit), skip the Groq call and return `{ source: "local" }` immediately, without waiting on a call likely to fail.
- On any Groq error (4xx, 5xx, timeout, network failure), catch it and return `{ source: "local" }` rather than propagating the error to the client.
- No logging of full question text beyond what's needed for debugging; no PII collected or stored.

## Client-side requirements

- `askBot()` keeps computing local BM25 passages first, unconditionally — no change to that path.
- After computing local passages, issue a `fetch` to the Cloud Function with a client-side timeout (e.g. `AbortController` at 5s).
- On a `source: "ai"` response, render the generated answer; on any failure, timeout, or `source: "local"` response, render today's existing passage-based result unchanged.
- Preserve existing bilingual behavior: the detected/selected language is passed through to the backend so the generated answer matches the question's language.
- No new error messages, hanging spinners, or visible indication that the AI path was attempted and skipped — the fallback must be seamless to the user.

## Data requirements

- Run a content gap audit first: compile real questions the target audience (young graduates, IT professionals, IT services in Guinea) would ask; run each through `askBot()` and record which return "Closest passage" / low-confidence results rather than "Answer found in."
- Fill gaps with new `ARTICLES` entries (summary, howto, takeaways, both `fr` and `en`) rather than more Wikipedia content; use `hidden: true` for FAQ-style entries not meant to be published as visible articles.
- Add topic-specific data files (same paragraph/section JSON structure as `wikipedia-guinea.*.json`) for subjects deep enough to warrant their own file, and extend `docs = siteDocs().concat(...)` to include them.
- Add a build-time validation step in `scripts/build.mjs` that fails the build if any `ARTICLES` entry is missing a required field (non-empty `fr`/`en` text for summary, howto, takeaways) or has a duplicate `id`.
- Re-run the gap-question list after each content addition to confirm coverage actually improved.
- **Archives rubric**: any article older than 30 days (by its `date` field) is moved into a new "Archives" rubric — e.g. an `archived: true` flag on its `ARTICLES` entry, surfaced through a dedicated `/archives` section or page — rather than remaining listed among current articles. Archived entries stay in the Ask search index (`siteDocs()` keeps indexing them), so they're still searchable; they're simply no longer presented as current/recent content on the site.

## Automated web content refresh

- A scheduled job (e.g. GitHub Actions cron) runs every 2–3 days and checks for new articles published that same day on Guinea's major topics (mining, oil and gas, economy, politics, tech/IT — the domains the site already covers).
- Retrieves 3–4 candidate articles per run, and only when genuinely new same-day content exists; if nothing new is found, the run produces nothing rather than padding with older or repeated material.
- Deduplicates against existing `ARTICLES` entries and `data/` files by topic/title before treating a result as "new."
- **Focus going forward**: upcoming developments and what is changing or expected to happen, not historical or background facts — the existing Wikipedia data and `ARTICLES` content already cover the historical baseline.
- **Never auto-publishes.** Each run writes candidate entries to a staging location (e.g. a `data/staging/` file, or a draft PR) for Mo to review, edit, and approve; nothing reaches `ARTICLES` or a published `data/` file without that manual review. **Notification**: the moment candidates are staged, Mo is notified (e.g. the draft PR itself, which GitHub already notifies on, or an email sent by the job) so a pending review is never missed between runs.

## Non-functional requirements

- **Cost**: $0 at expected traffic; the circuit breaker must keep the system inside the LLM provider's free tier under normal and spiked conditions.
- **Latency**: the local fallback remains instant (<100ms, unchanged); AI-assisted answers should typically return within 1–2 seconds, with a hard ceiling of \~5 seconds before falling back.
- **Privacy**: no PII is sent to the LLM provider beyond the question text and retrieved passage text (already-public site content).
- **Bilingual parity**: both the fr and en paths support the AI layer and the fallback identically.

## Security requirements

**Website**

- All traffic is served over HTTPS only (GitHub Pages default); no mixed-content resources.
- The Ask question field, and any AI-generated text rendered into `#ask-answer`, are treated as untrusted and escaped before display — no raw HTML or script execution from a crafted question or a generated answer.
- Dependencies (`package.json`) are kept current; `npm audit` (or equivalent) runs as part of the build and fails it on a known high/critical vulnerability.
- `firestore.rules` keeps comment/contact write access scoped to only what's needed — never an open read/write rule.

**Data**

- The Groq API key and any other secret live only as a Firebase secret (per Backend requirements) — this is the umbrella policy that rule falls under, never duplicated or loosened elsewhere.
- Content fetched by the automated web-refresh job is treated as untrusted until reviewed: no script tags, embedded HTML, or other executable content from a scraped source is ever written into `ARTICLES` or a `data/` file without first passing the human review step.
- No PII is collected, logged, or stored anywhere in the pipeline (consistent with the existing Backend and Non-functional requirements).

**Infrastructure**

- Abuse-focused rate limiting on the Cloud Function, distinct from the cost-focused circuit breaker: caps requests per IP/session so the endpoint can't be used as a free-standing spam or denial-of-service vector.
- Firebase project access (console, secrets, deploy permissions) is restricted to Mo's account(s) only, with least-privilege access if collaborators are ever added.
- GitHub Actions workflows pin third-party actions to a specific commit or version (never a floating tag) and scope repository secrets to only the jobs that need them.
- `main` stays protected: the automated web-refresh job and any human contributor go through a PR/review path, never a direct push — consistent with the "never auto-publishes" rule already in the Automated web content refresh section.

## Acceptance criteria

- [ ] Asking a question under normal traffic returns an AI-synthesized answer grounded in retrieved passages, in the question's language.
- [ ] Simulating a rate-limit / circuit-breaker-open condition shows the existing local BM25 result, with no visible error or delay beyond the timeout.
- [ ] Simulating a Groq API failure (e.g. invalid key) falls back to the local result seamlessly.
- [ ] No API key or secret appears in any client-side file or in the public repo.
- [ ] The gap-question list shows improved "Answer found in" coverage after new `ARTICLES`/data file additions.
- [ ] The build fails if a new `ARTICLES` entry is missing a required field.
- [ ] The scheduled web-refresh job runs every 2–3 days and retrieves 3–4 new candidate articles only when genuine same-day content exists on major Guinea topics.
- [ ] No scheduled run publishes directly — all candidates are staged for review and require manual approval before going live.
- [ ] An article older than 30 days is automatically moved into the Archives rubric and no longer appears among current/recent articles, while remaining searchable via Ask.
- [ ] When a run stages new candidate articles, Mo receives a notification (PR, email) the same run, not just a silent file write.
- [ ] A request to the Cloud Function is rejected or throttled once a per-IP/session abuse threshold is hit, independent of the cost circuit breaker.
- [ ] `npm audit` (or equivalent) runs in CI and fails the build on a high/critical vulnerability.
- [ ] Scraped candidate content is sanitized and stripped of executable content before it ever reaches the staging location, prior to human review.

## Out of scope

- Multi-turn conversation or chat history.
- Paid tier or usage beyond the free API tier.
- In-browser / WASM local model.
- Redesigning the BM25 scoring algorithm itself.
