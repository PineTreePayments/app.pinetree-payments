// PineTree payment adapters — central export

// Coinbase Commerce is RETIRED per Standard 06 §7. Importing the module no
// longer registers it: registration is gated on PINETREE_ENABLE_COINBASE_COMMERCE
// (default off) inside ./coinbase, so getProvider("coinbase") throws unless it is
// deliberately re-enabled. The import is kept only so the export below resolves.
import "./coinbase"
import "./solana"
import "./shift4"
import "./stripe"
// Bridge is registered as its own provider connection. It is owned by Stripe
// but shares no credentials, customer identifiers, KYB state, or webhooks with
// the "stripe" adapter above, and it supports no payment networks in this
// phase so it can never be selected for payment routing.
import "./bridge"
import "./fluidpay"
import "./basePay"
import "./lightning/speedAdapter"
import "./lightning/nwcAdapter"

export { coinbaseAdapter } from "./coinbase"
export { solanaAdapter } from "./solana"
export { shift4Adapter } from "./shift4"
export { stripeAdapter } from "./stripe"
export { bridgeAdapter } from "./bridge"
export { fluidPayAdapter } from "./fluidpay"
export { basePayAdapter } from "./basePay"
export { speedAdapter } from "./lightning/speedAdapter"
export { nwcAdapter } from "./lightning/nwcAdapter"

export { getProvider, registerProvider } from "./registry"
