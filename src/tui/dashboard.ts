import type { CongestionStatus } from "../network/congestion.js"

const ESC = "\x1b["
const RESET = ESC + "0m"
const BOLD = ESC + "1m"
const DIM = ESC + "2m"
const BLINK = ESC + "5m"
const REV = ESC + "7m"
const CLS = ESC + "2J" + ESC + "H"
const HIDE = ESC + "?25l"
const SHOW = ESC + "?25h"

const fg = (n: number) => `${ESC}38;5;${n}m`
const bg = (n: number) => `${ESC}48;5;${n}m`
const _256 = (fg: number, bg?: number) => `${ESC}38;5;${fg}m${bg ? ESC + "48;5;" + bg + "m" : ""}`
const TEAL = fg(87)
const SKY = fg(75)
const PURPLE = fg(141)
const PINK = fg(213)
const ORANGE = fg(214)
const GOLD = fg(220)
const LIME = fg(154)
const ROSE = fg(204)
const SLATE = fg(240)
const INDIGO = fg(105)
const WHITE = fg(255)

const COLORS = { TEAL, SKY, PURPLE, PINK, ORANGE, GOLD, LIME, ROSE, SLATE, INDIGO, WHITE }

function a(text: string, ...codes: string[]): string {
  return codes.join("") + text.replace(/\x1b\[0m/g, RESET) + RESET
}

function visLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length
}

function rpad(s: string, n: number, c = " "): string {
  const e = n - visLen(s)
  return e > 0 ? s + c.repeat(e) : s
}

function center(s: string, n: number, c = " "): string {
  const e = Math.max(0, n - visLen(s))
  return c.repeat(Math.floor(e / 2)) + s + c.repeat(Math.ceil(e / 2))
}

export interface DashboardTipFloor {
  p25: number; p50: number; p75: number; p95: number; ema50: number
}

export interface DashboardState {
  slot: string | null
  wallet: string | null
  balance: string | null
  stream: boolean
  congestion: CongestionStatus | null
  leader: { current: string | null; next: string | null; slotsUntil: number | null; inWindow: boolean } | null
  tipFloor: DashboardTipFloor | null
  computedTip: number | null
  bundles: Array<{ id: string; stage: string; tip: number; attempt: number }>
  lastDecision: { action: string; tip: number; reasoning: string; confidence: number } | null
  logs: Array<{ ts: number; level: string; msg: string }>
  uptime: number
  landed: number
  failed: number
}

const W = 78
const W1 = W - 4

function box(col: string, title: string, rows: string[]): string[] {
  const out: string[] = []
  const t = title ? ` ${title} ` : ""
  const p = Math.max(0, W - 4 - visLen(t))
  const l = Math.floor(p / 2)
  const r = p - l
  out.push(a("╔" + "═".repeat(l + 1), col) + a(t, BOLD, col) + a("═".repeat(r + 1) + "╗", col))
  for (const row of rows) {
    out.push(a("║", col) + " " + rpad(row, W - 3) + a("║", col))
  }
  out.push(a("╚" + "═".repeat(W - 2) + "╝", col))
  return out
}

function badge(stage: string): string {
  const m: Record<string, [string, number]> = {
    finalized: [" FINAL ", 34], confirmed: [" CONFIRM ", 38],
    processed: [" PROCESS ", 220], submitted: [" SUBMIT ", 27],
  }
  const e = m[stage] ?? [" ?????? ", 240]
  return a(e[0], _256(16, e[1]))
}

function actionBadge(a2: string): string {
  const m: Record<string, [string, number]> = {
    retry: [" RETRY ", 40], hold: [" HOLD ", 214], abort: [" ABORT ", 196],
  }
  const e = m[a2] ?? [` ${a2.toUpperCase()} `, 240]
  return a(e[0], _256(16, e[1]))
}

function lamports(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(4) + "◎"
  if (n >= 1e6) return (n / 1e6).toFixed(3) + "M"
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k"
  return n + "◎"
}

function sparkline(vals: number[], w = 12): string {
  const chars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
  if (vals.length === 0) return a("─".repeat(w), DIM)
  const mx = Math.max(...vals, 1)
  const sl = vals.slice(-w)
  const bs = sl.map(v => chars[Math.min(7, Math.floor((v / mx) * 8))]!)
  while (bs.length < w) bs.unshift("▁")
  return a(bs.join(""), TEAL)
}

export class Dashboard {
  private timer: ReturnType<typeof setInterval> | null = null
  private getState: () => DashboardState
  private slotHist: number[] = []
  private congHist: number[] = []
  private lastSlot = 0n
  private lastSlotAt = 0
  private frame = 0
  private spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

  constructor(getState: () => DashboardState, intervalMs = 1000) {
    this.getState = getState
  }

  start(): void {
    process.stdout.write(HIDE)
    this.timer = setInterval(() => this.render(), 1000)
    this.render()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    process.stdout.write(SHOW)
  }

  render(): void {
    const s = this.getState()
    this.frame = (this.frame + 1) % this.spinner.length
    const spin = this.spinner[this.frame]!
    const now = Date.now()
    const up = Math.floor((now - s.uptime) / 1000)
    const upStr = `${String(Math.floor(up / 3600)).padStart(2, "0")}:${String(Math.floor((up % 3600) / 60)).padStart(2, "0")}:${String(up % 60).padStart(2, "0")}`

    const out: string[] = []
    out.push(CLS)
    out.push(a("╔" + "═".repeat(W - 2) + "╗", TEAL))
    out.push(a("║", TEAL) + rpad(a(" VALENCE ", BOLD, TEAL) + a("— Smart Transaction Stack", SKY), W - 19) + a(` ${upStr} `, SLATE) + a("║", TEAL))
    out.push(a("║", TEAL) + rpad(a(" Yellowstone gRPC ▸ Jito Bundles ▸ AI Agent ▸ Proof Evidence ", SLATE), W - 2) + a("║", TEAL))
    out.push(a("╚" + "═".repeat(W - 2) + "╝", TEAL))
    out.push("")

    // Stream + Leader panel
    const connDot = s.stream ? a("●", LIME) + " connected" : a("●", ROSE) + " disconnected"
    const winDot = s.leader?.inWindow ? a("▶ IN WINDOW", LIME) : a("▷ waiting", SLATE)
    const lRows = [
      `  ${a("STREAM", BOLD, SKY)} ${connDot}    ${a("JITO", BOLD, PURPLE)} ${winDot}`,
      `  ${a("slot", SLATE)} ${a(s.slot ?? "—", BOLD)}  ${a("wallet", SLATE)} ${a(s.wallet ?? "—", DIM)}  ${a("balance", SLATE)} ${a(s.balance ?? "?", GOLD)}`,
      `  ${a("next leader", SLATE)} ${a(s.leader?.next ?? "—", WHITE)}  ${a("in", SLATE)} ${a(s.leader?.slotsUntil?.toString() ?? "?", WHITE)} ${a("slots", SLATE)}`,
    ]
    out.push(...box(TEAL, " NETWORK ", lRows))
    out.push("")

    // Congestion panel
    const cRows: string[] = []
    if (s.congestion) {
      const c = s.congestion
      const skC = c.skipRate < 0.05 ? LIME : c.skipRate < 0.12 ? GOLD : ROSE
      const pdC = c.pcDeltaMs < 400 ? LIME : c.pcDeltaMs < 800 ? GOLD : ROSE
      cRows.push(`  ${a("skip", SLATE)} ${a((c.skipRate * 100).toFixed(1) + "%", BOLD, skC)}  ${a("P→C p50", SLATE)} ${a(Math.round(c.pcDeltaMs) + "ms", BOLD, pdC)}  ${a("multiplier", SLATE)} ${a("×" + c.multiplier.toFixed(2), BOLD, c.multiplier > 1.5 ? GOLD : LIME)}`)
    } else {
      cRows.push(`  ${a(`${spin} waiting for slot events…`, SLATE)}`)
    }
    out.push(...box(ORANGE, " CONGESTION ", cRows))
    out.push("")

    // Tip floor panel
    const tRows: string[] = []
    if (s.tipFloor) {
      const tf = s.tipFloor
      const max = Math.max(tf.p25, tf.p50, tf.p75, tf.p95, 1)
      const bar = (v: number, label: string, active: boolean) => {
        const pct = v / max
        const fill = Math.round(pct * 8)
        return `${active ? a(label, BOLD, GOLD) : a(label, SLATE)} ${a("█".repeat(fill) + "░".repeat(8 - fill), active ? GOLD : SLATE)}`
      }
      tRows.push(`  ${bar(tf.p25, "p25", false)}  ${bar(tf.p50, "p50", false)}  ${bar(tf.p75, "p75", false)}  ${bar(tf.p95, "p95", false)}`)
      tRows.push(`  ${a(lamports(tf.p25).padStart(10), DIM)}  ${a(lamports(tf.p50).padStart(10), DIM)}  ${a(lamports(tf.p75).padStart(10), DIM)}  ${a(lamports(tf.p95).padStart(10), DIM)}`)
      if (s.computedTip) {
        tRows.push(`  ${a("▶ active tip", SLATE)} ${a(lamports(s.computedTip), BOLD, LIME)}  ${a("ema50", SLATE)} ${a(lamports(tf.ema50), WHITE)}`)
      } else {
        tRows.push(`  ${a("ema50", SLATE)} ${a(lamports(tf.ema50), WHITE)}`)
      }
    } else {
      tRows.push(`  ${a(`${spin} fetching tip floor from Jito…`, SLATE)}`)
    }
    out.push(...box(GOLD, " TIP FLOOR ", tRows))
    out.push("")

    // Bundles
    const bRows: string[] = []
    if (s.bundles.length === 0) {
      bRows.push(`  ${a("no bundles in flight", SLATE)}`)
    } else {
      for (const b of s.bundles.slice(-5).reverse()) {
        bRows.push(`  ${badge(b.stage)}  ${a(b.id.slice(0, 12) + "…", INDIGO)} ${a(`#${b.attempt}`, b.attempt > 1 ? ORANGE : SLATE)} ${a(lamports(b.tip), LIME)}`)
      }
    }
    out.push(...box(INDIGO, ` BUNDLES (${s.bundles.length}) `, bRows))
    out.push("")

    // AI Agent
    const aRows: string[] = []
    if (s.lastDecision) {
      const d = s.lastDecision
      const cf = "▓".repeat(Math.round(d.confidence * 10)) + "░".repeat(10 - Math.round(d.confidence * 10))
      const cfC = d.confidence >= 0.8 ? LIME : d.confidence >= 0.5 ? GOLD : ROSE
      aRows.push(`  ${actionBadge(d.action)}  ${a("tip", SLATE)} ${a(lamports(d.tip), LIME)}  ${a("confidence", SLATE)} ${a(cf, cfC)} ${a((d.confidence * 100).toFixed(0) + "%", BOLD, cfC)}`)
      const wrap = d.reasoning.slice(0, W1 - 8)
      aRows.push(`  ${a("╰─", SLATE)} ${a(wrap, DIM)}`)
    } else {
      aRows.push(`  ${a(`${spin} waiting for submission…`, SLATE)}`)
    }
    out.push(...box(PINK, " AI AGENT ", aRows))
    out.push("")

    // Logs
    const logRows: string[] = []
    const logs = s.logs.slice(-4)
    if (logs.length === 0) {
      for (let i = 0; i < 3; i++) logRows.push(`  ${""}`)
    } else {
      for (const log of logs) {
        const lvl = log.level === "error" ? a("ERR", ROSE) : log.level === "warn" ? a("WRN", GOLD) : a("INF", SKY)
        logRows.push(`  ${lvl} ${a(log.msg.slice(0, W1 - 8), DIM)}`)
      }
    }
    out.push(...box(SLATE, " LOGS ", logRows))

    out.push("")
    out.push(rpad(a(" Ctrl+C to exit", SLATE), W - 18) + a(`landed ${s.landed}  failed ${s.failed}`, DIM))

    process.stdout.write(out.join("\n"))
  }
}
