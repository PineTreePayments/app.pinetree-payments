import { processWebhook } from "@/lib/engine/webhookProcessor"

export async function POST(req: Request) {

  const payload = await req.json()

  await processWebhook({
  provider: "coinbase",
  payload
})

  return Response.json({ received: true })

}