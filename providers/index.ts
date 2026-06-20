// PineTree payment adapters — central export

import "./coinbase"
import "./solana"
import "./shift4"
import "./stripe"
import "./fluidpay"
import "./basePay"
import "./lightning/speedAdapter"
import "./lightning/nwcAdapter"

export { coinbaseAdapter } from "./coinbase"
export { solanaAdapter } from "./solana"
export { shift4Adapter } from "./shift4"
export { stripeAdapter } from "./stripe"
export { fluidPayAdapter } from "./fluidpay"
export { basePayAdapter } from "./basePay"
export { speedAdapter } from "./lightning/speedAdapter"
export { nwcAdapter } from "./lightning/nwcAdapter"

export { getProvider, registerProvider } from "../engine/providerRegistry"
