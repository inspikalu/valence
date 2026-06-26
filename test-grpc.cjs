// CJS test using @solsdk/jito-ts gRPC SDK
const { searcherClient } = require('@solsdk/jito-ts/dist/sdk/block-engine/searcher')
const { Bundle } = require('@solsdk/jito-ts/dist/sdk/block-engine/types')
const { Connection, Keypair, SystemProgram, PublicKey, TransactionMessage, VersionedTransaction } = require('@solana/web3.js')
const fs = require('fs')

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com'
const BLOCK_ENGINE = process.env.BLOCK_ENGINE_URL || 'mainnet.block-engine.jito.wtf:443'
const KEYPAIR_FILE = process.env.HOME + '/.config/solana/id.json'
const bundleTransactionLimit = 5
const TIP_LAMPORTS = 50000

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function main() {
  const wallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_FILE, 'utf-8'))))
  const conn = new Connection(RPC_URL)
  console.log('Wallet:', wallet.publicKey.toBase58())

  const bal = await conn.getBalance(wallet.publicKey)
  console.log('Balance:', bal, 'lamports')

  // Create gRPC searcher client (WITHOUT auth keypair to test unauthenticated access)
  console.log('\n=== gRPC SearcherClient (no auth) ===')
  console.log('URL:', BLOCK_ENGINE)
  const c = searcherClient(BLOCK_ENGINE)

  // Get tip accounts via gRPC
  const tipResult = await c.getTipAccounts()
  if (!tipResult.ok) {
    console.error('getTipAccounts failed:', tipResult.error)
    return
  }
  const tipAccount = tipResult.value[0]
  console.log('Tip account:', tipAccount)

  // Get latest blockhash
  await sleep(1100)
  const bh = await conn.getLatestBlockhash('processed')
  console.log('Blockhash:', bh.blockhash)

  // Build bundle using the SDK's Bundle class
  const b = new Bundle([], bundleTransactionLimit)

  // Add a memo transaction
  const memoIx = new (require('@solana/web3.js').TransactionInstruction)({
    keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }],
    programId: new PublicKey('Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'),
    data: Buffer.from('jito grpc test'),
  })
  const memoMsg = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: bh.blockhash,
    instructions: [memoIx],
  }).compileToV0Message()
  const memoV0 = new VersionedTransaction(memoMsg)
  memoV0.sign([wallet])
  console.log('Memo tx sig:', require('bs58').encode(memoV0.signatures[0]))

  let maybeBundle = b.addTransactions(memoV0)
  if (maybeBundle instanceof Error) {
    console.error('addTransactions failed:', maybeBundle.message)
    return
  }

  // Add tip transaction
  maybeBundle = maybeBundle.addTipTx(wallet, TIP_LAMPORTS, new PublicKey(tipAccount), bh.blockhash)
  if (maybeBundle instanceof Error) {
    console.error('addTipTx failed:', maybeBundle.message)
    return
  }

  console.log(`Bundle has ${maybeBundle.transactions.length} transactions`)

  // Send via gRPC
  console.log('\n=== gRPC sendBundle ===')
  const result = await c.sendBundle(maybeBundle)
  if (!result.ok) {
    console.error('sendBundle failed:', result.error)
    return
  }
  console.log('Bundle UUID:', result.value)
  console.log('Explorer: https://explorer.jito.wtf/bundle/' + result.value)

  // Try with auth keypair
  console.log('\n=== gRPC SearcherClient (with auth keypair) ===')
  const c2 = searcherClient(BLOCK_ENGINE, wallet)

  const tipResult2 = await c2.getTipAccounts()
  if (tipResult2.ok) {
    const tipAccount2 = tipResult2.value[0]
    console.log('Tip account:', tipAccount2)

    await sleep(1100)
    const bh2 = await conn.getLatestBlockhash('processed')
    console.log('Blockhash:', bh2.blockhash)

    const b2 = new Bundle([], bundleTransactionLimit)
    const memoIx2 = new (require('@solana/web3.js').TransactionInstruction)({
      keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }],
      programId: new PublicKey('Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'),
      data: Buffer.from('jito grpc test 2'),
    })
    const memoMsg2 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: bh2.blockhash,
      instructions: [memoIx2],
    }).compileToV0Message()
    const memoV02 = new VersionedTransaction(memoMsg2)
    memoV02.sign([wallet])

    let mb2 = b2.addTransactions(memoV02)
    if (!(mb2 instanceof Error)) {
      mb2 = mb2.addTipTx(wallet, TIP_LAMPORTS, new PublicKey(tipAccount2), bh2.blockhash)
      if (!(mb2 instanceof Error)) {
        console.log(`Bundle has ${mb2.transactions.length} transactions`)
        const result2 = await c2.sendBundle(mb2)
        if (result2.ok) {
          console.log('Bundle UUID (auth):', result2.value)
        } else {
          console.error('sendBundle (auth) failed:', result2.error)
        }
      }
    }
  } else {
    console.error('getTipAccounts (auth) failed:', tipResult2.error)
  }

  // Poll for results
  console.log('\n=== Polling bundle results ===')
  for (let i = 0; i < 15; i++) {
    await sleep(2000)
    const inflight = await (await import('./src/jito/bundleStatus.js'))
      .getInflightBundleStatuses('https://mainnet.block-engine.jito.wtf', result.value)
    console.log(`Poll ${i + 1}:`, JSON.stringify(inflight))
    if (inflight.length > 0 && inflight[0].status !== 'Pending') break
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
