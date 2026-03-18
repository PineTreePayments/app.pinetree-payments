export async function loadProviders() {

  await import("../providers/coinbase")
  await import("../providers/shift4")
  await import("../providers/solana")


}