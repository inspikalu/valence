export interface ValenceConfig {
  rpcUrl: string
  privateKey: string | null
  keypairFile: string | null
  logLevel: string
  yellowstoneEndpoint: string | null
  yellowstoneGrpcToken: string | null
  jitoValidatorKeys: string[]
  leaderHeartbeatInterval: number
  sendTestTx: boolean
  showTipData: boolean
  jitoTipFloorUrl: string
  jitoTipStreamUrl: string
  jitoBlockEngineUrl: string
  jitoTipRestRefreshMs: number
  sendBundle: boolean
  bundleTipLamports: number
  lifecycleLogPath: string | null
  intentionalExpiry: boolean
  maxRetries: number
  groqApiKey: string | null
  groqModel: string
  groqEndpoint: string
  maxTipLamports: number
  volumeCount: number
  volumeIntervalMs: number
  injectFailureMode: string
}
