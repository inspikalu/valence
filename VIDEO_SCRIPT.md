# Valence — Video Walkthrough Script (~4 min)

## 1. Intro (30s)

**Visual:** Terminal window, `npx tsx src/index.ts` running. Wallet pubkey and balance on screen.

**Narration:**
"This is Valence — a smart transaction stack that makes Solana value transfer reliable, transparent, and effortless. It observes the network in real time, submits Jito bundles with AI-decided tips, and tracks every stage from submission to finalization."

---

## 2. What it does (45s)

**Visual:** Scroll through src/ directory tree. Highlight index.ts, jito/, lifecycle/, agent/.

**Narration:**
"Three core components. First, a Yellowstone gRPC connection streams live slots and transactions — so we see the network as it happens. Second, a Jito bundle pipeline builds and submits transactions, with automatic fallback from sendBundle to sendTransaction. Third, a lifecycle tracker persists every submission to a JSONL log with slot numbers, timestamps, tip amounts, and the AI's reasoning."

---

## 3. The AI agent (45s)

**Visual:** Show src/agent/groqClient.ts briefly. Then show console output with agent reasoning.

**Narration:**
"Every tip is decided by a Groq-hosted AI agent. It receives the current tip-floor percentiles — p25, p50, p75, p95, p99, plus an exponential moving average — along with the leader identity. It reasons over this data and returns a structured decision. Here's a real output: the agent saw p50 at 9838 lamports and chose 7500, with a sentence explaining why."

**Show on screen:**
```
[agent] decided tip=7500 reasoning="Given the current p50/p75 percentiles (9838/19256)..."
```

---

## 4. Failure injection + retry (45s)

**Visual:** Show .env with VOLUME_COUNT=10, then the volume run output with failure modes.

**Narration:**
"Valence includes a volume-run mode that cycles through four failure modes — clean, expiry using a stale blockhash, low tip, and compute-unit exhaustion. Each mode is injected before bundle construction. Failures are caught, classified, logged, and the loop continues. The lifecycle log captures both successes and failures with full traceability."

**Show on screen:**
```
[volume] submission 3/5 — mode: low_tip
[volume] injection low_tip failure — setting tip to 1 lamport
[volume] submission 3 threw: "Bundle must tip at least 1000 lamports"
```

---

## 5. On-chain verification (30s)

**Visual:** Show RPC query result verifying the transaction on-chain.

**Narration:**
"Every submission is verifiable on-chain. Here I query the RPC for a landed transaction — slot 429025726, wallet balance changed by exactly the fee plus the tip, and the tip account received 7500 lamports."

**Show on screen:**
```
Account[0] 212mx... changed by -12500 lamports
Account[1] DfXyg... changed by +7500 lamports
Fee: 5000 lamports
```

---

## 6. Wrap-up (25s)

**Visual:** Show README.md architecture section, lifecycle log file, and the GitHub repo.

**Narration:**
"The full architecture is documented in ARCHITECTURE.md — component responsibilities, sequence diagrams, and infrastructure decisions. The lifecycle log at src/lifecycle/log.jsonl contains every submission with slot numbers, timestamps, tip amounts, agent reasoning, and failure classification. All checks pass, no secrets leaked, everything reproducible from the README."

```
npm run typecheck && npm run build && npm test — 162/162 ✓
```

"That's Valence. Smart transactions, transparent tracking, AI-powered. Thanks for watching."
