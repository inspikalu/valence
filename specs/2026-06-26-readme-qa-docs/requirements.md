# Requirements — README Q&A, Architecture Doc, Final Pass

## Feature: Readme QA + Docs + Final Pass (Phases 13–15)

Bundles the three remaining roadmap phases into one sequenced work package
because they share a single dependency: the Phase 12 live mainnet log.

---

## Scope

### Phase 13 — README Q&A from real observations

Three questions the README must answer using data from the Phase 12 lifecycle
log, not generic textbook answers:

1. **Processed → confirmed delta**  
   *Question*: What was the time from "processed" to "confirmed" for the
   bundle(s) that landed?  
   *Answer*: Pull the actual timestamps from the log, compute the delta in ms,
   and note any variance across submissions.

2. **Readiness check before a mainnet transaction**  
   *Question*: What do you check before submitting a transaction to mainnet?  
   *Answer*: Describe the pre-flight checks — balance sufficiency, blockhash
   freshness, compute budget estimation, tip-floor sanity, simulation.

3. **Finalized-commitment blockhash tradeoff**  
   *Question*: Why would you never use a finalized-commitment blockhash for a
   time-sensitive transaction?  
   *Answer*: Explain that a finalized blockhash is already ~60-90s old relative
   to the current slot, increasing expiry risk before the bundle lands. Cite
   the intentional-expiry failure from Phase 12 as concrete evidence.

Additional README sections:
- **Setup instructions** — clone, install, configure `.env`, run (covers
  Phase 15's requirement for clean-clone verifiability).
- **Tradeoffs** — decisions explained: mainnet only, Tip Intelligence mode,
  TypeScript, Groq, no BAM, no ShredStream, etc.
- **Lessons learned** — what went wrong, what surprised, what would change.

### Phase 14 — Architecture document

A public document (Google Docs / Notion) covering:

- System architecture overview with block diagram
- Component responsibilities (Yellowstone stream, Jito bundle pipeline,
  lifecycle tracker, failure classifier, retry loop, Groq agent)
- Data flow: slot observation → leader detection → bundle assembly →
  submission → tracking → classification → retry
- Infrastructure decisions with rationale (mainnet, Groq, TypeScript, etc.)
- Failure handling strategy (intentional expiry, retry with agent reasoning)
- AI agent responsibilities and guardrails
- Sequence diagram: bundle lifecycle from submission to finalized,
  including the failure/retry branch

Hosted at a public URL with no auth required. Linked from the README.

### Phase 15 — Final pass

- Secrets archaeology: confirm no private keys, API tokens, or `.env` values
  are committed anywhere (including git history).
- Verify `.gitignore` covers all sensitive paths (`node_modules/`, `dist/`,
  `.env`, `logs/`).
- Confirm cleanup instructions work from a clean clone.
- Link the architecture doc from the README.
- Confirm the lifecycle log file (from Phase 12) is included in the repo.
- Final review pass: read the entire repo once from a fresh perspective as
  if you were a judge.

---

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Phase ordering | 13 → 14 → 15 sequentially | Each depends on the previous (log → README → arch doc → final pass) |
| Data source for README | Phase 12 lifecycle log (`lifecycle/log.jsonl`) | Bounty requires "real observations, not textbook answers" |
| Placeholder strategy | `{{PLACEHOLDER}}` tokens in README | Fill in concrete numbers after live mainnet run; merge structure now |
| Architecture doc format | Google Docs (public, no auth) | Per bounty requirements; easy to embed diagrams |
| Secrets archaeology | Full `git log --all -p` scan + `.env` check | Prevent disqualification from committed credentials |

---

## Out of scope

- Additional AI agent modes (only Tip Intelligence ships)
- Dashboard or UI (infrastructure bounty)
- Multi-wallet support
- BAM-specific integration
