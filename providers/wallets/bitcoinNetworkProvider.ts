import { address, networks, Psbt, Transaction, type Network } from "bitcoinjs-lib"

export type BitcoinNetworkName = "mainnet" | "testnet"

export type BitcoinUtxo = {
  txid: string
  vout: number
  value: number
  status?: { confirmed?: boolean }
}

export type BitcoinFeeEstimate = {
  fastestFee?: number
  halfHourFee?: number
  hourFee?: number
  economyFee?: number
  minimumFee?: number
}

export type BitcoinProviderConfig = {
  networkName: BitcoinNetworkName
  network: Network
  esploraBaseUrl: string
  broadcastEnabled: boolean
}

export type BitcoinPsbtBuildResult = {
  psbtBase64: string
  sourceAddress: string
  destinationAddress: string
  amountSats: number
  feeSats: number
  changeSats: number
  inputTotalSats: number
  utxoCount: number
  selectedUtxos: BitcoinUtxo[]
  network: BitcoinNetworkName
}

const DUST_SATS = 546

export function getBitcoinProviderConfig(): BitcoinProviderConfig | null {
  const provider = String(process.env.BITCOIN_UTXO_PROVIDER || "").trim().toLowerCase()
  const esploraBaseUrl = String(process.env.BITCOIN_ESPLORA_BASE_URL || "").trim().replace(/\/$/, "")
  if (provider !== "esplora" || !esploraBaseUrl) return null

  const networkName = normalizeBitcoinNetworkName(process.env.BITCOIN_NETWORK)
  return {
    networkName,
    network: networkName === "testnet" ? networks.testnet : networks.bitcoin,
    esploraBaseUrl,
    broadcastEnabled: String(process.env.BITCOIN_BROADCAST_ENABLED || "").trim().toLowerCase() === "true",
  }
}

export function isBitcoinWithdrawalExecutionConfigured() {
  const config = getBitcoinProviderConfig()
  return Boolean(config?.broadcastEnabled)
}

export function getConfiguredBitcoinNetworkName() {
  return normalizeBitcoinNetworkName(process.env.BITCOIN_NETWORK)
}

export function getConfiguredBitcoinNetwork() {
  return getConfiguredBitcoinNetworkName() === "testnet" ? networks.testnet : networks.bitcoin
}

export function validateBitcoinAddressForConfiguredNetwork(value: string) {
  try {
    address.toOutputScript(value, getConfiguredBitcoinNetwork())
    return true
  } catch {
    return false
  }
}

export function parseBtcToSats(value: string) {
  const trimmed = value.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw Object.assign(new Error("Withdrawal amount must be positive."), { status: 400 })
  }
  const [whole, fraction = ""] = trimmed.split(".")
  if (fraction.length > 8) {
    throw Object.assign(new Error("Withdrawal amount has too many decimal places."), { status: 400 })
  }
  const sats = BigInt(whole) * BigInt(100_000_000) + BigInt(fraction.padEnd(8, "0") || "0")
  if (sats > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw Object.assign(new Error("Withdrawal amount is too large."), { status: 400 })
  }
  return Number(sats)
}

export async function buildBitcoinWithdrawalPsbt(input: {
  sourceAddress: string
  sourceAddressType?: string | null
  destinationAddress: string
  amountDecimal: string
}): Promise<BitcoinPsbtBuildResult> {
  const config = getBitcoinProviderConfig()
  if (!config?.broadcastEnabled) {
    throw Object.assign(new Error("Withdrawal request is pending review."), { status: 409 })
  }

  if (!validateBitcoinAddress(input.sourceAddress, config.network)) {
    throw Object.assign(new Error("PineTree Wallet source address is not available."), { status: 409 })
  }
  if (!validateBitcoinAddress(input.destinationAddress, config.network)) {
    throw Object.assign(new Error("Destination address is invalid for the selected rail."), { status: 400 })
  }
  if (!isSupportedSigningSourceType(input.sourceAddressType, input.sourceAddress)) {
    throw Object.assign(new Error("Withdrawal request is pending review."), { status: 409 })
  }

  const amountSats = parseBtcToSats(input.amountDecimal)
  if (amountSats < DUST_SATS) {
    throw Object.assign(new Error("Withdrawal amount is below the Bitcoin dust threshold."), { status: 400 })
  }

  const [utxos, fees] = await Promise.all([
    fetchEsploraUtxos(config, input.sourceAddress),
    fetchEsploraFeeEstimates(config),
  ])
  const spendableUtxos = utxos.filter((utxo) => utxo.status?.confirmed !== false)
  if (!spendableUtxos.length) {
    throw Object.assign(new Error("No spendable Bitcoin UTXOs are available."), { status: 409 })
  }

  const feeRate = Math.max(1, Math.ceil(fees.halfHourFee || fees.hourFee || fees.fastestFee || fees.minimumFee || 1))
  const selected = selectUtxos(spendableUtxos, amountSats, feeRate)
  const sourceScript = address.toOutputScript(input.sourceAddress, config.network)
  const psbt = new Psbt({ network: config.network })

  for (const utxo of selected.selectedUtxos) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      sequence: 0xfffffffd,
      witnessUtxo: {
        script: sourceScript,
        value: utxo.value,
      },
    })
  }

  psbt.addOutput({
    address: input.destinationAddress,
    value: amountSats,
  })
  if (selected.changeSats >= DUST_SATS) {
    psbt.addOutput({
      address: input.sourceAddress,
      value: selected.changeSats,
    })
  }

  return {
    psbtBase64: psbt.toBase64(),
    sourceAddress: input.sourceAddress,
    destinationAddress: input.destinationAddress,
    amountSats,
    feeSats: selected.feeSats,
    changeSats: selected.changeSats >= DUST_SATS ? selected.changeSats : 0,
    inputTotalSats: selected.inputTotalSats,
    utxoCount: selected.selectedUtxos.length,
    selectedUtxos: selected.selectedUtxos,
    network: config.networkName,
  }
}

export async function finalizeAndBroadcastBitcoinPsbt(input: {
  signedPsbtBase64: string
  preparedPayload: Record<string, unknown>
}) {
  const config = getBitcoinProviderConfig()
  if (!config?.broadcastEnabled) {
    throw Object.assign(new Error("Withdrawal request is pending review."), { status: 409 })
  }

  const unsignedPsbtBase64 = String(input.preparedPayload.psbtBase64 || "")
  const sourceAddress = String(input.preparedPayload.sourceAddress || "")
  const destinationAddress = String(input.preparedPayload.destinationAddress || "")
  const amountSats = Number(input.preparedPayload.amountSats || 0)
  const changeSats = Number(input.preparedPayload.changeSats || 0)

  const unsignedPsbt = Psbt.fromBase64(unsignedPsbtBase64, { network: config.network })
  const signedPsbt = Psbt.fromBase64(input.signedPsbtBase64, { network: config.network })
  assertSignedPsbtMatchesPrepared({
    unsignedPsbt,
    signedPsbt,
    sourceAddress,
    destinationAddress,
    amountSats,
    changeSats,
    network: config.network,
  })

  signedPsbt.finalizeAllInputs()
  const tx = signedPsbt.extractTransaction()
  assertFinalTxMatchesPrepared({
    tx,
    destinationAddress,
    amountSats,
    sourceAddress,
    changeSats,
    network: config.network,
  })

  const rawTxHex = tx.toHex()
  const txid = await broadcastEsploraTransaction(config, rawTxHex)
  if (!/^[a-fA-F0-9]{64}$/.test(txid)) {
    throw Object.assign(new Error("Bitcoin broadcaster returned an invalid transaction id."), { status: 502 })
  }

  return { txid, rawTxHex }
}

function normalizeBitcoinNetworkName(value?: string | null): BitcoinNetworkName {
  return String(value || "").trim().toLowerCase() === "testnet" ? "testnet" : "mainnet"
}

function validateBitcoinAddress(value: string, network: Network) {
  try {
    address.toOutputScript(value, network)
    return true
  } catch {
    return false
  }
}

function isSupportedSigningSourceType(type: string | null | undefined, addressValue: string) {
  const normalized = String(type || "").toLowerCase()
  if (normalized === "native_segwit") return true
  if (!normalized || normalized === "unknown") return addressValue.toLowerCase().startsWith("bc1q") || addressValue.toLowerCase().startsWith("tb1q")
  return false
}

async function fetchEsploraUtxos(config: BitcoinProviderConfig, sourceAddress: string): Promise<BitcoinUtxo[]> {
  const response = await fetch(`${config.esploraBaseUrl}/address/${encodeURIComponent(sourceAddress)}/utxo`, {
    method: "GET",
    headers: { Accept: "application/json" },
  })
  if (!response.ok) {
    throw Object.assign(new Error("Failed to fetch Bitcoin UTXOs."), { status: 502 })
  }
  const data = await response.json()
  if (!Array.isArray(data)) return []
  return data.flatMap((item) => {
    const txid = String(item?.txid || "")
    const vout = Number(item?.vout)
    const value = Number(item?.value)
    if (!/^[a-fA-F0-9]{64}$/.test(txid) || !Number.isInteger(vout) || vout < 0 || !Number.isInteger(value) || value <= 0) {
      return []
    }
    return [{ txid, vout, value, status: item?.status }]
  })
}

async function fetchEsploraFeeEstimates(config: BitcoinProviderConfig): Promise<BitcoinFeeEstimate> {
  const response = await fetch(`${config.esploraBaseUrl}/fee-estimates`, {
    method: "GET",
    headers: { Accept: "application/json" },
  })
  if (!response.ok) return { minimumFee: 1 }
  const data = await response.json()
  return {
    fastestFee: Number(data?.["1"]) || undefined,
    halfHourFee: Number(data?.["3"]) || undefined,
    hourFee: Number(data?.["6"]) || undefined,
    economyFee: Number(data?.["144"]) || undefined,
    minimumFee: Number(data?.["504"]) || undefined,
  }
}

async function broadcastEsploraTransaction(config: BitcoinProviderConfig, rawTxHex: string) {
  const response = await fetch(`${config.esploraBaseUrl}/tx`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: rawTxHex,
  })
  const text = (await response.text()).trim()
  if (!response.ok) {
    throw Object.assign(new Error("Failed to broadcast Bitcoin transaction."), { status: 502 })
  }
  return text
}

function selectUtxos(utxos: BitcoinUtxo[], amountSats: number, feeRate: number) {
  const selectedUtxos: BitcoinUtxo[] = []
  const sorted = [...utxos].sort((a, b) => b.value - a.value)

  for (const utxo of sorted) {
    selectedUtxos.push(utxo)
    const inputTotalSats = selectedUtxos.reduce((sum, item) => sum + item.value, 0)
    const feeWithChange = estimateP2wpkhFee(selectedUtxos.length, 2, feeRate)
    const changeWithFee = inputTotalSats - amountSats - feeWithChange
    if (changeWithFee >= DUST_SATS) {
      return { selectedUtxos, inputTotalSats, feeSats: feeWithChange, changeSats: changeWithFee }
    }
    const feeNoChange = estimateP2wpkhFee(selectedUtxos.length, 1, feeRate)
    const changeNoOutput = inputTotalSats - amountSats - feeNoChange
    if (changeNoOutput >= 0) {
      return { selectedUtxos, inputTotalSats, feeSats: inputTotalSats - amountSats, changeSats: 0 }
    }
  }

  throw Object.assign(new Error("Withdrawal amount exceeds spendable Bitcoin balance after fees."), { status: 400 })
}

function estimateP2wpkhFee(inputCount: number, outputCount: number, feeRate: number) {
  return Math.ceil((10 + inputCount * 68 + outputCount * 31) * feeRate)
}

function assertSignedPsbtMatchesPrepared(input: {
  unsignedPsbt: Psbt
  signedPsbt: Psbt
  sourceAddress: string
  destinationAddress: string
  amountSats: number
  changeSats: number
  network: Network
}) {
  const unsignedInputs = input.unsignedPsbt.txInputs.map((txInput) => `${Buffer.from(txInput.hash).reverse().toString("hex")}:${txInput.index}`)
  const signedInputs = input.signedPsbt.txInputs.map((txInput) => `${Buffer.from(txInput.hash).reverse().toString("hex")}:${txInput.index}`)
  if (unsignedInputs.join("|") !== signedInputs.join("|")) {
    throw Object.assign(new Error("Signed PSBT does not match the prepared withdrawal."), { status: 400 })
  }
  assertPsbtOutputs(input.signedPsbt, input)
}

function assertPsbtOutputs(psbt: Psbt, input: {
  sourceAddress: string
  destinationAddress: string
  amountSats: number
  changeSats: number
  network: Network
}) {
  const outputs = psbt.txOutputs.map((output) => ({
    address: safeOutputAddress(output.script, input.network),
    value: output.value,
  }))
  const destination = outputs.find((output) => output.address === input.destinationAddress && output.value === input.amountSats)
  if (!destination) {
    throw Object.assign(new Error("Signed PSBT does not match the prepared withdrawal."), { status: 400 })
  }
  if (input.changeSats > 0) {
    const change = outputs.find((output) => output.address === input.sourceAddress && output.value === input.changeSats)
    if (!change) {
      throw Object.assign(new Error("Signed PSBT does not return change to the PineTree Wallet."), { status: 400 })
    }
  }
}

function assertFinalTxMatchesPrepared(input: {
  tx: Transaction
  destinationAddress: string
  amountSats: number
  sourceAddress: string
  changeSats: number
  network: Network
}) {
  const outputs = input.tx.outs.map((output) => ({
    address: safeOutputAddress(output.script, input.network),
    value: output.value,
  }))
  if (!outputs.some((output) => output.address === input.destinationAddress && output.value === input.amountSats)) {
    throw Object.assign(new Error("Final Bitcoin transaction does not match the prepared withdrawal."), { status: 400 })
  }
  if (input.changeSats > 0 && !outputs.some((output) => output.address === input.sourceAddress && output.value === input.changeSats)) {
    throw Object.assign(new Error("Final Bitcoin transaction does not return change to the PineTree Wallet."), { status: 400 })
  }
}

function safeOutputAddress(script: Buffer, network: Network) {
  try {
    return address.fromOutputScript(script, network)
  } catch {
    return null
  }
}
