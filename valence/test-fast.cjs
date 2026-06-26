// CJS test - submit bundle WITHOUT any delay between blockhash fetch and submission
const { Connection, Keypair, Transaction, SystemProgram, PublicKey } = require('@solana/web3.js')
const fs = require('fs')

const RPC_URL = 'https://api.mainnet-beta.solana.com'
const BLOCK_ENGINE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles'
const KEYPAIR_FILE = process.env.HOME + '/.config/solana/id.json'
const TIP_LAMPORTS = 50000

async function main() {
  const wallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_FILE, 'utf-8'))))
  const conn = new Connection(RPC_URL)
  
  console.log('Wallet:', wallet.publicKey.toBase58())
  
  // NO DELAY - get blockhash and submit immediately
  const bh = await conn.getLatestBlockhash('processed')
  console.log('Blockhash:', bh.blockhash, '(get time:', Date.now(), ')')
  
  const tipAccount = new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5')
  
  const tx = new Transaction()
  tx.add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: tipAccount,
    lamports: TIP_LAMPORTS,
  }))
  tx.add(
    new (require('@solana/web3.js').TransactionInstruction)({
      keys: [],
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      data: Buffer.from('test bundle'),
    })
  )
  tx.recentBlockhash = bh.blockhash
  tx.feePayer = wallet.publicKey
  tx.sign(wallet)
  
  const b64 = tx.serialize().toString('base64')
  
  // Submit immediately - no sleep
  const submitTime = Date.now()
  const resp = await fetch(BLOCK_ENGINE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [[b64], { encoding: 'base64' }]
    })
  })
  console.log('Submit time delta:', Date.now() - submitTime, 'ms')
  
  const body = await resp.json()
  console.log('Response:', JSON.stringify(body))
  
  if (body.result) {
    // Poll status
    await new Promise(r => setTimeout(r, 5000))
    const statusResp = await fetch(BLOCK_ENGINE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getInflightBundleStatuses',
        params: [[body.result]]
      })
    })
    const statusBody = await statusResp.json()
    console.log('Status:', JSON.stringify(statusBody?.result?.value?.[0] ?? statusBody))
  }
}

main().catch(e => console.error('Fatal:', e.message.substring(0, 300)))
