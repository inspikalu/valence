import type { ValenceConfig } from "../types/index.js"
import type { AgentInput, AgentOutput } from "./types.js"

const SYSTEM_PROMPT = `You are a Tip Intelligence agent for the Solana Jito block engine.
Given current tip-floor percentiles, slot/leader context, and bundle metadata,
choose a tip in lamports and explain your reasoning.
- The minimum tip is 1000 lamports.
- Higher tips increase landing probability but cost more.
- Consider the current p50/p75/p95 percentiles as guidance.
- If the next leader is a Jito validator, a moderate tip may suffice.
- Return your decision as a JSON object with tipLamports (integer) and reasoning (string).
- Use tool_choice/function calling to return structured output.`

const TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: "decide_tip",
    description: "Decide the Jito bundle tip in lamports based on current network conditions",
    parameters: {
      type: "object",
      properties: {
        tipLamports: {
          type: "integer",
          description: "Tip in lamports (1000-100000)",
        },
        reasoning: {
          type: "string",
          description: "Short natural-language explanation of the decision",
        },
      },
      required: ["tipLamports", "reasoning"],
    },
  },
}

function buildUserMessage(input: AgentInput): string {
  const lines: string[] = [
    "Current network conditions for Jito bundle tip decision:",
    `- Current slot: ${input.currentSlot}`,
    `- Leader identity: ${input.leaderIdentity ?? "unknown"}`,
    `- Is Jito leader: ${input.isJitoLeader}`,
    `- Bundle size: ${input.bundleSize} transactions`,
    `- Tip account: ${input.tipAccount}`,
  ]

  if (input.tipFloorSnapshot) {
    const s = input.tipFloorSnapshot
    lines.push(
      `- Tip floor percentiles: p25=${s.p25} p50=${s.p50} p75=${s.p75} p95=${s.p95} p99=${s.p99} ema50=${s.ema50}`,
      `- Tip floor sampled at: ${s.time}`,
    )
  } else {
    lines.push("- No tip floor data available")
  }

  return lines.join("\n")
}

export async function callTipAgent(
  input: AgentInput,
  config: ValenceConfig,
): Promise<AgentOutput> {
  const url = `${config.groqEndpoint}/chat/completions`

  const body = {
    model: config.groqModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(input) },
    ],
    tools: [TOOL_DEFINITION],
    tool_choice: { type: "function" as const, function: { name: "decide_tip" } },
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.groqApiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (response.status === 429) {
      console.warn("[agent] Groq rate-limited (429) — retrying once after 1s backoff")
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const retryResponse = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.groqApiKey}`,
        },
        body: JSON.stringify(body),
      })
      if (!retryResponse.ok) {
        console.warn(`[agent] Groq retry also failed (${retryResponse.status}) — falling back to minimum tip`)
        return { tipLamports: 1000, reasoning: "Groq API rate-limited after retry — fell back to minimum tip" }
      }
      return clampOutput(parseGroqResponse(await retryResponse.json()), config)
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown")
      console.warn(`[agent] Groq API error (${response.status}): ${errorText.slice(0, 200)}`)
      return { tipLamports: 1000, reasoning: `Groq API error (${response.status}) — fell back to minimum tip` }
    }

    return clampOutput(parseGroqResponse(await response.json()), config)
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    if (err instanceof Error && err.name === "AbortError") {
      console.warn("[agent] Groq API timed out after 5s — falling back to minimum tip")
      return { tipLamports: 1000, reasoning: "Groq API timed out — fell back to minimum tip" }
    }
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[agent] Groq API call failed: ${message} — falling back to minimum tip`)
    return { tipLamports: 1000, reasoning: "Groq API unavailable — fell back to minimum tip" }
  }
}

interface GroqChoice {
  message?: {
    tool_calls?: Array<{
      function?: {
        arguments?: string
      }
    }>
  }
}

interface GroqResponse {
  choices?: GroqChoice[]
}

function clampOutput(output: AgentOutput, config: ValenceConfig): AgentOutput {
  return {
    tipLamports: Math.max(1000, Math.min(config.maxTipLamports, output.tipLamports)),
    reasoning: output.reasoning,
  }
}

function parseGroqResponse(data: unknown): AgentOutput {
  try {
    const resp = data as GroqResponse
    const choice = resp.choices?.[0]
    const toolCall = choice?.message?.tool_calls?.[0]
    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments) as Record<string, unknown>
      if (typeof parsed.tipLamports === "number" && typeof parsed.reasoning === "string") {
        return {
          tipLamports: Math.round(parsed.tipLamports),
          reasoning: parsed.reasoning,
        }
      }
    }
  } catch {
    // fall through to fallback
  }
  console.warn("[agent] Failed to parse Groq structured response — using minimum tip")
  return { tipLamports: 1000, reasoning: "Failed to parse Groq response — fell back to minimum tip" }
}
