// PineTree Provider Adapters - Central Export
// Import from this file to access all provider adapters

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

// Re-export provider registry functions
export { getProvider, registerProvider } from "../engine/providerRegistry"