export type FailureClassification =
  | "expired_blockhash"
  | "fee_too_low"
  | "compute_exceeded"
  | "bundle_failure"
  | "unknown"

export interface FailureDetails {
  classification: FailureClassification
  originalError: string
  slot?: number
}
