import { supabase } from "@/lib/database/supabase"

type ReportInput = {
merchantId: string
startDate: string
endDate: string
}

export async function generateReport(input: ReportInput) {

const { data, error } = await supabase
.from("payments")
.select(`
id,
subtotal_amount,
platform_fee,
total_amount,
currency,
created_at,
transactions (
status,
provider,
network,
channel
)
`)
.eq("merchant_id", input.merchantId)
.gte("created_at", input.startDate)
.lte("created_at", input.endDate)

if (error) {
throw new Error(error.message)
}

let totalVolume = 0
let platformFeesInternal = 0
let transactionCount = 0
let failedPayments = 0

const providerTotals: Record<string, number> = {}
const channelTotals: Record<string, number> = {}
const networkTotals: Record<string, number> = {}

const transactionsTable:any[] = []

for (const payment of data) {

const tx = payment.transactions?.[0]
if (!tx) continue

if (tx.status !== "CONFIRMED") {
failedPayments++
continue
}

transactionCount++

totalVolume += payment.total_amount
platformFeesInternal += payment.platform_fee

const provider = tx.provider || "unknown"
const channel = tx.channel || "unknown"
const network = tx.network || "unknown"

if (!providerTotals[provider]) providerTotals[provider] = 0
providerTotals[provider] += payment.total_amount

if (!channelTotals[channel]) channelTotals[channel] = 0
channelTotals[channel] += payment.total_amount

if (!networkTotals[network]) networkTotals[network] = 0
networkTotals[network] += payment.total_amount

transactionsTable.push({
date: payment.created_at,
provider,
channel,
network,
amount: payment.total_amount
})

}

const merchantNet = totalVolume - platformFeesInternal

const avgTransaction =
transactionCount > 0
? totalVolume / transactionCount
: 0

const estimatedTax = merchantNet * 0.07

return {

totalVolume,
merchantNet,
estimatedTax,
transactionCount,
avgTransaction,
failedPayments,

providerTotals,
channelTotals,
networkTotals,

transactionsTable

}

}