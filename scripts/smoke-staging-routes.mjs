#!/usr/bin/env node

const baseUrl = String(
  process.env.SMOKE_TARGET_URL ||
  process.env.PINETREE_INTEGRATION_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000"
).replace(/\/$/, "")

async function request(path, init) {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      redirect: "manual",
      ...init,
    })
    return { ok: true, status: response.status }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const checks = [
  {
    label: "Developer dashboard responds",
    run: () => request("/dashboard/developer"),
    accept: (result) => result.ok && [200, 302, 307, 308].includes(result.status),
  },
  {
    label: "Shopify status is auth-protected",
    run: () => request("/api/shopify/status"),
    accept: (result) => result.ok && result.status === 401,
  },
  {
    label: "Shopify auth fails safely without merchant auth or configuration",
    run: () => request("/api/shopify/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop: "smoke-test.myshopify.com" }),
    }),
    accept: (result) => result.ok && [401, 503].includes(result.status),
  },
  {
    label: "Public key API is auth-protected",
    run: () => request("/api/merchant/public-keys"),
    accept: (result) => result.ok && result.status === 401,
  },
  {
    label: "Secret key API is auth-protected",
    run: () => request("/api/merchant/api-keys"),
    accept: (result) => result.ok && result.status === 401,
  },
]

console.log(`PineTree staging route smoke: ${baseUrl}`)
let failed = 0
for (const check of checks) {
  const result = await check.run()
  if (check.accept(result)) {
    console.log(`  OK    ${check.label} (${result.status})`)
  } else {
    failed += 1
    console.error(`  FAIL  ${check.label} (${result.status ?? result.error})`)
  }
}

process.exit(failed === 0 ? 0 : 1)
