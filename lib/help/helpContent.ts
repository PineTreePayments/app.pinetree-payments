export type HelpCategory =
  | "Getting Started"
  | "Accepting Payments"
  | "Wallet Connections"
  | "Transaction Statuses"
  | "Reports & Analytics"
  | "Developer/API"
  | "Provider Connections"
  | "Troubleshooting"
  | "PineTree Assistant"

export type HelpArticle = {
  id: string
  title: string
  category: HelpCategory
  description: string
  body: string
  tags: string[]
  keywords?: string[]
}

export const helpCategories: HelpCategory[] = [
  "Getting Started",
  "Accepting Payments",
  "Wallet Connections",
  "Transaction Statuses",
  "Reports & Analytics",
  "Developer/API",
  "Provider Connections",
  "Troubleshooting",
  "PineTree Assistant"
]

export const helpArticles: HelpArticle[] = [
  {
    id: "what-pinetree-is",
    title: "What PineTree is",
    category: "Getting Started",
    description: "PineTree is a merchant dashboard for accepting, tracking, and reporting payments across supported rails.",
    body: "PineTree helps merchants create payment requests, connect supported providers and wallets, review transaction activity, and generate reports from one dashboard.\n\nWhat this means: PineTree is not just a wallet screen. It coordinates payment creation, provider selection, payment status tracking, checkout links, POS terminals, wallet balances, and reporting views.\n\nWhat to check: Before accepting real payments, review Providers, Wallets, Online Checkout, POS terminals, and Reports so you know which rails are connected and how completed payments will appear.",
    tags: ["overview", "dashboard", "merchant", "payments"],
    keywords: ["pinetree", "getting started", "merchant dashboard"]
  },
  {
    id: "dashboard-overview",
    title: "Dashboard overview",
    category: "Getting Started",
    description: "The dashboard groups payment operations into POS, checkout, transactions, reports, wallets, providers, settings, and help.",
    body: "The PineTree dashboard is organized by workflow. POS is for in-person terminal setup and checkout. Online Checkout is for payment links and customer checkout buttons. Developer is for API keys, webhooks, SDKs, and integrations. Transactions shows ledger activity, filters, and channel mix. Reports creates PDF or CSV exports. Wallets shows connected wallet and payment-account balances. Providers is where payment rails are configured.\n\nWhat this means: Most merchant tasks start from one of those sections rather than from a hidden settings page.\n\nWhat to check: If a payment method is not showing up, start with Providers. If a balance is missing, start with Wallets. If a payment happened but numbers look off, start with Transactions and Reports.",
    tags: ["dashboard", "navigation", "overview"],
    keywords: ["sidebar", "overview", "reports", "transactions"]
  },
  {
    id: "first-setup-checklist",
    title: "First setup checklist",
    category: "Getting Started",
    description: "A practical checklist before sending a customer through PineTree.",
    body: "Start by creating a PineTree Wallet and confirming at least one supported payment rail is ready. Solana Pay, Base Pay, and Bitcoin Lightning are managed through PineTree Wallet. For Shift4, add the provider credentials required by your account. Then create a small checkout link or POS test sale and confirm that the payment status updates as expected.\n\nWhat this means: PineTree needs a configured route before it can create a live customer payment.\n\nWhat to check: Confirm provider status, wallet address, supported asset, test amount, payment status, transaction row, and report visibility. Do not rely on a payment method until a small end-to-end test succeeds.",
    tags: ["setup", "test", "providers", "wallets"],
    keywords: ["first setup", "checklist", "test payment"]
  },
  {
    id: "merchants-providers-wallets",
    title: "Understanding merchants, providers, and wallets",
    category: "Getting Started",
    description: "How the main PineTree account concepts fit together.",
    body: "A merchant is the account using PineTree. A provider is a supported payment service or rail, such as Solana Pay, Base Pay, Shift4, or Bitcoin Lightning. PineTree Wallet is the merchant wallet for supported crypto rails.\n\nWhat this means: Provider setup and wallet setup are related, but they are not the same thing. Crypto rails settle through PineTree Wallet. Other providers may use credentials or provider-hosted payment sessions.\n\nWhat to check: In Providers, review connection state. In Wallet, review visible wallet addresses. In Transactions, review which provider and network handled a payment.",
    tags: ["merchant", "providers", "wallets", "accounts"],
    keywords: ["merchant id", "provider", "wallet address"]
  },
  {
    id: "what-to-test-before-real-payments",
    title: "What to test before accepting real payments",
    category: "Getting Started",
    description: "Run a small test through each payment path you plan to offer.",
    body: "Use a small amount to test each payment method you plan to show customers. For POS, create or open a terminal and complete a test flow. For hosted checkout, create a payment link or test checkout session. For wallet rails, verify that the wallet opens, the amount looks right, and the payment status updates.\n\nWhat this means: A provider can appear configured while a specific customer path still needs verification on your device, wallet, or account.\n\nWhat to check: Amount breakdown, service fee line, wallet opening behavior, provider redirect, final status, transaction row, and report export.",
    tags: ["testing", "go live", "checkout", "pos"],
    keywords: ["before going live", "test checkout"]
  },
  {
    id: "how-pos-works",
    title: "How PineTree POS works",
    category: "Accepting Payments",
    description: "PineTree POS supports terminal setup, amount entry, cash handling, crypto payment creation, and status updates.",
    body: "PineTree POS is built for in-person checkout. In the POS dashboard, merchants create terminals with a register name, recovery phrase, four-digit PIN, optional auto-lock, and optional starting cash amount. Launching a terminal opens the terminal checkout flow.\n\nWhat this means: In the terminal, the cashier enters an amount, reviews the total, and chooses an available payment method. Cash can be recorded through the drawer flow. Crypto creates a payment request and shows a QR while PineTree watches for status updates.\n\nWhat to check: Terminal ID, selected payment method, drawer state for cash, QR visibility for crypto, and whether the payment reaches confirmed, failed, incomplete, or expired.",
    tags: ["pos", "terminal", "cash", "qr"],
    keywords: ["point of sale", "cash drawer", "terminal"]
  },
  {
    id: "hosted-checkout-works",
    title: "How hosted checkout works",
    category: "Accepting Payments",
    description: "Hosted checkout sends customers to a PineTree payment page where they choose an available asset or provider path.",
    body: "Hosted checkout uses PineTree pages to guide a customer through payment. A checkout link resolves to a payment intent, then redirects to the PineTree payment screen. The customer sees the amount, service fee, total, and available payment assets based on the configured networks.\n\nWhat this means: The checkout page does not complete payment by itself. The customer still needs to choose a payment method and approve the provider or wallet step.\n\nWhat to check: Link status, expiration, selected asset, wallet/provider handoff, success or cancel URL, and final payment status.",
    tags: ["hosted checkout", "checkout", "pay page", "customer"],
    keywords: ["checkout link", "payment intent", "success url", "cancel url"]
  },
  {
    id: "online-checkout-links",
    title: "How online checkout links work",
    category: "Accepting Payments",
    description: "Online Checkout creates shareable links with amount, name, description, customer email, reference, and expiration options.",
    body: "The Online Checkout page can create payment links for fixed amounts. Links can include a name, description, optional customer email, optional reference, and expiration such as never, 24 hours, 7 days, or 30 days. Active links point customers into PineTree checkout.\n\nWhat this means: A disabled or expired link will not prepare a customer payment. PineTree shows a link-unavailable screen instead of sending the customer into payment.\n\nWhat to check: Link status, checkout URL, amount, expiration, customer reference, and whether the link has been disabled.",
    tags: ["payment links", "online checkout", "links"],
    keywords: ["checkout links", "active", "disabled", "expired"]
  },
  {
    id: "what-customers-see-checkout",
    title: "What customers see during checkout",
    category: "Accepting Payments",
    description: "Customers see a PineTree Checkout card with amount details and payment asset choices.",
    body: "During hosted checkout, customers see PineTree Checkout, subtotal, Service fee, total, and supported asset choices such as SOL, USDC on Solana, ETH on Base, USDC on Base, Shift4, or Bitcoin Lightning when those rails are available.\n\nWhat this means: The visible choices depend on merchant configuration and the networks available for the payment intent.\n\nWhat to check: If a customer does not see the expected option, review Providers and Wallets first. Then check whether the selected rail supports the asset you expect.",
    tags: ["customer", "checkout", "assets", "service fee"],
    keywords: ["customer view", "asset selector", "fee display"]
  },
  {
    id: "after-customer-pays",
    title: "What happens after a customer pays",
    category: "Accepting Payments",
    description: "PineTree waits for provider, wallet, webhook, or watcher signals before finalizing status.",
    body: "After the customer approves a payment, PineTree updates status through provider webhooks, wallet callbacks, transaction detection, or a bounded status check depending on the rail. Confirmed payments appear as successful activity in the dashboard and reports.\n\nWhat this means: There can be a short gap between customer action and final status. Pending and Processing are normal intermediate states.\n\nWhat to check: Payment ID, provider reference, network, transaction hash if available, and whether the payment is still pending, processing, confirmed, failed, or incomplete.",
    tags: ["after payment", "status", "webhooks", "watcher"],
    keywords: ["customer paid", "confirmation", "transaction hash"]
  },
  {
    id: "fee-display",
    title: "How service fee display works",
    category: "Accepting Payments",
    description: "Checkout and POS can show subtotal, taxes when configured, service fee, and total.",
    body: "PineTree calculates a merchant amount and service fee when creating payment requests. POS can also include terminal tax settings when configured. Hosted checkout displays the subtotal, Service fee, and total before the customer chooses a payment asset.\n\nWhat this means: The customer-facing total may be higher than the merchant amount because it includes the service fee and any applicable tax.\n\nWhat to check: Subtotal, tax line, service fee line, total due, and the report row after confirmation.",
    tags: ["fees", "service fee", "tax", "amount"],
    keywords: ["service fee", "gross amount", "subtotal"]
  },
  {
    id: "when-to-retry-payment",
    title: "When to retry a payment",
    category: "Accepting Payments",
    description: "Retry when a payment fails, expires, is canceled, or never reaches a wallet/provider approval step.",
    body: "Retry a payment when the customer closed checkout before approving, the wallet did not open, the provider declined the session, the payment expired, or the payment clearly failed. Avoid asking the customer to pay twice if the payment is Processing unless you have checked the transaction details.\n\nWhat this means: Processing can mean PineTree saw activity and is waiting for final confirmation. Retrying too early can create duplicate attempts.\n\nWhat to check: Current status, payment ID, provider reference, customer wallet transaction, and whether the original attempt is terminal.",
    tags: ["retry", "failed", "expired", "processing"],
    keywords: ["try again", "duplicate", "cancel"]
  },
  {
    id: "wallet-page-overview",
    title: "Wallet page overview",
    category: "Wallet Connections",
    description: "The Wallets page summarizes connected wallets and Lightning wallet connections visible to PineTree.",
    body: "The Wallet page shows the merchant PineTree Wallet profile, receive addresses, and supported rail status for Base, Solana, and Bitcoin.\n\nWhat this means: Wallet is a balance and address overview. It does not by itself create payments or move funds.\n\nWhat to check: Ready status, receive addresses, native balance, USD value, and last refresh time.",
    tags: ["wallets", "balances", "overview"],
    keywords: ["wallet overview", "refresh balances", "connections"]
  },
  {
    id: "connected-wallets-explained",
    title: "Connected wallets explained",
    category: "Wallet Connections",
    description: "Connected wallets are saved merchant addresses used by wallet payment rails.",
    body: "A connected wallet is a merchant address stored for a supported network, currently shown for Solana or Base wallet rails. PineTree uses the saved address when it creates payment requests for that network.\n\nWhat this means: Connecting a wallet identifies where merchant-side payment value should go for that rail. It is not the same as a customer connecting their wallet at checkout.\n\nWhat to check: Network, wallet type, address, and whether the provider row is enabled.",
    tags: ["connected wallets", "merchant wallet", "base", "solana"],
    keywords: ["wallet address", "merchant wallet"]
  },
  {
    id: "solana-wallet-payment-behavior",
    title: "Solana wallet and payment behavior",
    category: "Wallet Connections",
    description: "Solana supports Phantom and Solflare setup, SOL and USDC checkout choices, and Solana Pay transaction requests.",
    body: "In Providers, Solana can be connected through Phantom or Solflare on the current device, a mobile wallet bridge, or a pasted address. In checkout, Solana payments use SOL or USDC options when available. The payment flow builds a Solana Pay transaction request and wallet approval happens in the customer's wallet.\n\nWhat this means: The wallet button starts the payment path. PineTree then tracks status through its Solana payment flow and watcher checks.\n\nWhat to check: Connected Solana wallet, selected asset, wallet opening behavior, payment ID, and whether the transaction reaches Processing or Confirmed.",
    tags: ["solana", "phantom", "solflare", "solana pay", "usdc"],
    keywords: ["SOL", "Solana USDC", "transaction request"]
  },
  {
    id: "base-wallet-payment-behavior",
    title: "Base wallet and payment behavior",
    category: "Wallet Connections",
    description: "Base supports Base Wallet, MetaMask, and Trust Wallet setup, with ETH or USDC checkout options when configured.",
    body: "In Providers, Base can be connected with Base Wallet, MetaMask, or Trust Wallet on the current device, a mobile wallet bridge, or a pasted address. In checkout, Base payments can use ETH or USDC options when available. Base wallet execution happens in the customer wallet, while PineTree tracks the payment record and status.\n\nWhat this means: The merchant wallet is saved in PineTree, but the customer still approves their own transaction during checkout.\n\nWhat to check: Connected Base wallet, selected asset, wallet approval, transaction hash if available, and whether the status advances.",
    tags: ["base", "base wallet", "metamask", "trust wallet", "usdc"],
    keywords: ["ETH", "Base USDC", "wallet execution"]
  },
  {
    id: "walletconnect-behavior",
    title: "WalletConnect behavior",
    category: "Wallet Connections",
    description: "WalletConnect-related code supports Base wallet execution where enabled, while provider setup uses direct or mobile wallet paths.",
    body: "The current app includes WalletConnect-related Base wallet payment support and wallet session helpers. Provider setup itself offers current-device connection, mobile wallet opening, or pasted address paths for Solana and Base.\n\nWhat this means: If a wallet handoff does not behave as expected, the exact path matters: provider setup, hosted checkout payment, or mobile bridge return.\n\nWhat to check: Browser wallet availability, mobile return page, session status, selected wallet type, and whether the customer returned to PineTree after wallet approval.",
    tags: ["walletconnect", "base", "mobile", "wallet session"],
    keywords: ["wallet connect", "mobile wallet", "base return"]
  },
  {
    id: "withdrawals-support-status",
    title: "Withdrawals and transfers status",
    category: "Wallet Connections",
    description: "The current Wallets page is a connection and balance overview, not a withdrawal screen.",
    body: "The current dashboard shows wallet and payment-account balances but does not present a merchant withdrawal workflow in the Wallets page.\n\nWhat this means: Do not treat the Wallets page as a funds-transfer tool. It is for visibility into connected balances and accounts.\n\nWhat to check: If you need movement of funds, confirm what your provider or wallet supports outside PineTree and open a support ticket if dashboard balances appear incorrect.",
    tags: ["wallets", "withdrawals", "balances"],
    keywords: ["withdraw", "transfer", "settlement"]
  },
  {
    id: "providers-page-overview",
    title: "Providers page overview",
    category: "Provider Connections",
    description: "Providers is where merchants connect payment rails and manage routing settings.",
    body: "The Providers page lists payment providers including Coinbase Business, Solana Pay, Shift4, Base Pay, and Bitcoin Lightning. It also shows smart routing and auto-convert settings, with toggles constrained by provider connection state.\n\nWhat this means: Provider status controls which rails can be used when PineTree creates payments.\n\nWhat to check: Provider status, enabled toggle, wallet rows for Solana/Base, Lightning setup state, and whether Shift4 credentials are present when using Shift4.",
    tags: ["providers", "routing", "settings"],
    keywords: ["payment providers", "smart routing", "auto conversion"]
  },
  {
    id: "shift4-provider-status",
    title: "Shift4 provider status",
    category: "Provider Connections",
    description: "Shift4 uses provider credentials and a hosted checkout redirect path in the current code.",
    body: "Shift4 is represented as a provider that can create hosted payment sessions when a merchant API key is configured. In checkout, the customer is redirected to a secure provider checkout page when Shift4 is selected.\n\nWhat this means: If Shift4 is not configured, PineTree cannot prepare the Shift4 payment path for the customer.\n\nWhat to check: Provider connection state, API key entry, hosted checkout URL returned by the provider, and webhook/status mapping for completed, failed, or declined payments.",
    tags: ["shift4", "hosted checkout", "credentials"],
    keywords: ["card", "fiat", "api key", "redirect"]
  },
  {
    id: "lightning-managed-provider-status",
    title: "Bitcoin Lightning provider status",
    category: "Provider Connections",
    description: "Lightning is a PineTree Wallet managed rail.",
    body: "Bitcoin Lightning is managed through PineTree Wallet. Merchants do not connect a separate Lightning wallet from the dashboard. PineTree routes Lightning payments through its internal backend and settles merchant funds to the PineTree Wallet Bitcoin address.\n\nWhat this means: Provider setup is read-only for Bitcoin Lightning in canonical wallet mode.\n\nWhat to check: PineTree Wallet status, Bitcoin receive address, provider readiness, and whether invoice creation succeeds in a small test payment.",
    tags: ["lightning", "bitcoin", "btc", "pinetree wallet"],
    keywords: ["Bitcoin Lightning", "PineTree Wallet", "Bitcoin receive address"]
  },
  {
    id: "base-provider-behavior",
    title: "Base provider behavior",
    category: "Provider Connections",
    description: "Base Pay is a wallet rail that uses a saved merchant wallet and customer wallet execution.",
    body: "Base Pay connects a merchant wallet address and uses wallet execution for supported Base assets. The Base adapter is a wallet rail, not a provider-hosted checkout page. PineTree generates payment data and tracks status after wallet action.\n\nWhat this means: Base requires a connected merchant wallet and a customer wallet approval step.\n\nWhat to check: Saved Base wallet address, wallet type, ETH or USDC asset selection, transaction hash, and final status.",
    tags: ["base", "wallet rail", "eth", "usdc"],
    keywords: ["Base Pay", "contract split", "wallet"]
  },
  {
    id: "solana-provider-behavior",
    title: "Solana Pay provider behavior",
    category: "Provider Connections",
    description: "Solana Pay is a wallet rail using transaction requests, wallet approval, and watcher confirmation.",
    body: "Solana Pay connects a merchant Solana wallet and uses PineTree's Solana payment path for SOL or USDC. The Solana adapter relies on transaction request generation and blockchain confirmation rather than provider-hosted checkout.\n\nWhat this means: A customer must approve the Solana transaction in their wallet, and PineTree waits for on-chain evidence before final confirmation.\n\nWhat to check: Merchant Solana wallet, customer wallet app, selected asset, memo/reference matching, and status updates.",
    tags: ["solana", "solana pay", "wallet rail"],
    keywords: ["phantom", "solflare", "memo", "on-chain"]
  },
  {
    id: "connected-unconnected-provider-status",
    title: "What connected and unconnected provider status means",
    category: "Provider Connections",
    description: "Connected means PineTree has the required account, credential, or wallet reference for that provider row.",
    body: "A connected provider has the configuration PineTree needs for that rail, such as a saved wallet address, provider API key, or verified Lightning account details. Unconnected means setup is missing or incomplete.\n\nWhat this means: Connected does not guarantee every customer payment will succeed. It means PineTree has enough configuration to attempt that rail.\n\nWhat to check: Enabled toggle, wallet address, credentials, provider-specific setup fields, and a small test payment.",
    tags: ["connected", "unconnected", "provider status"],
    keywords: ["status", "enabled", "not connected"]
  },
  {
    id: "credentials-and-ids",
    title: "What credentials and IDs mean",
    category: "Provider Connections",
    description: "Some provider fields identify accounts or payment addresses; others are secrets and should be treated carefully.",
    body: "The dashboard may ask for provider-specific values such as a Shift4 API key or a wallet address. API keys are sensitive. Wallet addresses identify where PineTree should route payments.\n\nWhat this means: Enter values exactly as shown by the provider or wallet. Do not share API keys in support tickets unless PineTree specifically provides a secure process.\n\nWhat to check: Field label, provider dashboard source, copied value, and whether the provider status updates after saving.",
    tags: ["credentials", "api key", "ids", "security"],
    keywords: ["Shift4 API key", "wallet address"]
  },
  {
    id: "status-created",
    title: "What Created means",
    category: "Transaction Statuses",
    description: "Created is the initial internal status before PineTree presents the payment as pending.",
    body: "Created means PineTree has created the payment record. In the current engine, new payments are then advanced to Pending after the payment is presented.\n\nWhat this means: Merchants may not see Created for long because it is an early internal lifecycle step.\n\nWhat to check: If a payment stays Created, collect the payment ID and open a support ticket because the normal create-to-pending path may not have completed.",
    tags: ["created", "status", "lifecycle"],
    keywords: ["initial status", "payment created"]
  },
  {
    id: "status-pending",
    title: "What Pending means",
    category: "Transaction Statuses",
    description: "Pending means PineTree created and presented the payment but has not yet detected final activity.",
    body: "Pending means the payment exists and PineTree is waiting for customer action, provider activity, wallet approval, or a first detection signal. For POS crypto, the customer may still need to scan and approve. For hosted checkout, the customer may still be choosing an asset or approving in a wallet.\n\nWhat this means: Pending is normal before a customer completes the payment step.\n\nWhat to check: Whether the customer opened the wallet/provider page, whether the checkout was closed, and whether a provider reference or payment ID exists.",
    tags: ["pending", "status", "checkout", "wallet"],
    keywords: ["waiting", "payment pending"]
  },
  {
    id: "status-processing",
    title: "What Processing means",
    category: "Transaction Statuses",
    description: "Processing means PineTree has detected activity and is waiting for final confirmation.",
    body: "Processing means PineTree has seen a signal that the payment is underway. For blockchain rails, this can mean transaction activity was detected but final validation is still pending. For provider rails, it can mean the provider reported an in-progress state.\n\nWhat this means: Do not immediately retry just because a payment is Processing. It may still confirm.\n\nWhat to check: Transaction hash, provider reference, elapsed time, network activity, and whether the status eventually becomes Confirmed or Failed.",
    tags: ["processing", "status", "confirmation"],
    keywords: ["in progress", "detected", "watcher"]
  },
  {
    id: "status-confirmed",
    title: "What Confirmed means",
    category: "Transaction Statuses",
    description: "Confirmed means PineTree reached the successful terminal payment state.",
    body: "Confirmed means PineTree considers the payment successfully completed. Confirmed payments are counted as successful volume in report summaries and can write ledger activity.\n\nWhat this means: This is the successful final state for the payment lifecycle.\n\nWhat to check: Transaction row, report window, provider reference, and amount if the customer or provider dashboard shows a different result.",
    tags: ["confirmed", "success", "status", "reports"],
    keywords: ["successful", "complete", "ledger"]
  },
  {
    id: "status-failed",
    title: "What Failed means",
    category: "Transaction Statuses",
    description: "Failed means PineTree or the provider could not complete the payment successfully.",
    body: "Failed means the payment reached an unsuccessful terminal state. This can happen when a provider declines or fails a payment, the wallet flow errors, or detection rejects the transaction.\n\nWhat this means: A failed payment usually needs a new attempt if the customer still wants to pay.\n\nWhat to check: Payment ID, provider reference, network, customer wallet result, error message, and whether the customer attempted another payment.",
    tags: ["failed", "status", "declined", "error"],
    keywords: ["payment failed", "declined", "try again"]
  },
  {
    id: "status-incomplete",
    title: "What Incomplete means",
    category: "Transaction Statuses",
    description: "Incomplete means the payment did not complete and is treated as an unfinished terminal state.",
    body: "Incomplete is used when a payment cannot continue through the normal lifecycle, such as an expired or canceled path that maps into PineTree's strict payment state model.\n\nWhat this means: The payment is not successful, but it may not have failed due to provider rejection. It may simply have been abandoned, expired, or canceled.\n\nWhat to check: Customer behavior, checkout close/cancel action, expiration, and whether a new payment should be created.",
    tags: ["incomplete", "expired", "canceled", "status"],
    keywords: ["cancelled", "canceled", "expired"]
  },
  {
    id: "payment-mismatch-incorrect-amount",
    title: "Payment mismatch or incorrect amount",
    category: "Transaction Statuses",
    description: "PineTree validates expected payment references, amounts, and fee evidence for wallet rails where applicable.",
    body: "Some wallet payments require PineTree to match the expected payment ID, amount, merchant leg, and service fee leg. For Solana split payments, the watcher looks for matching wallet activity and a memo/reference. For split EVM payments, PineTree requires enough evidence before final confirmation.\n\nWhat this means: A transaction can be real on-chain activity but still not be enough to confirm the PineTree payment if the amount or reference does not match.\n\nWhat to check: Exact amount, selected asset, payment ID or memo, receiving wallet, fee capture evidence, and transaction hash.",
    tags: ["mismatch", "incorrect amount", "reference", "fee"],
    keywords: ["underpaid", "wrong amount", "memo", "fee capture"]
  },
  {
    id: "stuck-payments",
    title: "What to do for stuck payments",
    category: "Transaction Statuses",
    description: "Use status, time, provider reference, and transaction evidence to decide whether to wait, retry, or open a ticket.",
    body: "If a payment is stuck Pending, confirm the customer actually opened and approved the payment. If it is stuck Processing, check whether a transaction or provider reference exists and allow time for confirmation. If a terminal state never arrives, open a support ticket.\n\nWhat this means: Pending usually means no strong completion signal yet. Processing means PineTree saw activity and may still be validating it.\n\nWhat to check: Payment ID, status, elapsed time, provider/network, wallet transaction, customer screenshot if available, and whether the customer retried.",
    tags: ["stuck", "pending", "processing", "support"],
    keywords: ["stuck pending", "stuck processing"]
  },
  {
    id: "overview-metrics",
    title: "Overview metrics",
    category: "Reports & Analytics",
    description: "Dashboard metrics summarize visible payment activity from PineTree records.",
    body: "Dashboard metrics are built from PineTree payment and transaction records. Pages such as Transactions, Reports, Wallets, and Online Checkout each show their own operational metrics and insights.\n\nWhat this means: Metrics depend on the report window, merchant scope, and which payments reached a status that should count for that view.\n\nWhat to check: Date range, channel, provider, network filter, confirmed status, and whether the payment exists in the transaction ledger.",
    tags: ["metrics", "overview", "dashboard"],
    keywords: ["analytics", "summary", "volume"]
  },
  {
    id: "transactions-page",
    title: "Transactions page",
    category: "Reports & Analytics",
    description: "Transactions shows ledger rows, today volume, confirmed rate, channel mix, and provider/network filters.",
    body: "The Transactions page loads merchant-scoped transaction data and shows today's volume, transaction count, confirmed rate, activity breakdown, channel mix, and a transaction ledger. Filters include wallet/provider, network, and channel.\n\nWhat this means: This is the best place to investigate individual payment activity before generating reports.\n\nWhat to check: Provider, network, channel, payment ID, provider transaction ID, status, and created time.",
    tags: ["transactions", "ledger", "filters", "channel mix"],
    keywords: ["transaction ledger", "confirmed rate", "POS", "online"]
  },
  {
    id: "reports-page",
    title: "Reports page",
    category: "Reports & Analytics",
    description: "Reports can generate PDF summaries and CSV transaction exports for common time windows.",
    body: "The Reports page summarizes financial activity and can generate today's, yesterday's, weekly, monthly, tax, yearly, and transaction export reports. Transaction Export downloads CSV. Other report actions download PDFs and can be emailed.\n\nWhat this means: Reports are generated from PineTree records for the selected report type or date range.\n\nWhat to check: Report type, date window, confirmed count, failed count, net settlements, taxes, provider totals, and channel totals.",
    tags: ["reports", "pdf", "csv", "email"],
    keywords: ["download report", "tax report", "transaction export"]
  },
  {
    id: "wallet-balances",
    title: "Wallet balances",
    category: "Reports & Analytics",
    description: "Wallet balances show visible connected-wallet and payment-account value, with refresh support.",
    body: "The Wallets page shows total visible value from connected wallets and payment accounts, including native balance and USD value rows where available. Merchants can refresh balances from the wallet overview endpoint.\n\nWhat this means: Wallet balances are operational visibility, not the same as a completed-payment report.\n\nWhat to check: Last sync time, connection count, individual wallet rows, native balance, USD value, and refresh errors.",
    tags: ["wallet balances", "refresh", "usd value"],
    keywords: ["balance", "last sync", "refresh"]
  },
  {
    id: "channel-mix-activity",
    title: "Channel mix and activity breakdown",
    category: "Reports & Analytics",
    description: "Transactions can separate POS and online activity and show provider/network patterns.",
    body: "The Transactions page includes channel mix for POS and online payments, plus peak hour, peak day, top provider, and top network. It can open a chart view for transaction volume by provider over common time ranges.\n\nWhat this means: Use this view to understand where payments are coming from and which rails are most active.\n\nWhat to check: Channel filter, provider filter, network filter, chart range, and whether the underlying transactions are confirmed or still pending.",
    tags: ["channel mix", "activity", "charts", "provider"],
    keywords: ["peak hour", "top provider", "top network"]
  },
  {
    id: "api-keys",
    title: "API keys",
    category: "Developer/API",
    description: "Create and manage secret API keys for server-side PineTree integrations.",
    body: "Open Developer, then API Keys, to create a secret key for your server. Newly created keys are shown once, so copy the key and store it securely. Existing keys can be reviewed by prefix and revoked when they are no longer needed.\n\nREST API: No package required. Use a secret API key from your server.\n\nWhat this means: Secret API keys must stay on your backend. Never place them in browser code, public repositories, or customer-facing pages.\n\nWhat to check: Key name, permissions, last used time, and whether an old key should be revoked.",
    tags: ["api keys", "developer", "REST API", "security"],
    keywords: ["secret key", "server side", "revoke", "REST"]
  },
  {
    id: "payment-links-api",
    title: "Payment links and checkout session API",
    category: "Developer/API",
    description: "Use payment link endpoints or create checkout sessions from your server.",
    body: "Developer lists payment-link endpoints for creating, listing, and disabling links. It also includes the checkout session endpoint for server-side session creation and redirecting customers to a PineTree checkout URL.\n\nWhat this means: Static links are useful for fixed offers. Dynamic checkout sessions are better when your backend creates a payment for a specific order.\n\nWhat to check: Amount, currency, checkout URL, token, success URL, cancel URL, and whether your backend keeps API keys secret.",
    tags: ["payment links", "checkout session", "api"],
    keywords: ["/api/checkout/session", "/api/checkout-links", "token"]
  },
  {
    id: "webhooks",
    title: "Webhooks",
    category: "Developer/API",
    description: "Configure event delivery and review webhook activity from Developer.",
    body: "Open Developer, then Webhooks, to add your HTTPS endpoint and choose events such as payment.confirmed, payment.failed, payment.canceled, and checkout.session.created. PineTree shows delivery activity so you can review response status and attempts.\n\nWhat this means: Webhooks notify your backend when PineTree activity changes. Your handler should verify the real PineTree headers, return a successful response promptly, and process repeated events safely.\n\nWhat to check: Endpoint URL, enabled events, signature verification, delivery status, response status, attempt count, and duplicate-event handling.",
    tags: ["webhooks", "events", "developer"],
    keywords: ["payment.confirmed", "payment.failed", "deliveries", "signature"]
  },
  {
    id: "sdks",
    title: "PineTree SDKs",
    category: "Developer/API",
    description: "Install the published Node, JavaScript, or React SDK for your integration.",
    body: "Choose the SDK that matches your application.\n\nNode SDK: npm install @pinetreepayments/node\n\nJavaScript SDK: npm install @pinetreepayments/js\n\nReact SDK: npm install @pinetreepayments/react\n\nREST API: No package required. Use a secret API key from your server.\n\nWhat this means: Use the Node SDK or REST API from trusted server code. The JavaScript and React SDKs help launch PineTree Checkout in browser applications without exposing a secret API key.\n\nWhat to check: Package name, installed version, server-versus-browser usage, and that secret keys remain server-side.",
    tags: ["SDKs", "Node", "JavaScript", "React", "developer"],
    keywords: ["@pinetreepayments/node", "@pinetreepayments/js", "@pinetreepayments/react", "npm install"]
  },
  {
    id: "woocommerce",
    title: "WooCommerce setup",
    category: "Developer/API",
    description: "Download and test the PineTree WooCommerce plugin from Developer → Integrations.",
    body: "Open Developer → Integrations and download the PineTree WooCommerce plugin from the dashboard. Install it in a WooCommerce test store first, then add your PineTree API key in the plugin settings.\n\nConfigure the webhook URL using ?wc-api=pinetree_webhook. Create a test order and confirm checkout opens PineTree Checkout. After payment, confirm the paid webhook updates the WooCommerce order.\n\nWhat this means: Duplicate webhook events should not duplicate order notes or status changes. If an order needs another status check, use Manual sync from the order screen.\n\nWhat to check: Plugin activation, API key, webhook URL, test order, checkout handoff, paid status, duplicate-event handling, and Manual sync.",
    tags: ["WooCommerce", "plugin", "webhooks", "Developer → Integrations"],
    keywords: ["dashboard plugin download", "?wc-api=pinetree_webhook", "Manual sync", "test order"]
  },
  {
    id: "shopify",
    title: "Shopify connection",
    category: "Developer/API",
    description: "Connect a Shopify store from Developer → Integrations when Shopify is enabled for PineTree.",
    body: "Open Developer → Integrations. The Shopify card shows Not connected until a store is linked. Enter your Shopify store domain, click Connect Shopify, and approve the PineTree app in Shopify. Return to PineTree and confirm the store shows Connected.\n\nWhat this means: Shopify must be enabled by PineTree deployment configuration before merchants can connect. If connection controls are unavailable, contact PineTree support.\n\nWhat to check: Store domain, approval in Shopify, return to PineTree, Connected status, and a small checkout test after setup is enabled.",
    tags: ["Shopify", "Developer → Integrations", "Connected", "Not connected"],
    keywords: ["Connect Shopify", "store domain", "approve app", "deployment configuration"]
  },
  {
    id: "event-model",
    title: "Event model",
    category: "Developer/API",
    description: "Use PineTree payment events and statuses to keep your integration in sync.",
    body: "PineTree reports events such as payment.pending, payment.processing, payment.confirmed, and payment.failed as a payment moves through checkout.\n\nWhat this means: Treat PineTree payment status as the source of truth instead of assuming a customer browser action completed the payment.\n\nWhat to check: Payment status, provider reference, webhook delivery, duplicate-event handling, and the matching transaction row.",
    tags: ["events", "status", "developer", "webhooks"],
    keywords: ["event processor", "payment event", "source of truth"]
  },
  {
    id: "payment-stuck-pending",
    title: "Payment stuck pending",
    category: "Troubleshooting",
    description: "Pending usually means PineTree is still waiting for the customer or provider to start completing the payment.",
    body: "A payment stuck Pending may mean the customer did not approve the wallet request, closed checkout, scanned the wrong thing, or the provider did not return a usable activity signal.\n\nWhat this means: PineTree has a payment record, but it may not have enough evidence to move forward.\n\nWhat to check: Customer action, wallet/provider page, payment ID, selected asset, checkout link status, and whether the customer retried.",
    tags: ["pending", "stuck", "troubleshooting"],
    keywords: ["stuck pending", "customer closed"]
  },
  {
    id: "payment-stuck-processing",
    title: "Payment stuck processing",
    category: "Troubleshooting",
    description: "Processing means activity was detected, but final confirmation has not been applied yet.",
    body: "A Processing payment may be waiting for on-chain validation, provider completion, webhook delivery, or final state transition. This is especially important for wallet rails where PineTree may need to verify amount, reference, and fee evidence.\n\nWhat this means: Do not immediately create a second payment until you have checked whether the first one may still confirm.\n\nWhat to check: Transaction hash, provider reference, network explorer evidence, provider dashboard, elapsed time, and support ticket details if it remains unresolved.",
    tags: ["processing", "stuck", "confirmation"],
    keywords: ["stuck processing", "transaction hash"]
  },
  {
    id: "wallet-did-not-open",
    title: "Wallet did not open",
    category: "Troubleshooting",
    description: "Wallet opening depends on device, installed wallet, browser context, and selected wallet type.",
    body: "If a wallet does not open, the selected wallet may not be installed, the page may be in the wrong browser context, the mobile deep link may have been blocked, or the wallet provider may not be injected on the device.\n\nWhat this means: The payment may never leave Pending because the customer did not reach the wallet approval step.\n\nWhat to check: Wallet installed, selected wallet type, mobile return behavior, browser permissions, and whether the customer can open the checkout page inside the wallet browser.",
    tags: ["wallet", "mobile", "deeplink", "troubleshooting"],
    keywords: ["Phantom", "Solflare", "MetaMask", "Base Wallet"]
  },
  {
    id: "customer-closed-checkout",
    title: "Customer closed checkout",
    category: "Troubleshooting",
    description: "Closing checkout before approval can leave the payment pending, incomplete, canceled, or expired depending on the path.",
    body: "If a customer closes checkout before approving a payment, PineTree may never receive a completion signal. In some flows a canceled or expired status can be shown. In others, the payment may remain Pending until a retry or timeout path handles it.\n\nWhat this means: Customer browser behavior matters. A closed tab is not the same as a successful payment.\n\nWhat to check: Whether the customer approved the payment, whether a transaction hash exists, link expiration, and whether a new checkout attempt was created.",
    tags: ["checkout", "closed", "cancel", "expired"],
    keywords: ["closed tab", "abandoned checkout"]
  },
  {
    id: "provider-not-connected",
    title: "Provider not connected",
    category: "Troubleshooting",
    description: "A missing provider connection can prevent a payment method from appearing or being prepared.",
    body: "If a provider is not connected, PineTree may not show that payment option or may fail to create the payment. PineTree Wallet manages Solana Pay, Base Pay, and Bitcoin Lightning. Shift4 needs credentials.\n\nWhat this means: The checkout experience is driven by configured rails.\n\nWhat to check: Providers page status, wallet address, credentials, PineTree Wallet status, and a small test payment after saving.",
    tags: ["provider", "not connected", "setup"],
    keywords: ["missing payment method", "provider unavailable"]
  },
  {
    id: "wallet-connected-payment-not-complete",
    title: "Wallet connected but payment did not complete",
    category: "Troubleshooting",
    description: "A merchant wallet connection does not guarantee customer approval or successful on-chain/payment-provider confirmation.",
    body: "A saved merchant wallet only tells PineTree where to route supported wallet-rail payments. The customer must still open their wallet, review the amount, approve the transaction, and return enough evidence for PineTree to confirm.\n\nWhat this means: Wallet setup can be correct while an individual customer payment still fails or stalls.\n\nWhat to check: Customer approval, selected asset, exact amount, network, transaction hash, payment ID, and whether the status is Pending, Processing, or Failed.",
    tags: ["wallet", "connected", "payment failed"],
    keywords: ["wallet connected", "did not complete"]
  },
  {
    id: "dashboard-numbers-look-off",
    title: "Dashboard numbers look off",
    category: "Troubleshooting",
    description: "Different pages summarize different slices of payment, transaction, report, and wallet-balance data.",
    body: "If dashboard numbers look different across pages, compare what each page is counting. Transactions may show rows across statuses. Reports emphasize confirmed volume for the selected window. Wallets shows connected balance visibility, not sales volume.\n\nWhat this means: A balance, a transaction count, and a report total are related but not the same measurement.\n\nWhat to check: Date window, status, channel, provider, network, time zone, failed/incomplete rows, and whether the payment is confirmed.",
    tags: ["dashboard", "numbers", "reports", "transactions"],
    keywords: ["numbers wrong", "metrics", "volume"]
  },
  {
    id: "open-support-ticket",
    title: "When to open a support ticket",
    category: "Troubleshooting",
    description: "Open a ticket when the dashboard does not give enough detail to resolve a payment or setup issue.",
    body: "Open a support ticket when a payment stays unclear after you check status, provider, network, amount, timestamp, and payment ID. Tickets are also useful for dashboard issues, settlement questions, wallet connection problems, provider setup questions, POS issues, API support, and feature requests.\n\nWhat this means: The fastest tickets include specific evidence instead of only a general description. For payment issues, include the payment ID, provider, wallet/network, approximate time, amount, and transaction hash if available.\n\nWhat to check: Include payment ID, related payment ID field if available, provider, network, amount, customer action, timestamp, screenshots if useful, and what you expected to happen.",
    tags: ["support", "ticket", "troubleshooting"],
    keywords: ["open ticket", "support", "help", "transaction hash", "payment id"]
  },
  {
    id: "support-escalation-boundaries",
    title: "What PineTree support needs to review",
    category: "Troubleshooting",
    description: "Some payment, provider, compliance, and account-level questions require PineTree support or admin review.",
    body: "PineTree AI can explain setup steps and basic troubleshooting, but it should escalate when funds are missing, a payment is stuck after funds were sent, a transaction is confirmed on-chain but not in PineTree, a provider connection fails repeatedly, or the issue involves account suspension, compliance, underwriting, KYC/KYB, fraud, refunds, disputes, legal questions, tax advice, or account review.\n\nWhat this means: PineTree AI should not guess about money movement, provider approval, account restrictions, or private account data. Those issues need a support ticket so PineTree can review authorized account and payment records.\n\nWhat to check: Open a support ticket and include payment ID, provider, wallet/network, approximate time, transaction hash if available, screenshots if helpful, and a short description of what the customer did.",
    tags: ["support", "escalation", "funds", "admin review"],
    keywords: ["missing funds", "refund", "dispute", "KYC", "KYB", "compliance", "legal", "tax", "confirmed on-chain"]
  },
  {
    id: "assistant-what-it-will-do",
    title: "What PineTree AI can help with",
    category: "PineTree Assistant",
    description: "PineTree AI helps merchants understand PineTree setup, payment states, provider connections, POS, checkout, dashboards, and support boundaries.",
    body: "PineTree AI is a guided support helper for PineTree merchant onboarding, account setup, payment rails, wallets, POS, hosted checkout, dashboard sections, transaction statuses, fees, and support escalation. It uses PineTree help content and should stay specific to PineTree workflows.\n\nWhat this means: PineTree AI is not a generic chatbot. It should explain PineTree concepts in plain English and avoid claiming unsupported provider behavior or live account approval.\n\nWhat to check: Ask about setup, pending payments, incomplete transactions, provider connections, wallet setup, POS checkout, hosted checkout links, or what to include in a support ticket.",
    tags: ["assistant", "PineTree AI", "docs", "setup"],
    keywords: ["AI assistant", "help assistant", "account setup", "payment statuses"]
  },
  {
    id: "assistant-local-docs-only",
    title: "How PineTree AI uses Help Center information",
    category: "PineTree Assistant",
    description: "PineTree AI uses Help Center guidance and does not inspect private merchant data from this page.",
    body: "The PineTree AI panel uses PineTree help documentation and structured support guidance. It does not read private merchant account data from the Help Center and should not claim a provider account is approved or funds are received unless authorized PineTree data shows that status.\n\nWhat this means: PineTree AI can explain what to check, but account-specific payment confirmation or provider approval questions should move to a support ticket.\n\nWhat to check: Search terms, matching docs, and whether a support ticket is better for account-specific problems.",
    tags: ["assistant", "help docs", "privacy"],
    keywords: ["private data", "help search", "merchant context", "authorized data"]
  },
  {
    id: "assistant-boundaries",
    title: "What PineTree AI can and cannot answer",
    category: "PineTree Assistant",
    description: "PineTree AI answers setup and support questions, but escalates money movement, compliance, and account-review issues.",
    body: "PineTree AI should answer questions about PineTree workflows, help docs, payment statuses, provider setup, wallet connections, POS, checkout, dashboard basics, and support ticket preparation. It should not invent provider behavior, expose secrets, provide legal or tax advice, or claim a payment is complete unless PineTree status supports that.\n\nWhat this means: If the question involves missing funds, stuck payments after funds were sent, confirmed on-chain activity not showing in PineTree, repeated provider setup failures, refunds, disputes, account suspension, compliance, underwriting, KYC/KYB, fraud, legal, tax, or account review, PineTree AI should send the merchant to support.\n\nWhat to check: Source docs, merchant scope, whether the question needs live account data, and whether a human support ticket is more appropriate.",
    tags: ["assistant", "boundaries", "safety"],
    keywords: ["AI boundaries", "grounded answers", "merchant context", "escalate"]
  }
]
