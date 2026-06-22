# Mission

## Project Name: **Valence**

> A smart transaction stack that makes Solana value transfer reliable, transparent, and effortless for everyday users.

## What this is

A submission for the Solana "Smart Transaction Stack" bounty (Nigeria region,
deadline June 29, 2026). The bounty asks for a production-style system that
observes Solana's network in real time, submits transactions via Jito bundles,
tracks them across commitment levels, and hands one real operational decision
to an AI agent.

Valence's AI agent acts as a **Personal Transaction Concierge** — owning the
full lifecycle of every transaction so the user just says "send X to Y" and
the stack handles the rest. The agent observes the network in real time,
chooses submission strategies, tracks every commitment stage, detects failures,
reasons about causes, and retries with fresh parameters autonomously.

This document exists so every later implementation choice can be traced back
to a reason. If a future phase wants to deviate from something written here,
that's a signal to come back and update this file first, not to drift quietly.

## Locked decisions

These were made deliberately, after research, and should not be silently
reversed mid-build.

| Decision | Choice | Why |
|---|---|---|
| Network | **Mainnet only**, real bundles, tiny real tips (~0.00005 SOL range) | The bounty explicitly says judges will cross-reference slot numbers on a Solana explorer. Jito's Block Engine is unreliable on Solana devnet, and Yellowstone gRPC is mainnet-only on essentially every provider (Solinfra included). Testnet Block Engine bundles wouldn't appear on a mainnet explorer, so they can't satisfy the verification requirement. Mainnet is the only path that produces explorer-verifiable proof. The financial exposure is bounded and small by design (see Risk section). |
| AI agent mode | **Tip Intelligence** | Of the four modes the bounty allows (Failure Reasoning, Tip Intelligence, Submission Timing, Autonomous Retry with Fault Injection), Tip Intelligence has the clearest, most measurable "real decision": given live tip-floor percentile data and current slot/leader conditions, decide a tip in lamports, with visible reasoning, balancing cost against landing probability. It's also the mode most naturally backed by a real public data feed (`bundles.jito.wtf/api/v1/bundles/tip_floor`), which keeps the agent's input grounded in real data rather than synthetic state. |
| Core stack language | **TypeScript / Node.js** | Richest available SDK coverage for both Jito (`jito-ts`, `jito-js-rpc`) and Yellowstone (`@triton-one/yellowstone-grpc`), fastest path to a working system inside the bounty's timeline. |
| Agent runtime | **Groq** (OpenAI-compatible tool-use API) | The tip decision sits in the hot path between "bundle is assembled" and "bundle is submitted." Groq's inference latency is the deciding factor over OpenRouter's broader model selection, since an agent call that's slow enough to miss the leader window defeats the purpose of having an agent make the decision live rather than precomputing it. |

## Why "infrastructure-heavy" is the actual brief

The bounty's own framing matters: it is not asking for a trading bot, it's
asking for evidence that the builder understands the *lifecycle* — leader
scheduling, TPU ingestion, shred propagation, commitment progression — and
can build software that reacts correctly to that lifecycle under real
conditions, including failure. The AI agent is one small, well-scoped piece
inside a larger system, not the centerpiece. Scoring weights this directly:
"Does It Work" and "Depth of Integration" together outweigh "AI Demonstration."

This shapes priority order for the whole build: the lifecycle tracker and
failure classifier have to be correct and observable before the agent has
anything meaningful to reason over. An agent making smart tip decisions on
top of a stack that can't reliably tell the difference between "processed"
and "confirmed" would be building on sand.

## Design Principles

- **Consumer-first** — the system exists so an end user never thinks about
  blockhashes, commitment levels, or tip auctions
- **Observable** — every decision the AI agent makes is logged with its
  reasoning visible
- **Dynamic, not hardcoded** — no hardcoded tips, no static retry intervals,
  no fixed submission paths
- **Real infrastructure** — runs against live Yellowstone gRPC streams, real
  Jito block engines, actual Solana mainnet
- **Failure is a feature** — we simulate failures to demonstrate recovery,
  not just show happy paths

## Scope boundaries (MVP)

In scope:
- Live slot + leader monitoring via Yellowstone gRPC (mainnet)
- Jito bundle construction and submission (mainnet Block Engine)
- Dynamic tip calculation seeded by real tip-floor percentile data
- Full lifecycle tracking: submitted → processed → confirmed → finalized,
  with timestamps, slot numbers, and latency deltas between stages
- Failure classification: expired blockhash, fee too low, compute exceeded,
  bundle failure (not landed / dropped by auction)
- Automatic retry, including blockhash refresh on expiry
- One AI agent (Tip Intelligence) making a real, visible-reasoning decision
  on tip amount per bundle, using live tip-floor data and slot/leader state
- A lifecycle log of ≥10 real bundle submissions including ≥2 failures
- A public architecture document (separate from the repo)
- A README answering the three required operational questions from real
  observed behavior, not textbook answers

Out of scope for MVP (explicitly deferred, not forgotten):
- Multiple simultaneous AI agent modes (only Tip Intelligence ships)
- ShredStream integration (lower latency block data — nice-to-have, not
  required by the bounty text)
- BAM-specific integration (BAM is Jito's newer architecture; the existing
  Block Engine API — sendBundle, getTipAccounts, tip_floor — is still the
  documented, supported path and is what this submission targets)
- A UI/dashboard beyond what's needed to produce and present the lifecycle
  log (this is an infrastructure bounty, not a frontend bounty)
- Multi-wallet / multi-strategy support

## Risk and cost posture

This is real mainnet money, intentionally kept small:
- Tips are calculated dynamically from live percentile data but the system
  enforces a hard ceiling per bundle to bound worst-case spend across all
  ~10+ submissions in the log.
- At least 2 of the logged submissions are expected/designed failures
  (e.g. an intentionally expired blockhash), not accidents — these are part
  of satisfying the "failure cases" requirement and double as proof the
  failure classifier actually works.
- A funded wallet with a known, small balance is used for the entire run;
  no production funds, no shared/multi-purpose wallet.

## Key Differentiator

Most Solana infrastructure projects target searchers and MEV bots. Valence
targets the **end user** — wrapping the same Jito/Yellowstone/AI tools into a
consumer-grade experience where the AI agent is the invisible concierge, not
the visible trader. Every decision in this stack (mainnet, Tip Intelligence
mode, TypeScript, Groq runtime) is chosen to serve that end-user outcome, not
architecture for architecture's sake.

## Definition of done for the bounty submission

1. A working TypeScript stack that streams live slot/leader data, builds and
   submits real Jito bundles on mainnet, and tracks every bundle through all
   four commitment stages with timestamps and slot numbers.
2. A tip-floor-driven, agent-decided tip per bundle, with the agent's
   reasoning captured and shown (not just the final number).
3. At least one real, intentionally-triggered failure (blockhash expiry) that
   the system detects, classifies, and recovers from automatically, with the
   retry decision coming from the agent rather than a hardcoded branch.
4. A lifecycle log (JSON or similar) of ≥10 real bundle submissions, ≥2 of
   them failures, each with slot numbers, commitment progression, timestamps,
   tip amounts, and failure classification where relevant.
5. A public architecture document (Notion/Google Docs/Figma/any public URL)
   covering architecture, data flow, infra decisions, failure handling, and
   the agent's responsibilities, with diagrams.
6. A README that answers the three required questions using observations
   pulled from this specific system's actual run, plus setup instructions
   and an explanation of tradeoffs made.
7. Open-source repo, clear setup instructions, working on mainnet as
   described above.
