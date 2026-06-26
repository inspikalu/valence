export interface BundleStatusEntry {
  bundle_id: string
  status?: string
  slot?: number
  landed_slot?: number | null
  timestamp?: number
  confirmation_status?: string
  transactions: { signature: string; slot: number; err: unknown | null }[]
}

export interface InflightBundleStatusEntry {
  bundle_id: string
  status: string
  slot?: number
  landed_slot?: number | null
  timestamp?: number
}

interface JsonRpcResult {
  context: { slot: number }
  value: unknown
}

async function postWithRateLimitRetry(url: string, body: string): Promise<Response> {
  let response: Response | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })

    if (response.status !== 429 || attempt === 4) {
      break
    }

    await new Promise((resolve) => setTimeout(resolve, 1_500 + attempt * 750))
  }

  if (!response) {
    throw new Error("bundle status request failed: no response")
  }

  return response
}

export async function getBundleStatuses(
  blockEngineUrl: string,
  bundleId: string,
): Promise<BundleStatusEntry[]> {
  const url = blockEngineUrl.replace(/\/+$/, "") + "/api/v1/getBundleStatuses"
  const response = await postWithRateLimitRetry(
    url,
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBundleStatuses",
      params: [[bundleId]],
    }),
  )

  if (!response.ok) {
    throw new Error(`getBundleStatuses request failed: ${response.status}`)
  }

  const body: { result?: JsonRpcResult; error?: { message?: string } } = await response.json()

  if (body.error) {
    throw new Error(
      `getBundleStatuses JSON-RPC error: ${body.error.message ?? JSON.stringify(body.error)}`,
    )
  }

  if (!body.result || typeof body.result !== "object" || !("value" in body.result)) {
    throw new Error(
      `getBundleStatuses unexpected result shape: ${JSON.stringify(body.result).slice(0, 200)}`,
    )
  }

  const value = body.result.value
  if (value === null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `getBundleStatuses unexpected result.value shape: ${JSON.stringify(value).slice(0, 200)}`,
    )
  }

  return value as BundleStatusEntry[]
}

export async function getInflightBundleStatuses(
  blockEngineUrl: string,
  bundleId?: string,
): Promise<InflightBundleStatusEntry[]> {
  const url = blockEngineUrl.replace(/\/+$/, "") + "/api/v1/getInflightBundleStatuses"
  const response = await postWithRateLimitRetry(
    url,
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getInflightBundleStatuses",
      params: bundleId ? [[bundleId]] : [],
    }),
  )

  if (!response.ok) {
    throw new Error(`getInflightBundleStatuses request failed: ${response.status}`)
  }

  const body: { result?: JsonRpcResult; error?: { message?: string } } = await response.json()

  if (body.error) {
    throw new Error(
      `getInflightBundleStatuses JSON-RPC error: ${body.error.message ?? JSON.stringify(body.error)}`,
    )
  }

  if (!body.result || typeof body.result !== "object" || !("value" in body.result)) {
    throw new Error(
      `getInflightBundleStatuses unexpected result shape: ${JSON.stringify(body.result).slice(0, 200)}`,
    )
  }

  const value = body.result.value
  if (value === null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `getInflightBundleStatuses unexpected result.value shape: ${JSON.stringify(value).slice(0, 200)}`,
    )
  }

  return value as InflightBundleStatusEntry[]
}
