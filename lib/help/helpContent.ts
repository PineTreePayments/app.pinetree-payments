export type HelpCategory =
  | "Getting Started"
  | "Accepting Payments"
  | "Wallet Connections"
  | "Transaction Statuses"
  | "Reports & Analytics"
  | "Developer/API"
  | "Provider Connections"
  | "Troubleshooting"

export type HelpArticle = {
  id: string
  title: string
  category: HelpCategory
  description: string
  body: string
  tags: string[]
}

export const helpCategories: HelpCategory[] = [
  "Getting Started",
  "Accepting Payments",
  "Wallet Connections",
  "Transaction Statuses",
  "Reports & Analytics",
  "Developer/API",
  "Provider Connections",
  "Troubleshooting"
]

export const helpArticles: HelpArticle[] = [
  {
    id: "what-is-pinetree-engine",
    title: "What is PineTree Engine?",
    category: "Getting Started",
    description: "A simple explanation of the backend layer that coordinates payment creation and status changes.",
    body: "PineTree Engine is the internal payment coordination layer. It validates payment requests, routes work to the right provider, and keeps payment status updates flowing through a single controlled path. Merchants do not need to manage the engine directly, but it is why the dashboard can show a consistent payment timeline across different providers and payment methods.",
    tags: ["engine", "payments", "status", "architecture"]
  },
  {
    id: "payment-status-pending",
    title: "What does Pending mean?",
    category: "Transaction Statuses",
    description: "Pending means PineTree created the payment and is waiting for customer or provider activity.",
    body: "A Pending payment has been created in PineTree, but PineTree has not yet seen enough provider activity to mark it as processing or confirmed. For wallet payments, the customer may still need to approve the transaction. For hosted checkout, the buyer may still be on the checkout page.",
    tags: ["pending", "status", "wallet", "checkout"]
  },
  {
    id: "payment-status-processing",
    title: "What does Processing mean?",
    category: "Transaction Statuses",
    description: "Processing means PineTree has detected payment activity and is waiting for final confirmation.",
    body: "A Processing payment usually means PineTree or a provider has detected activity for the payment, but final confirmation has not been completed yet. This can happen while a blockchain transaction is confirming or while a provider is finalizing the payment result.",
    tags: ["processing", "status", "confirmation", "provider"]
  },
  {
    id: "payment-status-confirmed",
    title: "What does Confirmed mean?",
    category: "Transaction Statuses",
    description: "Confirmed means the payment reached PineTree's final successful status.",
    body: "A Confirmed payment has completed successfully according to PineTree's payment state flow. The transaction should appear in reporting once it is included in the relevant report window. If something looks different between a provider portal and PineTree, compare the payment ID, timestamp, network, and provider reference.",
    tags: ["confirmed", "status", "reports", "success"]
  },
  {
    id: "why-payment-failed",
    title: "Why did a payment fail?",
    category: "Troubleshooting",
    description: "Common reasons a payment may not complete successfully.",
    body: "Payments can fail when a customer cancels, a wallet does not approve the request, a provider rejects the payment, a network transaction cannot be completed, or a payment expires before confirmation. Start by checking the payment status, provider, network, timestamp, and any provider reference shown in the dashboard.",
    tags: ["failed", "troubleshooting", "provider", "wallet"]
  },
  {
    id: "wallet-connections",
    title: "How wallet connections work",
    category: "Wallet Connections",
    description: "How PineTree uses wallet connections for merchant setup and customer payments.",
    body: "Wallet connections let PineTree work with supported wallet-based payment methods and merchant account configuration. Customer wallet payment approval still happens inside the customer's wallet. PineTree tracks the payment request and waits for the provider or network activity that updates the transaction status.",
    tags: ["wallets", "connections", "solana", "base"]
  },
  {
    id: "hosted-checkout",
    title: "How hosted checkout works",
    category: "Accepting Payments",
    description: "Hosted checkout gives customers a PineTree payment page for online transactions.",
    body: "Hosted checkout lets a merchant send a customer to a PineTree checkout page. PineTree creates or loads the checkout session, presents available payment options, and records the resulting payment status. The dashboard can then show checkout volume alongside other payment channels.",
    tags: ["checkout", "online", "payment link", "session"]
  },
  {
    id: "transaction-reports",
    title: "How transaction reports work",
    category: "Reports & Analytics",
    description: "Reports summarize payment activity for selected time windows.",
    body: "PineTree reports summarize payment volume, fees, taxes, provider totals, and transaction rows for the selected report window. Reports are based on PineTree payment and transaction records, so the most useful troubleshooting details are payment ID, provider, network, amount, status, and timestamp.",
    tags: ["reports", "analytics", "transactions", "csv", "pdf"]
  },
  {
    id: "provider-connections",
    title: "What provider connections mean",
    category: "Provider Connections",
    description: "Providers are external payment services PineTree can route supported payments through.",
    body: "Provider connections represent external services or networks that PineTree can use for supported payment methods. A provider connection does not guarantee that every payment method is enabled for every merchant. If a provider-backed payment is not available, check provider setup, account status, and readiness in the dashboard.",
    tags: ["providers", "base", "solana", "shift4", "readiness"]
  }
]
