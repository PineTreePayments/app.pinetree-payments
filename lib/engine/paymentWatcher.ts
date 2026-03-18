import { supabase } from "@/lib/database/supabase"

type WatchInput = {
  merchantWallet: string
  pinetreeWallet: string
  merchantAmount: number
  pinetreeFee: number
  network: string
  paymentId: string
}

const POLL_INTERVAL = 4000
const MAX_ATTEMPTS = 300

export async function watchPayment(input: WatchInput) {

  let attempts = 0

  const merchantWallet = input.merchantWallet.toLowerCase()
  const pinetreeWallet = input.pinetreeWallet.toLowerCase()

  /* ---------------------------
  SELECT RPC BASED ON NETWORK
  --------------------------- */

  let rpcUrl = ""

  if (input.network === "base") {
    rpcUrl =
      process.env.BASE_RPC_URL ||
      "https://mainnet.base.org"
  }

  if (!rpcUrl) {
    throw new Error("No RPC configured for network")
  }

  /* ---------------------------
  GET CURRENT BLOCK HEIGHT
  --------------------------- */

  const blockResponse = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_blockNumber",
      params: [],
      id: 1
    })
  })

  const blockData = await blockResponse.json()
  let lastCheckedBlock = parseInt(blockData.result, 16)

  /* ---------------------------
  WATCH LOOP
  --------------------------- */

  while (attempts < MAX_ATTEMPTS) {

    try {

      const latestBlockResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_blockNumber",
          params: [],
          id: 1
        })
      })

      const latestBlockData = await latestBlockResponse.json()
      const latestBlock = parseInt(latestBlockData.result, 16)

      for (let blockNumber = lastCheckedBlock; blockNumber <= latestBlock; blockNumber++) {

        const blockHex = "0x" + blockNumber.toString(16)

        const blockResponse = await fetch(rpcUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getBlockByNumber",
            params: [blockHex, true],
            id: 1
          })
        })

        const block = await blockResponse.json()
        const transactions = block?.result?.transactions || []

        for (const tx of transactions) {

          if (!tx?.to) continue

          const to = tx.to.toLowerCase()

          if (
            to !== merchantWallet &&
            to !== pinetreeWallet
          ) {
            continue
          }

          const valueWei = BigInt(tx.value)
          const valueEth = Number(valueWei) / 1e18

          if (valueEth >= input.merchantAmount) {

            /* ---------------------------
            CHECK IF ALREADY CONFIRMED
            --------------------------- */

            const { data: existing } = await supabase
              .from("payments")
              .select("status")
              .eq("id", input.paymentId)
              .single()

            if (existing?.status === "CONFIRMED") {
              return true
            }

            /* ---------------------------
            UPDATE PAYMENT
            --------------------------- */

            await supabase
              .from("payments")
              .update({
                status: "CONFIRMED"
              })
              .eq("id", input.paymentId)

            /* ---------------------------
            UPDATE TRANSACTION
            --------------------------- */

            await supabase
              .from("transactions")
              .update({
                status: "CONFIRMED",
                provider_transaction_id: tx.hash
              })
              .eq("payment_id", input.paymentId)

            return true
          }

        }

      }

      lastCheckedBlock = latestBlock + 1

    } catch (error) {

      console.error("Watcher error:", error)

    }

    attempts++

    await new Promise((resolve) =>
      setTimeout(resolve, POLL_INTERVAL)
    )

  }

  /* ---------------------------
  MARK FAILED
  --------------------------- */

  await supabase
    .from("payments")
    .update({
      status: "FAILED"
    })
    .eq("id", input.paymentId)

  return false
}