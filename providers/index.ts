// PineTree payment adapters - central export
// Import from this file to access all registered adapters

// Import adapters to register them
import "./coinbase"
import "./solana"
import "./shift4"
import "./basePay"

// Export adapter instances for direct use if needed
export { coinbaseAdapter } from "./coinbase"
export { solanaAdapter } from "./solana"
export { shift4Adapter } from "./shift4"
export { basePayAdapter } from "./basePay"

// Re-export registry functions
export { getProvider, registerProvider } from "../engine/providerRegistry"