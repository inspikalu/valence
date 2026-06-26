import type { ValenceConfig } from "../types/index.js"
import type { RetryInput, RetryOutput } from "./retryTypes.js"

const SYSTEM_PROMPT = `You are a Retry Intelligence agent for the Solana Jito block engine.
A bundle submission has failed. Given the failure classification, original tip amount and reasoning, current network conditions, and attempt number, decide whether to retry and what tip to use.
- The minimum tip is 1000 lamports.
- Consider whether the failure type is recoverable (e.g. expired_blockhash is recoverable; compute_exceeded may not be).
- If retrying with a higher tip, explain why a higher tip is justified.
- If choosing not to retry, explain why the failure is terminal.
- Return your decision as a JSON object with shouldRetry (boolean), tipLamports (integer), and reasoning (string).`

const TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: "decide_retry",
    description: "Decide whether to retry a failed Jito bundle submission and what tip to use",
    parameters: {
      type: "object",
      properties: {
        shouldRetry: {
          type: "boolean",
          description: "Whether to retry the submission",
        },
        tipLamports: {
          type: "integer",
          description: "Tip in lamports if retrying (1000-100000)",
        },
        reasoning: {
          type: "string",
          description: "Short natural-language explanation of the retry decision",
        },
      },
      required: ["shouldRetry", "tipLamports", "reasoning"],
    },
  },
}

function buildUserMessage(input: RetryInput): string {
  const lines: string[] = [
    "Failed Jito bundle submission — retry decision:",
    `- Failure classification: ${input.failureClassification}`,
    `- Original tip lamports: ${input.originalTipLamports}`,
    `- Original reasoning: ${input.originalReasoning}`,
    `- Attempt number: ${input.attemptNumber} of ${input.maxAttempts}`,
    `- Current slot: ${input.currentSlot}`,
    `- Leader identity: ${input.leaderIdentity ?? "unknown"}`,
    `- Is Jito leader: ${input.isJitoLeader}`,
    `- Tip account: ${input.tipAccount}`,
  ]

  if (input.tipFloorSnapshot) {
    const s = input.tipFloorSnapshot
    lines.push(
      `- Tip floor percentiles: p25=${s.p25} p50=${s.p50} p75=${s.p75} p95=${s.p95} p99=${s.p99} ema50=${s.ema50}`,
    )
  } else {
    lines.push("- No tip floor data available")
  }

  return lines.join("\n")
}

function clampOutput(output: RetryOutput, config: ValenceConfig): RetryOutput {
  return {
    shouldRetry: output.shouldRetry,
    tipLamports: Math.max(1000, Math.min(config.maxTipLamports, output.tipLamports)),
    reasoning: output.reasoning,
  }
}

function parseGroqResponse(data: unknown): RetryOutput {
  try {
    const resp = data as GroqResponse
    const choice = resp.choices?.[0]
    const toolCall = choice?.message?.tool_calls?.[0]
    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments) as Record<string, unknown>
      if (typeof parsed.shouldRetry === "boolean" && typeof parsed.tipLamports === "number" && typeof parsed.reasoning === "string") {
        return {
          shouldRetry: parsed.shouldRetry,
          tipLamports: Math.round(parsed.tipLamports),
          reasoning: parsed.reasoning,
        }
      }
    }
  } catch {
  }
  console.warn("[retry-agent] Failed to parse Groq structured response — using hardcoded retry")
  return { shouldRetry: true, tipLamports: 0, reasoning: "Failed to parse Groq response — fell back to original tip" }
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

export async function callRetryAgent(
  input: RetryInput,
  config: ValenceConfig,
): Promise<RetryOutput> {
  const url = `${config.groqEndpoint}/chat/completions`

  const body = {
    model: config.groqModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(input) },
    ],
    tools: [TOOL_DEFINITION],
    tool_choice: { type: "function" as const, function: { name: "decide_retry" } },
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
      console.warn("[retry-agent] Groq rate-limited (429) — retrying once after 1s backoff")
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
        console.warn(`[retry-agent] Groq retry also failed (${retryResponse.status}) — using hardcoded retry`)
        return { shouldRetry: true, tipLamports: input.originalTipLamports, reasoning: "Groq API rate-limited after retry — fell back to original tip" }
      }
      return clampOutput(parseGroqResponse(await retryResponse.json()), config)
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown")
      console.warn(`[retry-agent] Groq API error (${response.status}): ${errorText.slice(0, 200)}`)
      return { shouldRetry: true, tipLamports: input.originalTipLamports, reasoning: `Groq API error (${response.status}) — fell back to original tip` }
    }

    return clampOutput(parseGroqResponse(await response.json()), config)
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    if (err instanceof Error && err.name === "AbortError") {
      console.warn("[retry-agent] Groq API timed out after 5s — using hardcoded retry")
      return { shouldRetry: true, tipLamports: input.originalTipLamports, reasoning: "Groq API timed out — fell back to original tip" }
    }
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[retry-agent] Groq API call failed: ${message} — using hardcoded retry`)
    return { shouldRetry: true, tipLamports: input.originalTipLamports, reasoning: "Groq API unavailable — fell back to original tip" }
  }
}
