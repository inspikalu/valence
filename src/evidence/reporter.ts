import { readFile } from "node:fs/promises"
import type { EvidenceRow, EvidenceManifest } from "./types.js"
import { computeSourceHash } from "./validator.js"

export async function generateReport(logPath: string): Promise<{ manifest: EvidenceManifest; markdown: string }> {
  const raw = await readFile(logPath, "utf-8")
  const lines = raw.trim().split("\n").filter(Boolean)
  const rows: EvidenceRow[] = lines.map((l) => JSON.parse(l))

  const runIds = [...new Set(rows.map((r) => r.bundleId.split("-").slice(0, 1).join("")))]
  const timestamps = rows.map((r) => r.stages?.submitted?.ts ?? "").filter(Boolean).sort()
  const failures = rows.filter((r) => r.failure !== null)
  const failureModes = [...new Set(failures.map((r) => r.failureClass).filter(Boolean))] as string[]
  const landed = rows.filter((r) => r.stages?.confirmed !== null)
  const tips = rows.map((r) => r.tipLamports).filter((t): t is number => t > 0)
  const routes = [...new Set(rows.map((r) => r.route).filter(Boolean))]

  const manifest: EvidenceManifest = {
    artifactPath: logPath,
    rowCount: rows.length,
    runIds,
    utcWindow: {
      start: timestamps[0] ?? "",
      end: timestamps[timestamps.length - 1] ?? "",
    },
    routes,
    clusters: ["mainnet-beta"],
    liveJitoSubmissions: rows.length,
    streamProvenLandings: rows.filter((r) => r.confirmedVia === "stream").length,
    failures: failures.length,
    failureModes,
    tipRange: {
      min: tips.length > 0 ? Math.min(...tips) : 0,
      max: tips.length > 0 ? Math.max(...tips) : 0,
    },
    hashChainHead: rows[rows.length - 1]?.hash ?? "",
    sourceSha256: await computeSourceHash(logPath),
    readiness: "ready",
    readinessReasons: [],
    runSummary: {
      default: {
        total: rows.length,
        landed: landed.length,
        failed: failures.length,
      },
    },
  }

  if (manifest.streamProvenLandings === 0) {
    manifest.readiness = "not_ready"
    manifest.readinessReasons.push("Zero stream-proven landings")
  }
  if (failures.length < 2) {
    manifest.readiness = "not_ready"
    manifest.readinessReasons.push(`Only ${failures.length} failures (need >= 2)`)
  }

  const md = [
    `# Evidence Report: ${logPath}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Rows | ${manifest.rowCount} |`,
    `| Run IDs | ${manifest.runIds.join(", ")} |`,
    `| UTC Window | ${manifest.utcWindow.start} → ${manifest.utcWindow.end} |`,
    `| Routes | ${manifest.routes.join(", ")} |`,
    `| Cluster | mainnet-beta |`,
    `| Live Jito Submissions | ${manifest.liveJitoSubmissions} |`,
    `| Stream-Proven Landings | ${manifest.streamProvenLandings} |`,
    `| Failures | ${manifest.failures} |`,
    `| Failure Modes | ${manifest.failureModes.join(", ") || "none"} |`,
    `| Tip Range | ${manifest.tipRange.min} – ${manifest.tipRange.max} lamports |`,
    `| Hash Chain Head | \`${manifest.hashChainHead.slice(0, 16)}…\` |`,
    `| Source SHA-256 | \`${manifest.sourceSha256.slice(0, 16)}…\` |`,
    `| Readiness | ${manifest.readiness} |`,
    "",
  ]

  if (failures.length > 0) {
    md.push("## Failures", "")
    for (const f of failures) {
      md.push(`- **${f.bundleId}**: \`${f.failureClass ?? f.failure}\``)
    }
    md.push("")
  }

  return { manifest, markdown: md.join("\n") }
}
