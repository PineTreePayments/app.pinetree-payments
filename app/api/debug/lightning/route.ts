import { NextRequest } from "next/server"

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  }

  const body = (await req.json()) as { stage?: unknown; payload?: unknown }
  const stage = String(body.stage ?? "unknown")
  const payload = body.payload != null && typeof body.payload === "object"
    ? body.payload
    : {}

  console.log("[LIGHTNING DEBUG]", stage, JSON.stringify(payload))

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  })
}
