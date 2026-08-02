import { claimTerminalReaderForPayment, getMerchantTerminalReaderById, listMerchantTerminalReaders, releaseTerminalReaderClaim, upsertMerchantTerminalReader } from "@/database/merchantTerminalReaders"
import type { Shift4PaxDevice, Shift4PaxDeviceAdapter } from "./types"

/** PineTree device registry adapter; registration codes and PIN data never enter it. */
export class DatabaseShift4PaxDeviceAdapter implements Shift4PaxDeviceAdapter {
  private project(reader: Awaited<ReturnType<typeof getMerchantTerminalReaderById>> & {}): Shift4PaxDevice {
    return { terminalReaderId: reader.id, providerReaderId: reader.provider_reader_id, label: reader.label, status: reader.status, simulated: reader.simulated }
  }
  async listDevices(merchantId: string): Promise<Shift4PaxDevice[]> {
    return (await listMerchantTerminalReaders(merchantId, "shift4")).map((reader) => this.project(reader))
  }
  async getDeviceReadiness(merchantId: string, terminalReaderId: string): Promise<Shift4PaxDevice | null> {
    const reader = await getMerchantTerminalReaderById(merchantId, terminalReaderId)
    return reader?.provider === "shift4" ? this.project(reader) : null
  }
  async configureDevice(input: { merchantId: string; providerReaderId: string; terminalLocationId?: string | null; label: string; serialNumber?: string | null; simulated: boolean }): Promise<Shift4PaxDevice> {
    const reader = await upsertMerchantTerminalReader({ ...input, provider: "shift4", deviceType: "PAX", status: input.simulated ? "ready" : "configured" })
    return this.project(reader)
  }
  claimDevice(merchantId: string, terminalReaderId: string, paymentId: string) {
    return claimTerminalReaderForPayment(merchantId, terminalReaderId, paymentId)
  }
  releaseDevice(paymentId: string) {
    return releaseTerminalReaderClaim(paymentId)
  }
}
