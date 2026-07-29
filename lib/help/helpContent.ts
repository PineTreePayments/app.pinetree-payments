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
    body: "PineTree helps merchants create payment requests, connect supported providers and wallets, review transaction activity, and generate reports from one dashboard.\n\nWhat this means: PineTree is not just a wallet screen. It coordinates payment creation, provider selection, payment status tracking, checkout links, POS terminals, wallet balances, and reporting views.\n\nWhat to check: Before accepting real payments, review Providers, Wallets, Online Checkout, POS terminals, and Reports so you know which rails are connected and how confirmed payments will appear.",
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
    body: "Start by completing the Business Profile, creating a PineTree Wallet, and confirming at least one supported payment rail is ready. Solana Pay, Base Pay, and Bitcoin Lightning are managed through PineTree Wallet. Stripe uses embedded Stripe onboarding. Shift4 and Fluid Pay require provider onboarding or approval before card routing can be enabled. Then create a small checkout link or POS test sale and confirm that the payment status updates as expected.\n\nWhat this means: PineTree needs both merchant setup and a configured route before it can create a live customer payment. PineTree stores setup state and routing preferences, while connected providers decide their own account approval, capabilities, and settlement availability.\n\nWhat to check: Business Profile status, provider status, Enabled or Disabled toggle, wallet address, supported asset, test amount, payment status, transaction row, and report visibility. Do not rely on a payment method until a small end-to-end test succeeds.",
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
    body: "Use a small amount to test each payment method you plan to show customers. For POS, create or open a terminal and complete a reader, manual-card, cash, or crypto flow as applicable. Stripe test mode can create a Sandbox Reader when Stripe Terminal is configured for testing. For hosted checkout, create a payment link or checkout session. For wallet rails, verify that the wallet opens, the amount looks right, and the payment status updates.\n\nWhat this means: A provider can appear configured while a specific customer path still needs verification on your device, wallet, or account. Sandbox readers only exercise Stripe Terminal test behavior; PineTree API keys are still live-format keys.\n\nWhat to check: Amount breakdown, Platform Fee line, wallet opening behavior, provider redirect or card reader action, final status, transaction row, and report export.",
    tags: ["testing", "go live", "checkout", "pos"],
    keywords: ["before going live", "test checkout"]
  },
  {
    id: "how-pos-works",
    title: "How PineTree POS works",
    category: "Accepting Payments",
    description: "PineTree POS supports terminal setup, amount entry, cash handling, crypto payment creation, and status updates.",
    body: "PineTree POS is built for in-person checkout. In the POS dashboard, merchants create terminals with a register name, recovery phrase, four-digit PIN, optional auto-lock, optional tax settings, and optional starting cash amount. Launching a terminal opens the terminal checkout flow.\n\nWhat this means: In the terminal, the cashier enters an amount, reviews the total, and chooses an available payment method. Cash is recorded through the drawer flow. Crypto creates a payment request and shows a QR while PineTree watches for status updates. Native POS card flows stay inside the POS card experience: reader payments are sent to a Stripe Card Reader, manual entry uses secure Stripe card entry, and fallback links are only created when the cashier chooses Send Payment Link.\n\nWhat to check: Terminal ID, selected payment method, assigned or online reader, drawer state for cash, QR visibility for crypto, and whether the payment reaches Confirmed, Failed, Incomplete, Expired, or Canceled. Transaction results render inside the POS experience with New Sale actions.",
    tags: ["pos", "terminal", "cash", "qr"],
    keywords: ["point of sale", "cash drawer", "terminal"]
  },
  {
    id: "pos-card-reader-setup",
    title: "Card reader setup and terminal management",
    category: "Accepting Payments",
    description: "POS card payments use Stripe Terminal readers, locations, registration, and simulated readers where available.",
    body: "POS card acceptance depends on Stripe setup, merchant onboarding, Terminal locations, and reader availability. PineTree can refresh readers, create a Stripe Terminal location, register a physical reader with the reader registration code, and create a Sandbox Reader when Stripe test-mode Terminal support is available.\n\nWhat this means: A terminal can exist in PineTree before card readers are ready. If no online reader is available, the card experience shows setup, refresh, manual entry, Sandbox Reader, or Send Payment Link options based on capability.\n\nWhat to check: Stripe provider status, Stripe onboarding status, Terminal location, reader registration code, reader online/offline/busy status, default reader selection, terminal session authentication, and whether card routing is Enabled.",
    tags: ["pos", "card reader", "stripe terminal", "sandbox reader"],
    keywords: ["reader unavailable", "terminal not assigned", "simulated reader", "Stripe Terminal"]
  },
  {
    id: "pos-manual-card-and-fallback",
    title: "Manual card entry and fallback links",
    category: "Accepting Payments",
    description: "Manual card entry and fallback links are explicit POS card options, not the default reader flow.",
    body: "When card payments are available, POS first recommends an online Stripe Card Reader. If manual entry is enabled, Enter Card Manually prepares a Stripe manual-card payment and renders secure card entry inside the POS card panel. If the cashier chooses Send Payment Link, PineTree creates an explicit card fallback link that can be shared with the customer.\n\nWhat this means: Native POS card payments do not automatically open Hosted Checkout. Reader payments, manual entry, and fallback links are separate card collection paths inside the POS experience.\n\nWhat to check: Manual entry enabled, Stripe account ID and client secret returned, return URL with manual payment ID, fallback link creation, customer completion, and final card status in the POS result screen.",
    tags: ["pos", "manual card", "fallback link", "stripe"],
    keywords: ["manual entry", "hosted fallback", "payment link", "card"]
  },
  {
    id: "cash-transactions",
    title: "Cash transactions",
    category: "Accepting Payments",
    description: "POS cash handling records tendered cash and drawer activity without provider authorization.",
    body: "Cash is a POS-only collection path. The cashier enters the sale amount, chooses Cash, enters tendered cash, reviews change due, and records the sale through the drawer flow. Cash does not require a card provider, wallet approval, or blockchain confirmation.\n\nWhat this means: A cash sale can be recorded as completed operational activity, but it is not a provider payment and has no provider reference or on-chain transaction hash.\n\nWhat to check: Drawer open state, starting drawer amount, tendered amount, change due, cash sale row, closeout amount, and report totals for Cash rail volume.",
    tags: ["cash", "pos", "drawer", "reports"],
    keywords: ["cash drawer", "cash completion", "closeout"]
  },
  {
    id: "hosted-checkout-works",
    title: "How hosted checkout works",
    category: "Accepting Payments",
    description: "Hosted checkout sends customers to a PineTree payment page where they choose an available asset or provider path.",
    body: "Hosted checkout uses PineTree pages to guide a customer through payment. A checkout link resolves to a payment intent, then redirects to the PineTree payment screen. The customer sees the amount, Platform Fee, total, and available payment assets based on the configured networks.\n\nWhat this means: The checkout page does not complete payment by itself. The customer still needs to choose a payment method and approve the provider or wallet step.\n\nWhat to check: Link status, expiration, selected asset, wallet/provider handoff, success or cancel URL, and final payment status.",
    tags: ["hosted checkout", "checkout", "pay page", "customer"],
    keywords: ["checkout link", "payment intent", "success url", "cancel url"]
  },
  {
    id: "online-checkout-links",
    title: "How online checkout links work",
    category: "Accepting Payments",
    description: "Online Checkout creates shareable links with amount, name, description, customer email, reference, and expiration options.",
    body: "The Online Checkout page can create payment links for fixed amounts entered by the merchant. Links can include a name, description, optional customer email, optional reference, and expiration such as never, 24 hours, 7 days, or 30 days. Active links point customers into PineTree checkout.\n\nWhat this means: A disabled, expired, or archived link will not prepare a customer payment. PineTree shows a link-unavailable screen instead of sending the customer into payment. Archiving retires the link from the active working set; it is not a permanent hard-delete flow.\n\nWhat to check: Link status, checkout URL, fixed amount, expiration, customer reference, whether the link has been disabled, and whether old links should be archived.",
    tags: ["payment links", "online checkout", "links"],
    keywords: ["checkout links", "active", "disabled", "expired"]
  },
  {
    id: "what-customers-see-checkout",
    title: "What customers see during checkout",
    category: "Accepting Payments",
    description: "Customers see a PineTree Checkout card with amount details and payment asset choices.",
    body: "During hosted checkout, customers see PineTree Checkout, subtotal, Platform Fee, total, and supported asset or provider choices such as SOL, USDC on Solana, ETH on Base, USDC on Base, Stripe or Shift4 cards, or Bitcoin Lightning when those rails are available for that merchant.\n\nWhat this means: The visible choices depend on merchant configuration, provider readiness, Enabled or Disabled controls, and the networks available for the payment intent.\n\nWhat to check: If a customer does not see the expected option, review Providers and Wallets first. Then check whether the selected provider supports that checkout channel and asset.",
    tags: ["customer", "checkout", "assets", "Platform Fee"],
    keywords: ["customer view", "asset selector", "fee display"]
  },
  {
    id: "after-customer-pays",
    title: "What happens after a customer pays",
    category: "Accepting Payments",
    description: "PineTree waits for provider, wallet, webhook, or watcher signals before finalizing status.",
    body: "After the customer approves a payment, PineTree updates status through provider webhooks, wallet callbacks, transaction detection, or a bounded status check depending on the rail. Confirmed payments appear as confirmed activity in the dashboard and reports.\n\nWhat this means: There can be a short gap between customer action and final status. Pending and Processing are normal intermediate states.\n\nWhat to check: Payment ID, provider reference, network, transaction hash if available, and whether the payment is still pending, processing, confirmed, failed, or incomplete.",
    tags: ["after payment", "status", "webhooks", "watcher"],
    keywords: ["customer paid", "confirmation", "transaction hash"]
  },
  {
    id: "fee-display",
    title: "How Platform Fee display works",
    category: "Accepting Payments",
    description: "Checkout and POS can show subtotal, taxes when configured, Platform Fee, and total.",
    body: "PineTree calculates a merchant amount and Platform Fee when creating payment requests. POS can also include terminal tax settings when configured. Hosted checkout displays the subtotal, Platform Fee, and total before the customer chooses a payment asset.\n\nWhat this means: The customer-facing total may be higher than the merchant amount because it includes the Platform Fee and any applicable tax. Use a fixed $0.15 per transaction only where the current configured PineTree Platform Fee is explicitly shown for that flow.\n\nWhat to check: Subtotal, tax line, Platform Fee line, total due, provider fee behavior, and the report row after confirmation.",
    tags: ["fees", "Platform Fee", "tax", "amount"],
    keywords: ["Platform Fee", "gross amount", "subtotal"]
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
    description: "The Wallets navigation opens the PineTree Wallet workspace for setup, balances, addresses, settings, and supported withdrawals.",
    body: "The Wallets navigation opens the PineTree Wallet workspace. It shows wallet setup, connected rail readiness, balances, recent activity, address book, settings, and a withdrawal workflow for supported assets when the wallet, rail, destination, and signer path are ready.\n\nWhat this means: Payments and withdrawals are different workflows. A payment collects customer funds. A withdrawal moves available PineTree Wallet funds to a saved destination. Provider submission or wallet signing does not mean the withdrawal is final; it remains submitted, processing, or confirming until provider or chain evidence marks it confirmed.\n\nWhat to check: Available balance, reserved fee, selected rail and asset, destination address, review screen, approval method, submitted transaction hash or provider reference, Processing/Confirming status, and final Confirmed or Failed result.",
    tags: ["wallets", "withdrawals", "balances"],
    keywords: ["withdraw", "transfer", "settlement"]
  },
  {
    id: "providers-page-overview",
    title: "Providers page overview",
    category: "Provider Connections",
    description: "Providers is where merchants connect payment rails and manage routing settings.",
    body: "The Providers page lists payment providers and rails including Stripe, Shift4, Fluid Pay, Solana Pay, Base Pay, Bitcoin Lightning, and Coinbase Business where configured. Card providers require onboarding or approval before routing can be enabled. Solana, Base, and Bitcoin Lightning depend on PineTree Wallet readiness in canonical wallet mode. Provider controls use Enabled and Disabled for whether a ready rail is available for payment routing.\n\nWhat this means: Connected or approved setup and the Enabled toggle are related but separate. Connected means PineTree has the required account, credential, or wallet reference. Enabled means PineTree may offer that rail when creating payments.\n\nWhat to check: Provider status, Enabled or Disabled toggle, business profile completion, card onboarding status, wallet rows for Solana/Base, Lightning Speed account readiness, and provider-specific missing requirements.",
    tags: ["providers", "routing", "settings"],
    keywords: ["payment providers", "smart routing", "auto conversion"]
  },
  {
    id: "shift4-provider-status",
    title: "Shift4 provider status",
    category: "Provider Connections",
    description: "Shift4 card routing depends on merchant onboarding and provider setup.",
    body: "Shift4 is a card provider row with an application and setup path. PineTree only enables Shift4 routing when the merchant setup is approved or otherwise marked ready by the current provider-readiness rules. Shift4 can be used for supported online/API card paths after setup; it is not the native Stripe Terminal reader path used by POS card readers.\n\nWhat this means: If Shift4 is not approved, not connected, or Disabled, PineTree should not present it as a ready card payment option.\n\nWhat to check: Shift4 application status, account reference, Enabled or Disabled toggle, readiness error, provider webhook/status mapping, and a small card checkout test after approval.",
    tags: ["shift4", "hosted checkout", "credentials"],
    keywords: ["card", "fiat", "api key", "redirect"]
  },
  {
    id: "stripe-provider-status",
    title: "Stripe provider status",
    category: "Provider Connections",
    description: "Stripe uses Connect onboarding for card acceptance and Terminal for POS reader flows.",
    body: "Stripe setup is handled through Stripe Connect embedded onboarding. PineTree creates or retrieves the connected account, shows onboarding or verification status, and synchronizes whether charges are enabled. POS card readers use Stripe Terminal locations, readers, and payment intents on the connected account.\n\nWhat this means: Stripe may be Not connected, Setup needed, Verification pending, Action required, Connected, or Disabled. A connected account still needs charges enabled before PineTree can route card payments.\n\nWhat to check: Stripe connection status, details submitted, charges enabled, outstanding requirements, Terminal location, reader online status, manual entry availability, and whether the provider is Enabled.",
    tags: ["stripe", "card", "terminal", "onboarding"],
    keywords: ["Stripe Connect", "charges enabled", "reader unavailable", "onboarding incomplete"]
  },
  {
    id: "fluidpay-provider-status",
    title: "Fluid Pay provider status",
    category: "Provider Connections",
    description: "Fluid Pay is an early-access card provider gated by onboarding and API-contract readiness.",
    body: "Fluid Pay appears as a card provider with setup and application status. Current readiness requires approved onboarding and the Fluid Pay API contract to be verified by PineTree before routing is considered ready.\n\nWhat this means: Approval alone may not make Fluid Pay live if the API contract is still gated. Do not treat Fluid Pay as generally available for all merchants.\n\nWhat to check: Fluid Pay application status, provider setup result, readiness message, Enabled or Disabled toggle, and whether PineTree has confirmed that Fluid Pay routing is available for the merchant.",
    tags: ["fluidpay", "Fluid Pay", "card", "early access"],
    keywords: ["FluidPay", "underwriting", "provider disabled", "limited availability"]
  },
  {
    id: "lightning-managed-provider-status",
    title: "Bitcoin Lightning provider status",
    category: "Provider Connections",
    description: "Lightning is managed through PineTree Wallet and Speed account readiness.",
    body: "Bitcoin Lightning is managed through PineTree Wallet. In the current managed Speed path, PineTree checks Speed platform configuration, merchant Speed account readiness, Bitcoin payout readiness, and the merchant Enabled toggle before Lightning payments are live. Legacy NWC-style Lightning connection support may exist in code but is not the primary managed-wallet setup path.\n\nWhat this means: Lightning can be configured, pending, needs attention, or unavailable depending on PineTree Wallet and Speed readiness. A Lightning provider row being present does not always mean invoice creation is live.\n\nWhat to check: PineTree Wallet status, Bitcoin receive address, Speed account readiness, payout readiness, provider Enabled or Disabled state, and whether invoice creation succeeds in a small test payment.",
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
    body: "A connected provider has the configuration PineTree needs for that rail, such as a saved wallet address, provider account, card onboarding record, or verified Lightning account details. Unconnected means setup is missing or incomplete. Disabled means the merchant has turned routing off, even if the setup remains connected.\n\nWhat this means: Connected does not guarantee every customer payment will succeed. It means PineTree has enough configuration to attempt that rail when it is also Enabled and provider readiness passes.\n\nWhat to check: Enabled or Disabled toggle, wallet address, credentials, onboarding status, provider-specific setup fields, and a small test payment.",
    tags: ["connected", "unconnected", "provider status"],
    keywords: ["status", "enabled", "not connected"]
  },
  {
    id: "credentials-and-ids",
    title: "What credentials and IDs mean",
    category: "Provider Connections",
    description: "Some provider fields identify accounts or payment addresses; others are secrets and should be treated carefully.",
    body: "The dashboard may ask for provider-specific values such as a provider account reference, setup application details, or a wallet address. API keys and provider credentials are sensitive. Wallet addresses identify where PineTree should route wallet-rail payments.\n\nWhat this means: Enter values exactly as shown by the provider or wallet. Do not share API keys, provider secrets, Speed account credentials, or private wallet material in support tickets unless PineTree specifically provides a secure process.\n\nWhat to check: Field label, provider dashboard source, copied value, masked account reference, and whether the provider status updates after saving.",
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
    description: "Confirmed means PineTree reached the terminal payment state that can be fulfilled.",
    body: "Confirmed means PineTree considers the payment final for fulfillment. Confirmed payments are counted as confirmed volume in report summaries and can write ledger activity.\n\nWhat this means: This is the final positive state for the payment lifecycle.\n\nWhat to check: Transaction row, report window, provider reference, and amount if the customer or provider dashboard shows a different result.",
    tags: ["confirmed", "success", "status", "reports"],
    keywords: ["successful", "complete", "ledger"]
  },
  {
    id: "status-failed",
    title: "What Failed means",
    category: "Transaction Statuses",
    description: "Failed means PineTree or the provider could not complete the payment successfully.",
    body: "Failed means the payment reached a negative terminal state. This can happen when a provider declines or fails a payment, the wallet flow errors, or detection rejects the transaction.\n\nWhat this means: A failed payment usually needs a new attempt if the customer still wants to pay.\n\nWhat to check: Payment ID, provider reference, network, customer wallet result, error message, and whether the customer attempted another payment.",
    tags: ["failed", "status", "declined", "error"],
    keywords: ["payment failed", "declined", "try again"]
  },
  {
    id: "status-expired",
    title: "What Expired means",
    category: "Transaction Statuses",
    description: "Expired means the provider or checkout payment window ended before payment evidence arrived.",
    body: "Expired is a distinct terminal lifecycle state. PineTree uses it only when provider or checkout evidence says the payment window ended without a completed payment.\n\nWhat this means: The payment is not successful and is not merely a generic Incomplete attempt.\n\nWhat to check: Payment ID, expiration time, provider reference, and whether any funds or transaction hash exist before creating a new attempt.",
    tags: ["expired", "status", "timeout"],
    keywords: ["payment expired", "window ended"]
  },
  {
    id: "status-canceled",
    title: "What Canceled means",
    category: "Transaction Statuses",
    description: "Canceled means a merchant or customer explicitly stopped the payment before completion.",
    body: "Canceled is a distinct terminal lifecycle state backed by an explicit cancellation action or provider outcome.\n\nWhat this means: The payment is not successful, and it is different from Expired or a generic Incomplete attempt.\n\nWhat to check: Payment ID, cancellation event and time, provider reference, and whether any funds or transaction hash exist before creating a new attempt.",
    tags: ["canceled", "cancelled", "status"],
    keywords: ["payment canceled", "merchant canceled"]
  },
  {
    id: "status-incomplete",
    title: "What Incomplete means",
    category: "Transaction Statuses",
    description: "Incomplete means the payment ended without a more specific authoritative terminal outcome.",
    body: "Incomplete is used when a payment cannot continue through the normal lifecycle and PineTree has no authoritative Failed, Expired, or Canceled outcome.\n\nWhat this means: The payment is not successful, but it is not silently reclassified as a provider rejection, expiration, or explicit cancellation.\n\nWhat to check: Customer behavior, provider or wallet evidence, and whether a new payment should be created.",
    tags: ["incomplete", "unfinished", "status"],
    keywords: ["unfinished", "abandoned", "no terminal evidence"]
  },
  {
    id: "payment-mismatch-incorrect-amount",
    title: "Payment mismatch or incorrect amount",
    category: "Transaction Statuses",
    description: "PineTree validates expected payment references, amounts, and fee evidence for wallet rails where applicable.",
    body: "Some wallet payments require PineTree to match the expected payment ID, amount, merchant leg, and Platform Fee evidence. For Solana split payments, the watcher looks for matching wallet activity and a memo/reference. For split EVM payments, PineTree requires enough evidence before final confirmation.\n\nWhat this means: A transaction can be real on-chain activity but still not be enough to confirm the PineTree payment if the amount or reference does not match.\n\nWhat to check: Exact amount, selected asset, payment ID or memo, receiving wallet, Platform Fee evidence, and transaction hash.",
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
    body: "Dashboard metrics are built from PineTree payment and transaction records. Pages such as Transactions, Reports, Wallets, and Online Checkout each show their own operational metrics and insights.\n\nWhat this means: Metrics depend on the report window, merchant scope, merchant-local timezone, and which payments reached a status that should count for that view.\n\nWhat to check: Date range, channel, provider, network filter, confirmed status, Platform Fee handling, and whether the payment exists in the transaction ledger.",
    tags: ["metrics", "overview", "dashboard"],
    keywords: ["analytics", "summary", "volume"]
  },
  {
    id: "transactions-page",
    title: "Transactions page",
    category: "Reports & Analytics",
    description: "Transactions shows ledger rows, today volume, confirmed rate, channel mix, and provider/network filters.",
    body: "The Transactions page loads merchant-scoped transaction data and shows today's volume, transaction count, confirmed rate, activity breakdown, channel mix, and a transaction ledger. Filters include wallet/provider, network, and channel.\n\nWhat this means: This is the best place to investigate individual payment activity before generating reports. Reports emphasize confirmed sales, while transaction views may include pending, processing, failed, incomplete, or cash activity depending on the ledger row.\n\nWhat to check: Provider, network, rail, channel, payment ID, provider transaction ID, status, created time, and whether the row is inside the same time window as the report.",
    tags: ["transactions", "ledger", "filters", "channel mix"],
    keywords: ["transaction ledger", "confirmed rate", "POS", "online"]
  },
  {
    id: "reports-page",
    title: "Reports page",
    category: "Reports & Analytics",
    description: "Reports can generate PDF summaries and CSV transaction exports for common time windows.",
    body: "The Reports page summarizes financial activity and can generate today's, yesterday's, weekly, monthly, tax, yearly, and transaction export reports. Transaction Export downloads CSV. Other report actions download PDFs and can be emailed. The ledger table is paginated and supports page sizes such as 25, 50, and 100 rows.\n\nWhat this means: Reports are generated from PineTree records for the selected report type or custom date range. Report ranges are resolved in the merchant's configured timezone, then queried against stored payment timestamps. Confirmed sales drive gross volume, average confirmed transaction, provider totals, rail totals, asset totals, Platform Fee totals, taxes, and reconciliation checks.\n\nWhat to check: Report type, date window, timezone, confirmed count, transaction count, pagination page size, exports, net settlements, taxes, Platform Fee total, provider totals, rail totals, asset totals, and reconciliation variance.",
    tags: ["reports", "pdf", "csv", "email"],
    keywords: ["download report", "tax report", "transaction export"]
  },
  {
    id: "wallet-balances",
    title: "Wallet balances",
    category: "Reports & Analytics",
    description: "Wallet balances show visible connected-wallet and payment-account value, with refresh support.",
    body: "The PineTree Wallet workspace shows total visible value from connected wallets and payment accounts, including native balance, available-to-withdraw amounts, reserved fees, and USD value rows where available. Merchants can refresh balances from the wallet overview endpoint.\n\nWhat this means: Wallet balances are operational visibility, not the same as a confirmed-payment report. Balance status labels such as synced, cached, pending sync, config missing, unavailable, or stale describe balance visibility, not whether a payment was confirmed.\n\nWhat to check: Last sync time, connection count, individual wallet rows, native balance, available-to-withdraw amount, reserved fee, USD value, balance status, and refresh errors.",
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
    body: "Developer lists payment-link endpoints for creating, listing, disabling, and archiving links. It also includes the checkout session endpoint for server-side session creation and redirecting customers to a PineTree checkout URL.\n\nWhat this means: Static links are useful for fixed offers with merchant-entered amounts. Dynamic checkout sessions are better when your backend creates a payment for a specific order. Archiving retires a link from normal use; it is not a customer-entered amount feature or a permanent hard-delete API.\n\nWhat to check: Amount, currency, checkout URL, token, success URL, cancel URL, link status, archive status, and whether your backend keeps API keys secret.",
    tags: ["payment links", "checkout session", "api"],
    keywords: ["/api/checkout/session", "/api/checkout-links", "token"]
  },
  {
    id: "webhooks",
    title: "Webhooks",
    category: "Developer/API",
    description: "Configure event delivery and review webhook activity from Developer.",
    body: "Open Developer, then Webhooks, to add your HTTPS endpoint and choose events such as payment.confirmed, payment.failed, payment.canceled, and checkout.session.created. PineTree shows delivery activity so you can review response status and attempts.\n\nWhat this means: Webhooks notify your backend when PineTree activity changes. Your handler should verify PineTree-Signature and PineTree-Timestamp, return a 2xx response promptly, and process repeated events safely. Failed deliveries are retried and can eventually require manual review.\n\nWhat to check: Endpoint URL, enabled events, signature verification, delivery status, response status, attempt count, event ID deduplication, retry result, and whether your endpoint is returning non-2xx responses.",
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
    description: "Download and test the PineTree WooCommerce plugin from Developer > Integrations.",
    body: "Open Developer > Integrations and download the PineTree WooCommerce plugin from the dashboard. Install it in a WooCommerce test store first, then add your PineTree secret API key and webhook signing secret in the plugin settings.\n\nConfigure the webhook URL using ?wc-api=pinetree_webhook. Create a test order and confirm checkout opens PineTree Checkout. After payment, confirm the checkout.session.completed or payment.confirmed flow updates the WooCommerce order.\n\nWhat this means: Duplicate webhook events should not duplicate order notes or status changes. If an order needs another status check, use Manual sync from the order screen. The plugin is a hosted-checkout gateway; it does not perform inventory synchronization.\n\nWhat to check: Plugin activation, API key, webhook URL, test order, checkout handoff, confirmed status, duplicate-event handling, terminal-order guard, and Manual sync.",
    tags: ["WooCommerce", "plugin", "webhooks", "Developer > Integrations"],
    keywords: ["dashboard plugin download", "?wc-api=pinetree_webhook", "Manual sync", "test order"]
  },
  {
    id: "shopify",
    title: "Shopify connection",
    category: "Developer/API",
    description: "Connect a Shopify store from Developer > Integrations when Shopify is enabled for PineTree.",
    body: "Open Developer > Integrations. The Shopify card shows Not connected until a store is linked. Enter your Shopify store domain, click Connect Shopify, approve the PineTree app in Shopify, and return to PineTree. The current code supports the Shopify OAuth connection and stores merchant installation status when deployment credentials are configured.\n\nWhat this means: Shopify must be enabled by PineTree deployment configuration before merchants can connect. Shopify checkout/payment-app availability remains gated by Shopify app approval and PineTree configuration. Inventory sync for Shopify is not automatically live just because the store is connected.\n\nWhat to check: Store domain, app credentials configured, approval in Shopify, return to PineTree, Connected status, token storage, inventory connector status, and a small checkout test only after the payment path is enabled.",
    tags: ["Shopify", "Developer > Integrations", "Connected", "Not connected"],
    keywords: ["Connect Shopify", "store domain", "approve app", "deployment configuration"]
  },
  {
    id: "inventory-catalog-syncing",
    title: "Item Catalog and inventory syncing",
    category: "Developer/API",
    description: "Inventory supports manual catalog items and CSV import, while external connectors are readiness-gated.",
    body: "The Inventory page supports a merchant-scoped item catalog with item name, SKU, category, price, cost, quantity, low-stock threshold, status filters, CSV import, and item movements. Manual CSV Import is available for creating catalog items. External connectors are shown with their own readiness: Shopify can connect a store when app credentials are configured, but catalog sync remains disabled until catalog access is available; Shift4/SkyTab requires partner catalog API access; Square and Clover require merchant OAuth and token storage before sync.\n\nWhat this means: Do not assume inventory synchronization is live just because a connector card is visible. Connected status only appears after merchant-scoped authorization or configuration exists, and Sync now appears only when the connector reports it can sync.\n\nWhat to check: Connector status, configuration message, Shopify installation status, Shift4/SkyTab partner access, Square/Clover OAuth readiness, CSV import summary, skipped SKUs, disconnected connectors, and whether the item catalog itself is available.",
    tags: ["inventory", "catalog", "Shopify", "Square", "Clover"],
    keywords: ["inventory sync", "connector disconnected", "CSV import", "Shift4 SkyTab"]
  },
  {
    id: "merchant-onboarding-kyb",
    title: "Merchant onboarding and KYB",
    category: "Developer/API",
    description: "PineTree stores business profile data and provider setup state, while providers handle their own regulated approval steps.",
    body: "PineTree's Business Profile collects merchant and owner information needed to gate PineTree payment setup. PineTree uses that profile to decide whether wallet setup, provider toggles, and rail readiness can proceed. Connected providers may still require their own onboarding, KYB, underwriting, verification, charges, payouts, settlement, or account approval before they can process payments.\n\nWhat this means: PineTree does not directly approve regulated provider accounts or guarantee provider settlement. Stripe, Shift4, Fluid Pay, Speed, Shopify, and other connected services may each enforce their own requirements. PineTree records status and blocks routing when local or provider readiness is incomplete.\n\nWhat to check: Business Profile status, missing required fields, provider onboarding status, Stripe charges and requirements, card application approval, Speed account readiness, provider Enabled or Disabled state, and support tickets for account-review questions.",
    tags: ["onboarding", "KYB", "business profile", "providers"],
    keywords: ["KYC", "underwriting", "settlement", "business profile"]
  },
  {
    id: "event-model",
    title: "Event model",
    category: "Developer/API",
    description: "Use PineTree payment events and statuses to keep your integration in sync.",
    body: "PineTree reports events such as payment.pending, payment.processing, payment.confirmed, and payment.failed as a payment moves through checkout.\n\nWhat this means: Treat PineTree payment status as the source of truth instead of assuming a customer browser action confirmed the payment.\n\nWhat to check: Payment status, provider reference, webhook delivery, duplicate-event handling, and the matching transaction row.",
    tags: ["events", "status", "developer", "webhooks"],
    keywords: ["event processor", "payment event", "source of truth"]
  },
  {
    id: "payment-stuck-pending",
    title: "Payment stuck pending",
    category: "Troubleshooting",
    description: "Pending usually means PineTree is still waiting for the customer or provider to start completing the payment.",
    body: "A payment stuck Pending may mean the customer did not approve the wallet request, closed checkout, scanned the wrong QR, the card reader never received the payment, or the provider did not return a usable activity signal.\n\nWhat this means: PineTree has a payment record, but it may not have enough evidence to move forward. Do not mark fulfillment complete from Pending alone.\n\nWhat to check: Customer action, wallet/provider page, reader status, terminal assignment, payment ID, selected asset, checkout link status, expiration, and whether the customer retried.",
    tags: ["pending", "stuck", "troubleshooting"],
    keywords: ["stuck pending", "customer closed"]
  },
  {
    id: "payment-stuck-processing",
    title: "Payment stuck processing",
    category: "Troubleshooting",
    description: "Processing means activity was detected, but final confirmation has not been applied yet.",
    body: "A Processing payment may be waiting for on-chain validation, provider completion, webhook delivery, reader completion, or final state transition. This is especially important for wallet rails where PineTree may need to verify amount, reference, and Platform Fee evidence.\n\nWhat this means: Do not immediately create a second payment until you have checked whether the first one may still confirm.\n\nWhat to check: Transaction hash, provider reference, network explorer evidence, provider dashboard, reader action, elapsed time, and support ticket details if it remains unresolved.",
    tags: ["processing", "stuck", "confirmation"],
    keywords: ["stuck processing", "transaction hash"]
  },
  {
    id: "wallet-did-not-open",
    title: "Wallet did not open",
    category: "Troubleshooting",
    description: "Wallet opening depends on device, installed wallet, browser context, and selected wallet type.",
    body: "If a wallet does not open, the selected wallet may not be installed, the page may be in the wrong browser context, the mobile deep link may have been blocked, the wallet provider may not be injected on the device, or the wallet may be on the wrong network. Withdrawal approvals can also appear stalled if the mobile authorization screen is hidden behind the wallet app, opened in the wrong wallet browser, or lost after a redirect.\n\nWhat this means: The payment may never leave Pending, or the withdrawal may remain awaiting authorization, because the customer or merchant did not reach the wallet approval step.\n\nWhat to check: Wallet installed, selected wallet type, Base or Solana network, mobile return behavior, browser permissions, whether the approval page was opened inside the wallet browser, and whether the customer rejected the approval.",
    tags: ["wallet", "mobile", "deeplink", "troubleshooting"],
    keywords: ["Phantom", "Solflare", "MetaMask", "Base Wallet"]
  },
  {
    id: "customer-closed-checkout",
    title: "Customer closed checkout",
    category: "Troubleshooting",
    description: "Closing checkout before approval can leave the payment pending, incomplete, canceled, or expired depending on the path.",
    body: "If a customer closes checkout before approving a payment, PineTree may never receive a confirmation signal. In some flows a canceled or expired status can be shown. In others, the payment may remain Pending until a retry or timeout path handles it.\n\nWhat this means: Customer browser behavior matters. A closed tab is not the same as a confirmed payment.\n\nWhat to check: Whether the customer approved the payment, whether a transaction hash exists, link expiration, and whether a new checkout attempt was created.",
    tags: ["checkout", "closed", "cancel", "expired"],
    keywords: ["closed tab", "abandoned checkout"]
  },
  {
    id: "provider-not-connected",
    title: "Provider not connected",
    category: "Troubleshooting",
    description: "A missing provider connection can prevent a payment method from appearing or being prepared.",
    body: "If a provider is not connected, PineTree may not show that payment option or may fail to create the payment. PineTree Wallet manages Solana Pay, Base Pay, and Bitcoin Lightning in managed mode. Stripe, Shift4, and Fluid Pay require their own provider setup and approval states.\n\nWhat this means: The checkout experience is driven by configured and ready rails. A missing provider, missing wallet address, missing Speed account, missing Stripe charges capability, or incomplete card onboarding can all block payment creation.\n\nWhat to check: Providers page status, Business Profile status, wallet address, card onboarding status, credentials or account reference, PineTree Wallet status, Speed readiness, and a small test payment after saving.",
    tags: ["provider", "not connected", "setup"],
    keywords: ["missing payment method", "provider unavailable"]
  },
  {
    id: "provider-disabled",
    title: "Provider connected but disabled",
    category: "Troubleshooting",
    description: "Disabled means PineTree should not route new payments to that provider even if setup data exists.",
    body: "A provider can be connected or approved but still Disabled. Disabled is the routing control on the Providers page; it keeps the rail from appearing as an available payment method for new checkout or POS payment creation.\n\nWhat this means: Connection status answers whether PineTree has the setup reference. Enabled or Disabled answers whether PineTree may use that ready rail for payment routing.\n\nWhat to check: Provider toggle, Business Profile completion, provider readiness message, Stripe charges enabled, Shift4 or Fluid Pay approval, PineTree Wallet readiness for wallet rails, and a small test after enabling.",
    tags: ["provider", "disabled", "routing"],
    keywords: ["enabled disabled", "payment option hidden", "provider disabled"]
  },
  {
    id: "onboarding-incomplete",
    title: "Onboarding incomplete",
    category: "Troubleshooting",
    description: "Incomplete business or provider onboarding can block card, wallet, Shopify, or Lightning readiness.",
    body: "PineTree may block payment setup when the Business Profile is incomplete or when a connected provider still needs verification, underwriting, account approval, settlement setup, charges enabled, or payout readiness. Stripe, Shift4, Fluid Pay, Speed, and Shopify can each require provider-side steps outside PineTree.\n\nWhat this means: PineTree can store setup state and show readiness, but provider approval and regulated account review remain provider-controlled.\n\nWhat to check: Business Profile missing fields, Stripe requirements and charges enabled, Shift4 application status, Fluid Pay application and API-contract readiness, Speed account readiness, Shopify deployment/app approval, and provider support notes.",
    tags: ["onboarding", "business profile", "KYB", "providers"],
    keywords: ["setup incomplete", "verification pending", "underwriting", "charges enabled"]
  },
  {
    id: "reader-or-terminal-unavailable",
    title: "Card reader or POS terminal unavailable",
    category: "Troubleshooting",
    description: "POS card flows require an authenticated terminal session, Stripe readiness, and an online reader for reader payments.",
    body: "If POS card collection cannot start, the terminal session may not be authenticated, the POS terminal may not be assigned correctly, Stripe may not be ready for charges, no Terminal location may exist, or no Stripe reader may be online. In test mode, a Sandbox Reader can be created when Stripe Terminal test support is configured.\n\nWhat this means: POS terminal setup and card reader readiness are separate. The cashier can still see manual entry or Send Payment Link options only when those fallback paths are available.\n\nWhat to check: Terminal ID, register PIN/session, Stripe provider status, Terminal location, reader registration code, reader online/offline/busy state, default reader, Sandbox Reader option, manual entry availability, and fallback link creation.",
    tags: ["POS", "card reader", "terminal", "Stripe Terminal"],
    keywords: ["reader unavailable", "terminal not assigned", "Sandbox Reader", "register code"]
  },
  {
    id: "wallet-wrong-network-or-rejected",
    title: "Wallet wrong network or approval rejected",
    category: "Troubleshooting",
    description: "Wallet payments and withdrawals can stall or fail when the wrong network is selected or the approval is rejected.",
    body: "A customer or merchant wallet may open but still fail if it is on the wrong Base or Solana network, the selected asset does not match the payment, the approval screen is dismissed, or the user rejects the wallet request. Mobile wallet approval can also be interrupted when the return page is hidden or the wrong wallet browser opens.\n\nWhat this means: A wallet handoff is not the same as a completed payment or withdrawal. PineTree needs the signed transaction or provider evidence before it can advance the status.\n\nWhat to check: Selected network, selected asset, wallet account, approval prompt, rejection message, transaction hash, return to PineTree, payment or withdrawal status, and whether a new attempt is required.",
    tags: ["wallet", "wrong network", "rejected", "mobile"],
    keywords: ["wrong network", "approval rejected", "wallet rejected", "Base network"]
  },
  {
    id: "payment-expired-or-terminal",
    title: "Payment expired or already terminal",
    category: "Troubleshooting",
    description: "Expired, canceled, failed, confirmed, or incomplete payment objects should not be reused for a new attempt.",
    body: "A checkout session, payment link attempt, POS payment, or provider session can reach a terminal state such as Confirmed, Failed, Incomplete, Expired, or Canceled. Once a payment object is terminal, create a new checkout or POS sale instead of trying to resume the same object.\n\nWhat this means: Retrying the same expired or terminal object can leave the customer on an unavailable page or create confusing duplicate attempts.\n\nWhat to check: Current status, link expiration, cancel or success redirect, provider session status, POS result screen, whether a new sale was started, and whether the old attempt should remain archived for audit history.",
    tags: ["expired", "terminal", "retry", "checkout"],
    keywords: ["already terminal", "expired payment", "canceled", "new sale"]
  },
  {
    id: "duplicate-request-idempotency",
    title: "Duplicate request or idempotency conflict",
    category: "Troubleshooting",
    description: "Idempotency keys protect create calls from duplicate work when retries happen.",
    body: "When an integration retries a create request with the same idempotency key and the same request body, PineTree should replay the original result instead of creating a duplicate. If the same idempotency key is reused with a different body, the API can reject it as a conflict.\n\nWhat this means: Use a stable idempotency key for one logical create operation, then generate a new key when the merchant intentionally starts a different checkout, payment link, or POS attempt.\n\nWhat to check: Idempotency-Key header, request body, original response, 409 conflict response, network retry behavior, and whether the integration is accidentally reusing keys across different orders.",
    tags: ["API", "idempotency", "duplicate", "409"],
    keywords: ["duplicate request", "idempotency conflict", "409", "replay"]
  },
  {
    id: "withdrawal-submitted-not-confirmed",
    title: "Withdrawal submitted but not confirmed",
    category: "Troubleshooting",
    description: "Submitted, processing, and confirming withdrawals are not final until provider or chain evidence confirms them.",
    body: "A withdrawal may move through review, awaiting authorization, signed, submitting, submitted, processing, confirming, confirmed, failed, canceled, or blocked states depending on the rail and signer path. A successful wallet signature or provider submission means the request was sent, not that final settlement is complete.\n\nWhat this means: Do not treat Submitted or Processing as final. Wait for provider or chain evidence to mark the withdrawal Confirmed, or investigate Failed, Canceled, or Blocked states.\n\nWhat to check: Available balance, reserved fee, destination, review screen, mobile approval session, provider reference, transaction hash, reconciliation status, and final Confirmed or Failed result.",
    tags: ["withdrawals", "submitted", "processing", "confirmed"],
    keywords: ["withdrawal submitted", "not confirmed", "awaiting authorization", "processing withdrawal"]
  },
  {
    id: "webhook-delivery-failed",
    title: "Webhook delivery failed",
    category: "Troubleshooting",
    description: "Webhook endpoints must verify signatures and return a quick 2xx response to avoid retries.",
    body: "Webhook delivery can fail when the endpoint is not HTTPS, the URL is unreachable, signature verification fails, the handler takes too long, or the endpoint returns a non-2xx status. PineTree tracks delivery attempts and can retry or mark events for manual review depending on the failure.\n\nWhat this means: Treat webhooks as at-least-once delivery. Store processed event IDs so duplicate deliveries do not duplicate fulfillment work.\n\nWhat to check: Endpoint URL, PineTree-Signature, PineTree-Timestamp, webhook secret, response time, 2xx response, retry history, dead-letter or manual-review state, and duplicate-event handling.",
    tags: ["webhooks", "delivery", "signature", "retry"],
    keywords: ["webhook failed", "signature", "retry", "dead letter"]
  },
  {
    id: "inventory-connector-disconnected",
    title: "Inventory connector disconnected",
    category: "Troubleshooting",
    description: "External inventory connectors may be visible before catalog sync is configured or ready.",
    body: "Inventory connector cards can appear for Shopify, Shift4/SkyTab, Square, Clover, and Manual CSV Import. Manual CSV Import is available for catalog creation. External sync requires the connector to report readiness: Shopify needs app credentials and catalog access, Shift4/SkyTab needs partner catalog API access, and Square or Clover need merchant OAuth/token storage.\n\nWhat this means: Disconnected, Requires configuration, or Error states do not mean the item catalog is broken. They mean external sync is not ready for that connector.\n\nWhat to check: Connector status, setup message, Shopify installation, Shift4/SkyTab catalog API access, Square/Clover OAuth readiness, CSV import result, skipped SKUs, and whether Sync now is visible for that connector.",
    tags: ["inventory", "connector", "catalog", "sync"],
    keywords: ["inventory connector", "requires configuration", "disconnected", "sync now"]
  },
  {
    id: "wallet-connected-payment-not-complete",
    title: "Wallet connected but payment did not complete",
    category: "Troubleshooting",
    description: "A merchant wallet connection does not guarantee customer approval or final on-chain/payment-provider confirmation.",
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
    body: "PineTree AI should answer questions about PineTree workflows, help docs, payment statuses, provider setup, wallet connections, POS, checkout, dashboard basics, and support ticket preparation. It should not invent provider behavior, expose secrets, provide legal or tax advice, or claim a payment is confirmed unless PineTree status supports that.\n\nWhat this means: If the question involves missing funds, stuck payments after funds were sent, confirmed on-chain activity not showing in PineTree, repeated provider setup failures, refunds, disputes, account suspension, compliance, underwriting, KYC/KYB, fraud, legal, tax, or account review, PineTree AI should send the merchant to support.\n\nWhat to check: Source docs, merchant scope, whether the question needs live account data, and whether a human support ticket is more appropriate.",
    tags: ["assistant", "boundaries", "safety"],
    keywords: ["AI boundaries", "grounded answers", "merchant context", "escalate"]
  }
]
