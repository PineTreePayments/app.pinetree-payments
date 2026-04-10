// PineTree Engine - Central Export
// Import from this file to access all engine functionality

// Configuration
export {
  PINETREE_FEE,
  PINETREE_TREASURY_WALLET,
  BASE_URL,
  RPC_URLS,
  NETWORK_RETURN_PATHS,
  getReturnPath,
  getRpcUrl,
  WATCHER_CONFIG,
  HEALTH_CHECK_CONFIG,
  PAYMENT_EXPIRATION_MINUTES,
  validateConfig
} from "./config"

// Fee Calculations
export {
  calculateGrossAmount,
  calculateMerchantAmount,
  calculateTax,
  calculateTotalWithTax,
  calculateFeeBreakdown,
  formatAmount,
  parseAmount,
  isValidAmount
} from "./fees"

// Payment Creation
export { createPayment } from "./createPayment"

// Payment Status Management
export {
  updatePaymentStatus,
  confirmPayment,
  failPayment,
  startProcessingPayment,
  expirePayment
} from "./updatePaymentStatus"

// State Machine
export type { PaymentStatus } from "./paymentStateMachine"
export {
  canTransition,
  assertValidTransition,
  getValidNextStatuses,
  isTerminalStatus,
  getInitialStatus
} from "./paymentStateMachine"

// Event System
export { onEvent, emitEvent } from "./eventBus"

// Webhook Processing
export { processWebhook } from "./webhookProcessor"

// Provider Management
export { 
  getProvider, 
  registerProvider,
  isProviderHealthy,
  setProviderHealth,
  getProviderHealthStatus
} from "./providerRegistry"

export { chooseBestProvider } from "./providerSelector"
export { runProviderHealthChecks, startHealthCheckDaemon } from "./providerHealth"

// Payment Monitoring
export { watchPayment } from "./paymentWatcher"

// Split Payments
export { generateSplitPayment } from "./generateSplitPayment"

// Balance Updater
export { 
  updateSingleWalletBalance,
  updateAllMerchantBalances
} from "./balanceUpdater"

// Wallet Overview / Pricing
export { getMarketPricesUSD } from "./marketPrices"
export { refreshWalletBalancesEngine, getWalletOverviewEngine } from "./walletOverview"
export { getDashboardOverviewEngine } from "./dashboardOverview"
