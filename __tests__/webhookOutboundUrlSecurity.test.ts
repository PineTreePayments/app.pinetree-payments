import { describe, expect, it, vi } from "vitest"
import {
  assertSafeWebhookUrl,
  isPublicIpAddress,
  parseWebhookUrl,
} from "@/lib/webhooks/outboundUrl"

describe("merchant webhook outbound URL security", () => {
  it("accepts public HTTPS destinations whose DNS answers are all public", async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ])
    await expect(assertSafeWebhookUrl("https://hooks.merchant.com/pinetree", lookup)).resolves.toMatchObject({
      protocol: "https:",
      hostname: "hooks.merchant.com",
    })
  })

  it.each([
    "http://hooks.merchant.com/pinetree",
    "https://user:password@hooks.merchant.com/pinetree",
    "https://localhost/webhook",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://127.0.0.1/webhook",
    "https://169.254.169.254/latest/meta-data/",
    "https://10.0.0.1/webhook",
    "https://[::1]/webhook",
    "https://[::ffff:127.0.0.1]/webhook",
    "https://[::ffff:10.0.0.1]/webhook",
  ])("rejects unsafe destination %s", (url) => {
    expect(() => parseWebhookUrl(url)).toThrow()
  })

  it("rejects a public hostname when any DNS answer is private", async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ])
    await expect(assertSafeWebhookUrl("https://hooks.merchant.com/pinetree", lookup)).rejects.toThrow(
      "resolve only to public addresses",
    )
  })

  it.each([
    ["8.8.8.8", true],
    ["10.0.0.1", false],
    ["172.16.0.1", false],
    ["192.168.1.1", false],
    ["169.254.169.254", false],
    ["2606:4700:4700::1111", true],
    ["fc00::1", false],
    ["fe80::1", false],
    ["::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:10.0.0.1", false],
  ])("classifies %s public=%s", (address, expected) => {
    expect(isPublicIpAddress(address)).toBe(expected)
  })
})
