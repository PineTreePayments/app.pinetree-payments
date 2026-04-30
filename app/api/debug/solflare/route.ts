import { NextRequest } from "next/server"

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { stage?: unknown; payload?: unknown }
  const stage = String(body.stage ?? "unknown")
  // Only log safe diagnostic fields — no keys, encrypted data, or session tokens
  const payload = body.payload != null && typeof body.payload === "object"
    ? body.payload
    : {}
  console.log("[SOLFLARE DEBUG]", stage, JSON.stringify(payload))
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  })
}
