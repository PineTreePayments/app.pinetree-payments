// PineTree payment adapters — central export

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
