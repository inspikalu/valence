export class RpcConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RpcConnectionError"
  }
}

export class RpcRateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RpcRateLimitError"
  }
}

export class RpcTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RpcTimeoutError"
  }
}
