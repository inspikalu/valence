// Direct gRPC test using generated protobuf + @grpc/grpc-js
const grpc = require('@grpc/grpc-js')
const { SearcherServiceClient, SendBundleRequest } = require('@solsdk/jito-ts/dist/gen/block-engine/searcher')
const { Bundle: BundleProto } = require('@solsdk/jito-ts/dist/gen/block-engine/bundle')
const { Connection, Keypair, SystemProgram, PublicKey, TransactionMessage, VersionedTransaction } = require('@solana/web3.js')
const fs = require('fs')
const bs58mod = require('bs58')
const bs58 = bs58mod.default || bs58mod

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com'
const BLOCK_ENGINE = process.env.BLOCK_ENGINE_URL || 'mainnet.block-engine.jito.wtf:443'
const KEYPAIR_FILE = process.env.HOME + '/.config/solana/id.json'
const TIP_LAMPORTS = 50000

async function main() {
  const wallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_FILE, 'utf-8'))))
  const conn = new Connection(RPC_URL)
  console.log('Wallet:', wallet.publicKey.toBase58())

  const bal = await conn.getBalance(wallet.publicKey)
  console.log('Balance:', bal, 'lamports')

  // Create gRPC client directly
  console.log('\n=== Direct gRPC SearcherServiceClient ===')
  console.log('URL:', BLOCK_ENGINE)
  const client = new SearcherServiceClient(BLOCK_ENGINE, grpc.credentials.createSsl())

  // Get tip accounts
  const tipResp = await new Promise((resolve, reject) => {
    client.getTipAccounts({}, (err, resp) => {
      if (err) reject(err)
      else resolve(resp)
    })
  })
  console.log('Tip accounts:', tipResp.accounts)

  const tipAccount = tipResp.accounts[0]
  console.log('Using tip account:', tipAccount)

  // Get blockhash
  await new Promise(r => setTimeout(r, 1100))
  const bh = await conn.getLatestBlockhash('processed')
  console.log('Blockhash:', bh.blockhash)

  // Build transactions as native VersionedTransactions
  const tipIx = SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: new PublicKey(tipAccount),
    lamports: TIP_LAMPORTS,
  })

  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: bh.blockhash,
    instructions: [tipIx],
  }).compileToV0Message()

  const vtx = new VersionedTransaction(messageV0)
  vtx.sign([wallet])
  const sig = bs58.encode(vtx.signatures[0])
  console.log('Signature:', sig)

  // Serialize the transaction
  const txBytes = vtx.serialize()

  // Build the protobuf Bundle
  const bundleProto = BundleProto.fromPartial({
    packets: [{
      data: txBytes,
      meta: {
        port: 0,
        addr: '0.0.0.0',
        senderStake: 0,
        size: txBytes.length,
      },
    }],
  })

  const request = SendBundleRequest.fromPartial({ bundle: bundleProto })
  console.log('\nSending bundle via gRPC...')

  const result = await new Promise((resolve, reject) => {
    client.sendBundle(request, (err, resp) => {
      if (err) reject(err)
      else resolve(resp)
    })
  })
  console.log('Bundle UUID:', result.uuid)
  console.log('Explorer: https://explorer.jito.wtf/bundle/' + result.uuid)

  // Poll for status
  console.log('\n=== Polling ===')
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000))
    // Use HTTP to check inflight status
    try {
      const httpResp = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getInflightBundleStatuses',
          params: [[result.uuid]],
        }),
      })
      const data = await httpResp.json()
      console.log(`Poll ${i + 1}:`, JSON.stringify(data?.result?.value?.[0] ?? data))
      const status = data?.result?.value?.[0]?.status
      if (status === 'Landed' || status === 'Invalid' || status === 'Failed') break
    } catch (e) {
      console.log(`Poll ${i + 1}:`, e.message)
    }

    const onchain = await conn.getSignatureStatus(sig, { searchTransactionHistory: true })
    if (onchain?.value?.confirmationStatus) {
      console.log('  On-chain:', onchain.value.confirmationStatus)
      break
    }
  }

  client.close()
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
