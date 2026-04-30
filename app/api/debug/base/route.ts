import { NextRequest } from "next/server"

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { stage?: unknown; payload?: unknown }
  const stage = String(body.stage ?? "unknown")
  const payload = body.payload != null && typeof body.payload === "object"
    ? body.payload
    : {}

  console.log("[BASE DEBUG]", stage, JSON.stringify(payload))

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  })
}