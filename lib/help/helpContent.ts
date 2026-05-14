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
    title: "What Failed means",
    category: "Troubleshooting",
    description: "Failed means PineTree could not complete the payment successfully.",
    body: "A Failed payment did not complete successfully. Common causes include customer cancellation, wallet approval not completed, provider rejection, network transaction failure, or timeout before confirmation. Start by checking the payment ID, provider, network, amount, timestamp, and any provider reference shown in the dashboard.",
    tags: ["failed", "troubleshooting", "provider", "wallet"]
  },
  {
    id: "how-pinetree-pos-works",
    title: "How PineTree POS works",
    category: "Accepting Payments",
    description: "PineTree POS helps create in-person payment requests from the dashboard or terminal flow.",
    body: "PineTree POS is designed for in-person checkout. A merchant enters an amount, selects an available payment path, and PineTree creates a payment request for the customer to complete. PineTree then tracks the payment status in the dashboard. If a POS payment does not complete, check the related payment ID, selected method, customer approval step, and transaction status.",
    tags: ["pos", "terminal", "in person", "payments"]
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
    title: "How reports are calculated",
    category: "Reports & Analytics",
    description: "Reports summarize payment activity for selected time windows.",
    body: "PineTree reports summarize payment volume, fees, taxes, provider totals, and transaction rows for the selected report window. Confirmed payments count toward successful volume. Failed, incomplete, or pending payments may appear in transaction detail without being treated as completed volume. Reports are based on PineTree payment and transaction records, so the most useful troubleshooting details are payment ID, provider, network, amount, status, and timestamp.",
    tags: ["reports", "analytics", "transactions", "csv", "pdf"]
  },
  {
    id: "provider-connections",
    title: "What provider connections mean",
    category: "Provider Connections",
    description: "Providers are external payment services PineTree can route supported payments through.",
    body: "Provider connections represent external services or networks that PineTree can use for supported payment methods. A provider connection does not guarantee that every payment method is enabled for every merchant. If a provider-backed payment is not available, check provider setup, account status, and readiness in the dashboard.",
    tags: ["providers", "base", "solana", "shift4", "readiness"]
  },
  {
    id: "when-to-open-support-ticket",
    title: "When to open a support ticket",
    category: "Troubleshooting",
    description: "Open a ticket when the dashboard details are not enough to resolve a payment or account issue.",
    body: "Open a support ticket when a payment remains unclear after checking status, provider, network, amount, timestamp, and payment ID. Tickets are also useful for dashboard issues, settlement questions, wallet connection problems, provider setup questions, POS issues, API support, and feature requests. Include the related payment ID when you have one.",
    tags: ["support", "ticket", "help", "troubleshooting"]
  }
]
