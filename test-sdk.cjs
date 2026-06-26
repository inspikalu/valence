// CJS test using jito-js-rpc SDK
const { JitoJsonRpcClient } = require('jito-js-rpc')
const { Connection, Keypair, Transaction, SystemProgram, PublicKey } = require('@solana/web3.js')
const bs58 = require('bs58')
const fs = require('fs')

const RPC_URL = 'https://api.mainnet-beta.solana.com'
const BLOCK_ENGINE = 'https://mainnet.block-engine.jito.wtf/api/v1'
const KEYPAIR_FILE = process.env.HOME + '/.config/solana/id.json'
const TIP_LAMPORTS = 50000

async function main() {
  const wallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_FILE, 'utf-8'))))
  const conn = new Connection(RPC_URL)
  const client = new JitoJsonRpcClient(BLOCK_ENGINE)

  console.log('Wallet:', wallet.publicKey.toBase58())
  const bal = await conn.getBalance(wallet.publicKey)
  console.log('Balance:', bal, 'lamports')

  // Get tip accounts via SDK
  const tipResp = await client.getTipAccounts()
  const accounts = tipResp.result
  if (!accounts || !accounts.length) throw new Error('No tip accounts')
  const tipAccount = accounts[Math.floor(Math.random() * accounts.length)]
  console.log('Tip:', tipAccount)

  await new Promise(r => setTimeout(r, 1100))

  const bh = await conn.getLatestBlockhash('processed')
  console.log('Blockhash:', bh.blockhash)

  // Build tip-only tx
  const tx = new Transaction()
  tx.add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: new PublicKey(tipAccount),
    lamports: TIP_LAMPORTS,
  }))
  tx.recentBlockhash = bh.blockhash
  tx.feePayer = wallet.publicKey
  tx.sign(wallet)

  const b64 = tx.serialize().toString('base64')
  console.log('Tx length:', b64.length, 'bytes')

  // Send via SDK
  console.log('\n=== SDK sendBundle (base64) ===')
  const resp = await client.sendBundle([[b64], { encoding: 'base64' }])
  const bundleId = resp.result
  console.log('Bundle ID:', bundleId)
  console.log('Full response:', JSON.stringify(resp))

  // Poll inflight
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const status = await client.getInFlightBundleStatuses([[bundleId]])
    console.log(`Poll ${i+1}:`, JSON.stringify(status?.result?.value?.[0] ?? status))
    if (status?.result?.value?.[0]?.status === 'Landed') {
      console.log('LANDED!')
      break
    }
    if (status?.result?.value?.[0]?.status === 'Invalid') {
      console.log('INVALID')
      break
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
