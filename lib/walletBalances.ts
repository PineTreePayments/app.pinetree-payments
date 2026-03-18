export async function getSolanaBalance(address: string): Promise<number> {
  try {
    if (!address) return 0

    const res = await fetch("/api/wallet-balance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address,
        network: "solana",
      }),
    })

    if (!res.ok) {
      console.error("Solana API error")
      return 0
    }

    const data = await res.json()

    return Number(data?.balance ?? 0)
  } catch (err) {
    console.error("Solana balance error:", err)
    return 0
  }
}

export async function getEthereumBalance(address: string): Promise<number> {
  try {
    if (!address) return 0

    const res = await fetch("/api/wallet-balance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address,
        network: "base", // change to "ethereum" later if needed
      }),
    })

    if (!res.ok) {
      console.error("Ethereum API error")
      return 0
    }

    const data = await res.json()

    return Number(data?.balance ?? 0)
  } catch (err) {
    console.error("Ethereum balance error:", err)
    return 0
  }
}