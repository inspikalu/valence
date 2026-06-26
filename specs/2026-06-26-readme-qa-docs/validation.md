# Validation — README Q&A, Architecture Doc, Final Pass

## How to verify Phase 13

### README Q&As

- **Q1 answer** includes at least one concrete `{{PROCESSED_TO_CONFIRMED_MS}}`
  number (or real value after live run), with source attribution to the
  lifecycle log line.
- **Q2 answer** lists ≥4 pre-flight checks, each with a rationale and
  ideally a console-log snippet from a real run.
- **Q3 answer** explains the finalized-commitment blockhash tradeoff and
  cites the intentional-expiry failure entry from the log.

### README completeness

- Setup instructions work from a clean clone: `git clone`, `npm install`,
  configure `.env`, `npm start` runs without unhandled errors.
- All `{{PLACEHOLDER}}` tokens are either replaced with real values or
  clearly marked as "replace me after live run."
- Tradeoffs and lessons learned sections are substantive (≥3 entries each).

### Architecture document

- Public URL is accessible with no auth.
- Contains ≥1 system overview diagram (block diagram).
- Contains ≥1 sequence diagram (bundle lifecycle).
- Describes every component in the system.
- Linked from `README.md`.

### Secrets archaeology pass

- `git log --all -p -S "PRIVATE_KEY"` — 0 results.
- `git log --all -p -S "gsk_"` — 0 results.
- `.gitignore` covers all sensitive paths.
- `.env` is not tracked by git.

### Final review pass

- `npm run typecheck` — exits 0.
- `npm run build` — exits 0.
- `npm test` — all tests pass.
- Lifecycle log file is present and contains ≥10 entries.
- Architecture doc link in README resolves.

---

## Acceptance checklist

| Check | How | Pass/Fail |
|---|---|---|
| Three Q&As answered with real data | Read `README.md` | {{TODO}} |
| Setup instructions work from clean clone | `cd /tmp && git clone ... && npm install && ...` | {{TODO}} |
| Architecture doc at public URL | Click link in README | {{TODO}} |
| Block diagram present | View doc | {{TODO}} |
| Sequence diagram present | View doc | {{TODO}} |
| No secrets in git history | `git log --all -p -S "PRIVATE_KEY"` | {{TODO}} |
| No secrets in git history | `git log --all -p -S "gsk_"` | {{TODO}} |
| `.gitignore` covers sensitive paths | Inspect `.gitignore` | {{TODO}} |
| Typecheck passes | `npm run typecheck` | {{TODO}} |
| Build passes | `npm run build` | {{TODO}} |
| All tests pass | `npm test` | {{TODO}} |
| Lifecycle log present | `ls lifecycle/log.jsonl` | {{TODO}} |
| Lifecycle log has ≥10 entries | `wc -l lifecycle/log.jsonl` | {{TODO}} |
| Roadmap ticked | `specs/roadmap.md` Phase 13-15 | {{TODO}} |

---

## Integration test

A dry-run validation script (`script: "npm run validate:final"`) that:

1. Runs `tsc --noEmit` (typecheck)
2. Runs `vitest run` (all tests)
3. Checks `lifecycle/log.jsonl` exists and has ≥10 lines
4. Checks README contains no bare `{{PLACEHOLDER}}` tokens
5. Exits 0 only if all pass

This script serves as the final gate before submission — if it passes, the
repo is ready to submit.

(Add to `package.json` scripts once Phase 12 live run is complete and
placeholders are replaced.)
