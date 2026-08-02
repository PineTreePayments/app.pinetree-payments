/** Future encrypted-vault contract. No implementation is enabled in this release. */
export type Shift4CardOnFileUse = "recurring" | "unscheduled" | "customer_initiated"
export type Shift4StoredTokenMetadata = Readonly<{
  tokenId: string
  merchantId: string
  merchantProviderConnectionId: string
  tokenFingerprint: string
  cardOnFileTransactionId: string
  use: Shift4CardOnFileUse
  consentRecordedAt: string
  expiresAt: string | null
  revokedAt: string | null
}>

export interface Shift4EncryptedTokenVault {
  storeEncryptedProviderToken(input: Omit<Shift4StoredTokenMetadata, "tokenId" | "revokedAt"> & { encryptedTokenEnvelope: string }): Promise<Shift4StoredTokenMetadata>
  loadEncryptedProviderToken(input: { merchantId: string; merchantProviderConnectionId: string; tokenId: string; use: Shift4CardOnFileUse }): Promise<{ metadata: Shift4StoredTokenMetadata; encryptedTokenEnvelope: string } | null>
  revokeProviderToken(input: { merchantId: string; merchantProviderConnectionId: string; tokenId: string; reason: string }): Promise<boolean>
}

export class DisabledShift4EncryptedTokenVault implements Shift4EncryptedTokenVault {
  private blocked(): never { throw Object.assign(new Error("Shift4 card-on-file vault is not implemented or certified"), { code: "card_on_file_disabled" }) }
  storeEncryptedProviderToken(): Promise<Shift4StoredTokenMetadata> { return this.blocked() }
  loadEncryptedProviderToken(): Promise<null> { return this.blocked() }
  revokeProviderToken(): Promise<boolean> { return this.blocked() }
}
