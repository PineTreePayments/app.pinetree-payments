export type Shift4PaxDevice = Readonly<{
  terminalReaderId: string
  providerReaderId: string
  label: string
  status: string
  simulated: boolean
}>

export interface Shift4PaxDeviceAdapter {
  listDevices(merchantId: string): Promise<Shift4PaxDevice[]>
  getDeviceReadiness(merchantId: string, terminalReaderId: string): Promise<Shift4PaxDevice | null>
  configureDevice(input: { merchantId: string; providerReaderId: string; terminalLocationId?: string | null; label: string; serialNumber?: string | null; simulated: boolean }): Promise<Shift4PaxDevice>
  claimDevice(merchantId: string, terminalReaderId: string, paymentId: string): Promise<boolean>
  releaseDevice(paymentId: string): Promise<void>
}
