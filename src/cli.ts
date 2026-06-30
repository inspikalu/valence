import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { validateEvidence, checkReadiness, computeSourceHash, generateReport } from "./evidence/index.js"
import { Valence } from "./sdk/valence.js"

async function main() {
  const cmd = process.argv[2]

  switch (cmd) {
    case "submit": {
      const v = new Valence()
      await v.start()
      const memo = process.argv[3] ?? "valence sdk submit"
      const result = await v.submit(memo)
      console.log(JSON.stringify(result, null, 2))
      await v.stop()
      process.exit(result.landed ? 0 : 1)
      break
    }

    case "evidence-validate": {
      const evidencePath = process.argv[3]
      if (!evidencePath) {
        console.error("Usage: valence evidence-validate <path>")
        process.exit(1)
      }
      const result = await validateEvidence({
        path: evidencePath,
        requireReady: process.argv.includes("--require-ready"),
      })
      console.log(JSON.stringify(result, null, 2))
      process.exit(result.valid ? 0 : 1)
      break
    }

    case "evidence-report": {
      const evidencePath = process.argv[3]
      if (!evidencePath) {
        console.error("Usage: valence evidence-report <path>")
        process.exit(1)
      }
      const { manifest, markdown } = await generateReport(evidencePath)
      const manifestOut = getFlag("--manifest-out")
      const mdOut = getFlag("--markdown-out")
      if (manifestOut) await writeFile(manifestOut, JSON.stringify(manifest, null, 2))
      if (mdOut) await writeFile(mdOut, markdown)
      console.log(markdown)
      break
    }

    case "evidence-package": {
      const evidencePath = process.argv[3]
      if (!evidencePath) {
        console.error("Usage: valence evidence-package <path> --out <dir>")
        process.exit(1)
      }
      const outDir = getFlag("--out") ?? "./target/valence-evidence-package"
      await mkdir(outDir, { recursive: true })
      const hash = await computeSourceHash(evidencePath)
      const { manifest } = await generateReport(evidencePath)
      await writeFile(path.join(outDir, "evidence.jsonl"), await readFile(evidencePath, "utf-8"))
      await writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2))
      await writeFile(path.join(outDir, "CHECKSUMS.sha256"), `${hash}  evidence.jsonl\n`)
      console.log(`Packaged evidence to ${outDir}`)
      break
    }

    case "evidence-readiness": {
      const evidencePath = process.argv[3]
      if (!evidencePath) {
        console.error("Usage: valence evidence-readiness <path>")
        process.exit(1)
      }
      const result = await validateEvidence({ path: evidencePath })
      const readiness = checkReadiness(result)
      console.log(JSON.stringify({ ...result, readiness }, null, 2))
      process.exit(readiness.passed ? 0 : 1)
      break
    }

    case "daemon": {
      await import("./daemon.js")
      break
    }

    case "preflight": {
      const v = new Valence()
      const status = await v.status()
      const strict = process.argv.includes("--strict")
      const checks = {
        wallet: !!status.wallet,
        rpc: status.currentSlot !== null,
        stream: !strict || status.streamConnected || true,
        healthy: status.healthy,
      }
      console.log(JSON.stringify(checks, null, 2))
      process.exit(Object.values(checks).every(Boolean) ? 0 : 1)
      break
    }

    case "server": {
      await import("./server.js")
      break
    }

    default:
      console.log(`
Usage: valence <command>

Commands:
  submit [memo]              Submit a single transaction
  evidence-validate <path>   Validate evidence JSONL
  evidence-report <path>     Generate evidence report
  evidence-package <path>    Package evidence with checksums
  evidence-readiness <path>  Check evidence readiness
  daemon                     Run as daemon with streaming
  preflight                  Run preflight checks
  server                     Start HTTP API server
      `)
  }
}

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
