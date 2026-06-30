export interface EvidenceRow {
  bundleId: string
  signatures: string[]
  tipLamports: number
  tipAccount: string
  attempt: number
  stages: {
    submitted: { slot: number; ts: string } | null
    processed: { slot: number; ts: string } | null
    confirmed: { slot: number; ts: string } | null
    finalized: { slot: number; ts: string } | null
  }
  deltasMs: {
    submitted_to_processed: number | null
    processed_to_confirmed: number | null
    confirmed_to_finalized: number | null
  }
  failure: string | null
  failureClass: string | null
  confirmedVia: "stream" | "rpc" | "jito"
  agentDecision: AgentDecisionSnapshot | null
  route: string
  previousHash: string
  hash: string
}

export interface AgentDecisionSnapshot {
  traceId: string
  timestamp: string
  observation: Record<string, unknown>
  action: string
  reasoning: string
  guardrailAction: "accepted" | "re_prompted" | "rejected"
  confidence: number
  promptSha256: string
  observationSha256: string
  engine: string
  fallbackUsed: boolean
}

export interface EvidenceManifest {
  artifactPath: string
  rowCount: number
  runIds: string[]
  utcWindow: { start: string; end: string }
  routes: string[]
  clusters: string[]
  liveJitoSubmissions: number
  streamProvenLandings: number
  failures: number
  failureModes: string[]
  tipRange: { min: number; max: number }
  hashChainHead: string
  sourceSha256: string
  readiness: "ready" | "not_ready"
  readinessReasons: string[]
  runSummary: Record<string, { total: number; landed: number; failed: number }>
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  rowCount: number
  streamProvenLandings: number
  tipSources: Map<string, string>
}

export interface ReadinessCheck {
  passed: boolean
  reasons: string[]
}
