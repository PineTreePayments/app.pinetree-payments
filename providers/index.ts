// PineTree payment adapters - central export
// Import from this file to access all registered adapters

// Import adapters to register them
import "./coinbase"
import "./solana"
import "./shift4"
import "./basePay"
import "./lightning"

// Export adapter instances for direct use if needed
export { coinbaseAdapter } from "./coinbase"
export { solanaAdapter } from "./solana"
export { shift4Adapter } from "./shift4"
export { basePayAdapter } from "./basePay"
export { lightningAdapter } from "./lightning"

// Re-export registry functions
export { getProvider, registerProvider } from "../engine/providerRegistry"
