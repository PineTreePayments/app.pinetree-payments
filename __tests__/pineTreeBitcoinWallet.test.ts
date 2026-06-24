import fs from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

// Prevent Supabase from requiring env vars at import time
vi.mock("@/database/supabase", () => ({
  supabase: {},
  supabaseAdmin: null,
}))

import { inferBtcAddressType, normalizeBtcAddressType } from "@/database/pineTreeWalletProfiles"
import { extractDynamicWalletAddresses } from "@/lib/wallets/sparkDetection"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

// ---------------------------------------------------------------------------
// inferBtcAddressType
// ---------------------------------------------------------------------------

describe("inferBtcAddressType", () => {
  it("detects Taproot mainnet address (bc1p)", () => {
    expect(inferBtcAddressType("bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297")).toBe("taproot")
    expect(inferBtcAddressType("bc1pmerchantpayoutaddresstest")).toBe("taproot")
  })

  it("detects Taproot testnet address (tb1p)", () => {
    expect(inferBtcAddressType("tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq47zczz")).toBe("taproot")
  })

  it("detects Native SegWit mainnet address (bc1q)", () => {
    expect(inferBtcAddressType("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBe("native_segwit")
    expect(inferBtcAddressType("bc1qmerchantpayoutaddresstest")).toBe("native_segwit")
  })

  it("detects Native SegWit testnet address (tb1q)", () => {
    expect(inferBtcAddressType("tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7")).toBe("native_segwit")
  })

  it("detects Legacy address (starts with 1)", () => {
    expect(inferBtcAddressType("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).toBe("legacy")
    expect(inferBtcAddressType("1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf1")).toBe("legacy")
  })

  it("detects Nested SegWit address (starts with 3)", () => {
    expect(inferBtcAddressType("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBe("nested_segwit")
    expect(inferBtcAddressType("3FZbgi29cpjq2GjdwV8eyHuJJnkLtktZc5")).toBe("nested_segwit")
  })

  it("returns unknown for unrecognized formats", () => {
    expect(inferBtcAddressType("bc2punknown")).toBe("unknown")
    expect(inferBtcAddressType("ltc1qmerchant")).toBe("unknown")
    expect(inferBtcAddressType("")).toBe("unknown")
    expect(inferBtcAddressType(null)).toBe("unknown")
    expect(inferBtcAddressType(undefined)).toBe("unknown")
  })

  it("is not confused by case — bc1P should still detect as taproot", () => {
    // inferBtcAddressType lowercases before checking
    expect(inferBtcAddressType("BC1P5D7RJQ7G6RDK2YHZKS9")).toBe("taproot")
    expect(inferBtcAddressType("BC1Q")).toBe("native_segwit")
  })
})

// ---------------------------------------------------------------------------
// normalizeBtcAddressType
// ---------------------------------------------------------------------------

describe("normalizeBtcAddressType", () => {
  it("normalizes legacy variants to 'legacy'", () => {
    expect(normalizeBtcAddressType("legacy")).toBe("legacy")
    expect(normalizeBtcAddressType("p2pkh")).toBe("legacy")
    expect(normalizeBtcAddressType("LEGACY")).toBe("legacy")
  })

  it("normalizes nested_segwit variants to 'nested_segwit'", () => {
    expect(normalizeBtcAddressType("nested_segwit")).toBe("nested_segwit")
    expect(normalizeBtcAddressType("nested-segwit")).toBe("nested_segwit")
    expect(normalizeBtcAddressType("p2sh")).toBe("nested_segwit")
    expect(normalizeBtcAddressType("p2sh_p2wpkh")).toBe("nested_segwit")
  })

  it("still normalizes taproot and native_segwit correctly", () => {
    expect(normalizeBtcAddressType("taproot")).toBe("taproot")
    expect(normalizeBtcAddressType("p2tr")).toBe("taproot")
    expect(normalizeBtcAddressType("native_segwit")).toBe("native_segwit")
    expect(normalizeBtcAddressType("bech32")).toBe("native_segwit")
    expect(normalizeBtcAddressType("p2wpkh")).toBe("native_segwit")
  })

  it("returns unknown for unrecognized strings", () => {
    expect(normalizeBtcAddressType("")).toBe("unknown")
    expect(normalizeBtcAddressType(null)).toBe("unknown")
    expect(normalizeBtcAddressType(undefined)).toBe("unknown")
    expect(normalizeBtcAddressType("lightning")).toBe("unknown")
  })
})

// ---------------------------------------------------------------------------
// Bitcoin address extraction from Dynamic SDK wallet objects
// ---------------------------------------------------------------------------

describe("Bitcoin address extraction from Dynamic SDK", () => {
  it("extracts a Bitcoin address when Dynamic returns a BTC chain wallet", () => {
    const groups = extractDynamicWalletAddresses([
      {
        id: "btc-embedded",
        chain: "BTC",
        key: "bitcoin",
        address: "bc1ptestmerchantpayoutaddress",
        connector: { name: "BitcoinWalletConnector", key: "bitcoin" },
      },
    ])
    expect(groups.bitcoin).toEqual([
      { id: "btc-embedded", address: "bc1ptestmerchantpayoutaddress" },
    ])
    expect(groups.lightning).toEqual([])
  })

  it("extracts Native SegWit Bitcoin address from Dynamic embedded wallet", () => {
    const groups = extractDynamicWalletAddresses([
      {
        id: "btc-waas",
        chain: "BTC",
        key: "dynamicwaas_bitcoin",
        address: "bc1qmerchantreceiveaddress",
        connector: { name: "DynamicWaas", key: "dynamicwaas" },
      },
    ])
    expect(groups.bitcoin).toEqual([
      { id: "btc-waas", address: "bc1qmerchantreceiveaddress" },
    ])
  })

  it("extracts Bitcoin from additionalAddresses of a multi-address embedded wallet", () => {
    const groups = extractDynamicWalletAddresses([
      {
        id: "evm-wallet",
        chain: "EVM",
        key: "evm",
        address: "0xbaseaddress",
        connector: { name: "Ethereum", key: "ethereum" },
        additionalAddresses: [
          {
            address: "bc1ptestbitcoinaddress",
            chain: "BTC",
            addressType: "taproot",
          },
        ],
      },
    ])
    expect(groups.bitcoin).toEqual([
      expect.objectContaining({ address: "bc1ptestbitcoinaddress" }),
    ])
    expect(groups.base).toEqual([{ id: "evm-wallet", address: "0xbaseaddress" }])
  })

  it("returns empty bitcoin group when Dynamic does not provision a Bitcoin wallet", () => {
    const groups = extractDynamicWalletAddresses([
      {
        id: "evm-wallet",
        chain: "EVM",
        key: "evm",
        address: "0xbaseaddress",
        connector: { name: "Ethereum" },
      },
      {
        id: "sol-wallet",
        chain: "SOL",
        key: "sol",
        address: "solana-address",
        connector: { name: "Solana" },
      },
    ])
    expect(groups.bitcoin).toEqual([])
    expect(groups.base.length).toBe(1)
    expect(groups.solana.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Payout safety — payout worker requires btc_address and btc_payout_enabled
// ---------------------------------------------------------------------------

describe("Lightning payout worker safety guards", () => {
  const payoutEngine = read("engine/lightningPayouts.ts")

  it("payout worker reads btc_address from the merchant wallet profile before sending", () => {
    expect(payoutEngine).toContain("getPineTreeWalletProfile")
    expect(payoutEngine).toContain("profile?.btc_address")
    expect(payoutEngine).toContain("profile?.btc_payout_enabled")
  })

  it("payout worker throws if btc_payout_enabled is false or btc_address is missing", () => {
    expect(payoutEngine).toContain("!profile?.btc_payout_enabled || !btcAddress")
    expect(payoutEngine).toContain("BTC payout address is required before Lightning payout can process")
  })

  it("payout worker requires payment to be CONFIRMED before sending", () => {
    expect(payoutEngine).toContain("Cannot process Lightning payout before payment is confirmed")
  })
})

// ---------------------------------------------------------------------------
// Sync safety — syncProfileFromDynamic must not clear btc_address when
// Dynamic does not return a Bitcoin wallet
// ---------------------------------------------------------------------------

describe("syncProfileFromDynamic BTC address safety", () => {
  const page = read("app/dashboard/wallet-setup/page.tsx")

  it("only includes btc_address in the sync body when Dynamic returned a Bitcoin address", () => {
    // The spread conditional ensures btc_address is omitted from the body when null
    expect(page).toContain("bitcoinAddress !== null && {")
    expect(page).toContain("btc_address: bitcoinAddress,")
  })

  it("includes a comment explaining why btc_address is conditionally included", () => {
    expect(page).toContain("Omitting the field preserves a previously saved btc_address")
  })
})

// ---------------------------------------------------------------------------
// upsertPineTreeWalletProfile merge logic — omitted btcAddress preserves existing
// ---------------------------------------------------------------------------

describe("upsertPineTreeWalletProfile merge safety", () => {
  const dbHelper = read("database/pineTreeWalletProfiles.ts")

  it("preserves existing btc_address when btcAddress input is undefined (not included in body)", () => {
    expect(dbHelper).toContain("btc_address: input.btcAddress !== undefined ? input.btcAddress : existing?.btc_address ?? null,")
  })

  it("btc_payout_enabled is set by server-side BTC provisioning when an address exists", () => {
    const apiRoute = read("app/api/wallets/pinetree-profile/route.ts")
    expect(apiRoute).toContain("provisionMerchantBitcoinAddress")
    expect(apiRoute).toContain("btcPayoutEnabled: btcAddressIsReady || btcAddressAlreadyExists ? true : undefined,")
  })
})

// ---------------------------------------------------------------------------
// ReceiveRow UI — does not show Ready when no address exists
// ---------------------------------------------------------------------------

describe("ReceiveRow status display", () => {
  const page = read("app/dashboard/wallet-setup/page.tsx")

  it("ReceiveRow shows Ready only when entries are present", () => {
    expect(page).toContain("const isReady = entries.length > 0")
    expect(page).toContain('isReady ? "Ready" : "Address syncing"')
    expect(page).toContain('isReady ? "green" : "blue"')
  })

  it("ReceiveRow renders address entries and copy button only when isReady", () => {
    expect(page).toContain("{isReady ? (")
    expect(page).toContain("{entry.address}")
    expect(page).toContain('aria-label={`Copy ${label}`}')
  })

  it("Bitcoin receive row uses btc_address (payout address), not bitcoin_onchain_address", () => {
    expect(page).toContain("bitcoinPayoutEntries")
    expect(page).toContain("profile.btc_address")
    expect(page).toContain('<ReceiveRow label="Bitcoin wallet" entries={bitcoinPayoutEntries}')
  })

  it("Bitcoin receive row shows Address syncing only when btc_address is missing", () => {
    expect(page).toContain("const bitcoinPayoutEntries: AddressEntry[] = profile?.btc_address")
    expect(page).toContain('isReady ? "Ready" : "Address syncing"')
  })
})

// ---------------------------------------------------------------------------
// Main PineTree Wallet rail pills
// ---------------------------------------------------------------------------

describe("PineTree Wallet setup card rail pills", () => {
  const page = read("app/dashboard/wallet-setup/page.tsx")

  it("renders compact polished rail pills with a ready dot", () => {
    expect(page).toContain('aria-label="Supported rails"')
    expect(page).toContain("border border-blue-200/80 bg-blue-50/80")
    expect(page).toContain("bg-emerald-500")
    expect(page).toContain('aria-hidden="true"')
  })
})

// ---------------------------------------------------------------------------
// Internal BTC address setter route
// ---------------------------------------------------------------------------

describe("internal PineTree BTC address setter route", () => {
  const route = read("app/api/internal/wallets/pinetree/btc-address/route.ts")

  it("exists at the internal BTC address route and is protected by INTERNAL_API_SECRET", () => {
    expect(route).toContain("POST /api/internal/wallets/pinetree/btc-address")
    expect(route).toContain("INTERNAL_API_SECRET")
    expect(route).toContain("return bearer === secret")
  })

  it("accepts merchant_id, btc_address, provider, and optional btc_address_type", () => {
    expect(route).toContain("merchant_id is required")
    expect(route).toContain("btc_address is required")
    expect(route).toContain("btc_wallet_provider")
    expect(route).toContain("btc_address_type")
  })

  it("saves btc_address and enables BTC payout", () => {
    expect(route).toContain("btcAddress: rawAddress")
    expect(route).toContain("btcWalletProvider")
    expect(route).toContain("btcPayoutEnabled: true")
    expect(route).toContain("btcPayoutVerifiedAt: new Date().toISOString()")
  })

  it("detects bc1p as taproot and bc1q as native_segwit through inferBtcAddressType", () => {
    expect(route).toContain("inferBtcAddressType(rawAddress)")
    expect(inferBtcAddressType("bc1pmerchantpayoutaddresstest")).toBe("taproot")
    expect(inferBtcAddressType("bc1qmerchantpayoutaddresstest")).toBe("native_segwit")
  })
})

describe("internal PineTree wallet debug profile route", () => {
  const route = read("app/api/internal/wallets/pinetree/debug-profile/route.ts")

  it("is protected by INTERNAL_API_SECRET", () => {
    expect(route).toContain("INTERNAL_API_SECRET")
    expect(route).toContain("return bearer === secret")
    expect(route).toContain("Unauthorized")
  })

  it("returns only safe profile diagnostics", () => {
    expect(route).toContain("profile_exists")
    expect(route).toContain("base_address_present")
    expect(route).toContain("solana_address_present")
    expect(route).toContain("btc_address_present")
    expect(route).toContain("btc_wallet_provisioning_status")
    expect(route).toContain("btc_wallet_provisioning_error")
    expect(route).not.toContain("base_address:")
    expect(route).not.toContain("solana_address:")
    expect(route).not.toContain("btc_address:")
  })
})

// ---------------------------------------------------------------------------
// DB and migration references include the new address type values
// ---------------------------------------------------------------------------

describe("BtcAddressType coverage in schema and helpers", () => {
  const dbHelper = read("database/pineTreeWalletProfiles.ts")
  const migration = read("database/migrations/20260623_expand_btc_address_type_constraint.sql")

  it("BtcAddressType includes legacy and nested_segwit", () => {
    expect(dbHelper).toContain('"legacy"')
    expect(dbHelper).toContain('"nested_segwit"')
    expect(dbHelper).toContain('"taproot"')
    expect(dbHelper).toContain('"native_segwit"')
    expect(dbHelper).toContain('"unknown"')
  })

  it("migration expands the check constraint to include legacy and nested_segwit", () => {
    expect(migration).toContain("'legacy'")
    expect(migration).toContain("'nested_segwit'")
    expect(migration).toContain("DROP CONSTRAINT")
    expect(migration).toContain("ADD CONSTRAINT")
  })
})
