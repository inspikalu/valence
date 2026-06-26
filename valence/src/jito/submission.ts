export async function sendViaBlockEngine(
  blockEngineUrl: string,
  base64Tx: string,
  sig: string,
): Promise<string> {
  const url = blockEngineUrl.replace(/\/+$/, "") + "/api/v1/transactions"
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [base64Tx, { encoding: "base64" }],
    }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`sendTransaction via Block Engine failed: ${response.status} — ${text.slice(0, 200)}`)
  }
  return sig
}

export async function submitBundle(
  blockEngineUrl: string,
  bundleTxs: string[],
): Promise<string> {
  const url = blockEngineUrl.replace(/\/+$/, "") + "/api/v1/bundles"
  let response: Response | null = null
  const requestBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [bundleTxs, { encoding: "base64" }],
  })

  for (let attempt = 0; attempt < 5; attempt++) {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    })

    if (response.status !== 429 || attempt === 4) {
      break
    }

    await new Promise((resolve) => setTimeout(resolve, 1_500 + attempt * 750))
  }

  if (!response) {
    throw new Error("sendBundle request failed: no response")
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `sendBundle request failed: ${response.status} ${response.statusText} — ${text.slice(0, 500)}`,
    )
  }

  const body: { result?: unknown; error?: { message?: string } } = await response.json()

  if (body.error) {
    throw new Error(
      `sendBundle JSON-RPC error: ${body.error.message ?? JSON.stringify(body.error)}`,
    )
  }

  if (typeof body.result !== "string") {
    throw new Error(
      `sendBundle unexpected result shape: ${JSON.stringify(body.result).slice(0, 200)}`,
    )
  }

  return body.result
}
