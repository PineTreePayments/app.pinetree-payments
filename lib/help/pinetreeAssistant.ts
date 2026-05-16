import { searchHelpArticles, type HelpSearchResult } from "./retrieval"
import type { PineTreeAssistantContext } from "./pinetreeAssistantContext"

export type PineTreeAssistantAnswer = {
  title: string
  body: string
  bullets: string[]
  checklist?: Array<{ label: string; value: string; tone: "good" | "warning" | "neutral" }>
  escalation?: string
  followUpQuestion?: string
  matchedArticles: HelpSearchResult[]
}

export type PineTreeAssistantIntent =
  | "setup"
  | "wallet_provider"
  | "pos"
  | "checkout"
  | "payment_status"
  | "dashboard_reporting"
  | "support_ticket"
  | "escalation"
  | "developer_api"
  | "unknown"

const DEFAULT_PROMPT = "How do I set up my PineTree account?"

const STATUS_ANSWERS: Record<string, Omit<PineTreeAssistantAnswer, "matchedArticles">> = {
  created: {
    title: "CREATED means PineTree has a payment record",
    body: "CREATED is the earliest PineTree payment state. It means the payment exists, but the customer has not yet started or been shown the active payment step.",
    bullets: [
      "It is usually brief in normal checkout or POS flows.",
      "If it stays CREATED, open a support ticket with the payment ID.",
      "Do not treat CREATED as paid or confirmed."
    ]
  },
  pending: {
    title: "PENDING means PineTree is waiting for customer or provider action",
    body: "PENDING is normal while the customer is viewing checkout, scanning a POS payment, choosing a wallet, or waiting for the provider to begin the payment.",
    bullets: [
      "Ask whether the customer approved the wallet or provider step.",
      "Check the checkout link, selected rail, provider, network, and payment ID.",
      "If funds were sent and it is still pending, PineTree support should review it."
    ]
  },
  processing: {
    title: "PROCESSING means activity was detected",
    body: "PROCESSING means PineTree has seen a transaction or provider signal and is waiting for final confirmation, validation, or webhook completion.",
    bullets: [
      "Do not immediately ask the customer to pay again.",
      "Collect the payment ID, provider, network, timestamp, and transaction hash if available.",
      "Escalate if it stays processing after funds were sent."
    ]
  },
  confirmed: {
    title: "CONFIRMED means PineTree finalized the payment successfully",
    body: "CONFIRMED is PineTree's successful payment state. It is the status merchants should rely on for completed PineTree payments and reporting.",
    bullets: [
      "Review the Transactions page for the provider, network, amount, and reference.",
      "Use Reports for confirmed payment summaries over a date range.",
      "If another system disagrees, open a ticket with both records."
    ]
  },
  failed: {
    title: "FAILED means the payment did not complete successfully",
    body: "FAILED is used when PineTree or the provider could not complete the payment because of rejection, timeout, wrong amount, wallet failure, network issue, or provider error.",
    bullets: [
      "Check the provider, wallet result, amount, selected network, and payment ID.",
      "A new payment attempt is usually needed if the customer still wants to pay.",
      "Escalate if the customer believes funds moved despite the failed status."
    ]
  },
  incomplete: {
    title: "INCOMPLETE means the customer did not finish the payment",
    body: "INCOMPLETE usually means the checkout or POS attempt was abandoned, expired, canceled, or never reached a usable payment signal.",
    bullets: [
      "It is not a successful payment state.",
      "Check whether the customer closed checkout or never approved the wallet/provider step.",
      "Create a new attempt only after confirming no funds were sent."
    ]
  }
}

const ESCALATION_TERMS = [
  "missing fund",
  "funds missing",
  "lost funds",
  "sent funds",
  "stuck after",
  "confirmed on-chain",
  "onchain confirmed",
  "transaction hash",
  "tx hash",
  "refund",
  "dispute",
  "chargeback",
  "suspension",
  "suspended",
  "compliance",
  "underwriting",
  "kyc",
  "kyb",
  "fraud",
  "legal",
  "tax advice",
  "provider connection keeps failing",
  "admin review"
]

function normalize(value: string) {
  return value.toLowerCase().trim()
}

function statusKeyForQuestion(question: string) {
  const normalized = normalize(question)
  return Object.keys(STATUS_ANSWERS).find((status) => normalized.includes(status))
}

function needsEscalation(question: string) {
  const normalized = normalize(question)
  return ESCALATION_TERMS.some((term) => normalized.includes(term))
}

export function classifyQuestionIntent(question: string): PineTreeAssistantIntent {
  const normalized = normalize(question)
  if (needsEscalation(question)) return "escalation"
  if (statusKeyForQuestion(question) || normalized.includes("payment pending") || normalized.includes("transaction")) {
    return "payment_status"
  }
  if (
    normalized.includes("set up") ||
    normalized.includes("setup") ||
    normalized.includes("finish") ||
    normalized.includes("missing") ||
    normalized.includes("what do i need") ||
    normalized.includes("walk me through") ||
    normalized.includes("check my setup")
  ) {
    return "setup"
  }
  if (
    normalized.includes("wallet") ||
    normalized.includes("provider") ||
    normalized.includes("rail") ||
    normalized.includes("solana") ||
    normalized.includes("base") ||
    normalized.includes("shift4") ||
    normalized.includes("lightning") ||
    normalized.includes("speed")
  ) {
    return "wallet_provider"
  }
  if (normalized.includes("pos") || normalized.includes("terminal")) return "pos"
  if (normalized.includes("checkout") || normalized.includes("payment link") || normalized.includes("link")) return "checkout"
  if (normalized.includes("dashboard") || normalized.includes("report") || normalized.includes("export")) return "dashboard_reporting"
  if (normalized.includes("support") || normalized.includes("ticket") || normalized.includes("include")) return "support_ticket"
  if (normalized.includes("api") || normalized.includes("webhook") || normalized.includes("developer")) return "developer_api"
  return "unknown"
}

function toneForStatus(status: string): "good" | "warning" | "neutral" {
  if (["complete", "ready", "found", "no"].includes(status)) return "good"
  if (["incomplete", "missing", "not_ready", "not_found", "yes"].includes(status)) return "warning"
  return "neutral"
}

function setupChecklist(context: PineTreeAssistantContext) {
  const summary = context.setupSummary
  return [
    {
      label: "Account profile",
      value: summary.accountProfile.status === "complete" ? "Complete" : summary.accountProfile.detail,
      tone: toneForStatus(summary.accountProfile.status)
    },
    {
      label: "Wallets",
      value: summary.wallets.detail,
      tone: toneForStatus(summary.wallets.status)
    },
    {
      label: "Payment rails",
      value: summary.paymentRails.detail,
      tone: toneForStatus(summary.paymentRails.status)
    },
    {
      label: "Checkout",
      value: summary.checkout.detail,
      tone: toneForStatus(summary.checkout.status)
    },
    {
      label: "POS",
      value: summary.pos.detail,
      tone: toneForStatus(summary.pos.status)
    },
    {
      label: "Recent test payment",
      value: summary.testPayment.detail,
      tone: toneForStatus(summary.testPayment.status)
    },
    {
      label: "Support attention needed",
      value: summary.supportAttention.detail,
      tone: toneForStatus(summary.supportAttention.status)
    }
  ]
}

function formatProviderList(context: PineTreeAssistantContext) {
  if (context.providers.length === 0) return "I do not see any connected payment rails yet."
  return context.providers
    .map((provider) => {
      const enabled = provider.enabled ? "enabled" : "not enabled"
      const status = provider.dashboardStatus || provider.status
      return `${provider.label}: ${status}, ${enabled}`
    })
    .join("; ")
}

function formatWalletList(context: PineTreeAssistantContext) {
  if (context.wallets.length === 0) return "I do not see a connected merchant wallet yet."
  return context.wallets
    .map((wallet) => `${wallet.network}${wallet.walletType ? ` (${wallet.walletType})` : ""}: ${wallet.status}`)
    .join("; ")
}

function findMentionedPayment(question: string, context: PineTreeAssistantContext) {
  const normalized = normalize(question)
  return context.recentPayments.find((payment) => normalized.includes(payment.id.toLowerCase()))
}

function latestRelevantPayment(context: PineTreeAssistantContext) {
  return context.recentPayments.find((payment) =>
    ["PENDING", "PROCESSING", "FAILED", "INCOMPLETE", "CREATED"].includes(String(payment.status))
  ) || context.recentPayments[0]
}

function withContextAnswer(
  question: string,
  context: PineTreeAssistantContext
): Omit<PineTreeAssistantAnswer, "matchedArticles"> {
  const intent = classifyQuestionIntent(question)
  const statusKey = statusKeyForQuestion(question)
  const merchantName = context.merchant?.businessName || "your account"

  if (intent === "setup") {
    const summary = context.setupSummary
    const nextStep = summary.paymentRails.status !== "ready"
      ? "Connect or enable your preferred payment rail in Providers, then run a small POS or checkout test."
      : summary.testPayment.status !== "found"
        ? "Run a small test payment from POS or hosted checkout and confirm it reaches CONFIRMED."
        : "You look ready for basic testing; keep support details handy for any payment that does not settle cleanly."

    return {
      title: `Here is what I can see for ${merchantName}`,
      body: "I checked your PineTree setup context and summarized the parts that affect accepting payments.",
      checklist: setupChecklist(context),
      bullets: [nextStep]
    }
  }

  if (intent === "wallet_provider") {
    return {
      title: "Wallets and payment rails",
      body: "I checked your connected wallet and provider setup. Connected means PineTree has setup data; enabled means the rail can be offered for payments; ready means you should still validate it with a small test payment.",
      bullets: [
        formatWalletList(context),
        formatProviderList(context),
        context.setupSummary.testPayment.status === "found"
          ? "I can see a recent confirmed payment, which is a good setup signal."
          : "I do not see a recent confirmed test payment yet."
      ]
    }
  }

  if (intent === "checkout") {
    return {
      title: "Checkout readiness",
      body: "Hosted checkout needs an active payment link or session path plus at least one enabled rail.",
      bullets: [
        context.checkoutLinks.activeCount > 0
          ? `${context.checkoutLinks.activeCount} active checkout link${context.checkoutLinks.activeCount === 1 ? "" : "s"} found.`
          : "I do not see an active checkout payment link yet.",
        context.setupSummary.paymentRails.detail,
        context.checkoutLinks.mostRecentName
          ? `Most recent link: ${context.checkoutLinks.mostRecentName} (${context.checkoutLinks.mostRecentStatus || "unknown status"}).`
          : "Create a payment link from Online Checkout when you are ready to test."
      ]
    }
  }

  if (intent === "pos") {
    return {
      title: "POS readiness",
      body: "PineTree POS needs a terminal and an enabled payment rail before you can run a meaningful customer payment test.",
      bullets: [
        context.pos.terminalCount > 0
          ? `${context.pos.terminalCount} terminal${context.pos.terminalCount === 1 ? "" : "s"} found.`
          : "I do not see a POS terminal yet.",
        context.setupSummary.paymentRails.detail,
        "For the first test, open POS, enter a small amount, choose an available rail, and confirm the transaction reaches CONFIRMED."
      ]
    }
  }

  if (intent === "payment_status") {
    const payment = findMentionedPayment(question, context) || latestRelevantPayment(context)
    if (statusKey && !payment) return STATUS_ANSWERS[statusKey]

    if (!payment) {
      return {
        title: "I do not see a recent payment to inspect",
        body: "I can explain PineTree statuses, but I do not see recent payment records in your account context.",
        bullets: [
          "PENDING means no transaction has been detected yet.",
          "PROCESSING means activity was detected and PineTree is waiting for confirmation.",
          "If funds were sent, open a support ticket with the payment ID and transaction hash."
        ],
        followUpQuestion: "Do you have a PineTree payment ID you want support to review?"
      }
    }

    const status = String(payment.status)
    const amount = `${payment.grossAmount.toFixed(2)} ${payment.currency}`
    return {
      title: `Recent payment ${payment.id} is ${status}`,
      body: `${status} means ${
        status === "CREATED"
          ? "PineTree created the record, but the customer may not have started payment."
          : status === "PENDING"
            ? "the payment request exists, but PineTree has not detected a transaction yet."
            : status === "PROCESSING"
              ? "a transaction or provider signal was detected and PineTree is waiting for final confirmation."
              : status === "CONFIRMED"
                ? "PineTree completed the payment successfully."
                : status === "FAILED"
                  ? "something went wrong and the payment did not complete."
                  : "the customer abandoned or the payment did not finish before funds were sent."
      }`,
      bullets: [
        `Provider/rail: ${payment.provider || "unknown"}${payment.network ? ` on ${payment.network}` : ""}.`,
        `Gross amount visible to PineTree: ${amount}.`,
        "If this does not match what the customer or wallet shows, open a support ticket with the payment ID, rail, network, time, and transaction hash/signature."
      ],
      escalation: ["PROCESSING", "PENDING", "FAILED"].includes(status)
        ? "If funds were sent or confirmed externally, this needs PineTree support review. PineTree AI cannot manually mark payments confirmed or failed."
        : undefined
    }
  }

  if (intent === "support_ticket" || intent === "escalation") {
    return {
      title: "This is a PineTree support ticket situation",
      body: "For payment confirmation, account review, refunds, disputes, compliance, provider approval, or repeated provider failures, PineTree support needs the evidence attached to a ticket.",
      bullets: [
        "Include payment ID, provider/rail, network, wallet used, approximate time, and amount.",
        "Add the transaction hash/signature or provider reference if available.",
        context.recentTickets.length > 0
          ? `I can see ${context.recentTickets.length} recent ticket${context.recentTickets.length === 1 ? "" : "s"} in your account context.`
          : "I do not see a recent support ticket in your account context."
      ],
      escalation: "PineTree AI cannot change payment states, approve providers, adjudicate refunds/disputes, or provide legal/tax advice."
    }
  }

  if (intent === "dashboard_reporting") {
    return {
      title: "Dashboard and reporting guidance",
      body: "Dashboard numbers come from PineTree records. Transactions is best for individual payment rows; Reports is best for confirmed activity over a selected time window; Wallets is a connection and balance visibility page.",
      bullets: [
        context.recentPayments.length > 0
          ? `${context.recentPayments.length} recent payment record${context.recentPayments.length === 1 ? "" : "s"} visible in account context.`
          : "I do not see recent payment records in your account context.",
        "Compare date range, status, provider, network, and channel before assuming totals are wrong.",
        "Open a support ticket if a confirmed payment is missing from reports."
      ]
    }
  }

  if (intent === "developer_api") {
    return {
      title: "Developer and API setup",
      body: "PineTree API support is for server-side checkout sessions, payment links, API keys, and webhooks. Keep API keys and webhook secrets out of frontend code and support messages.",
      bullets: [
        "Use Online Checkout for API keys and webhook configuration.",
        "Verify state from PineTree rather than trusting a browser redirect alone.",
        "For API support, include endpoint, request time, payment ID if relevant, and response error without secrets."
      ]
    }
  }

  return {
    ...defaultAnswer(),
    followUpQuestion: "Are you trying to finish setup, check a payment status, or troubleshoot a provider or wallet?"
  }
}

function setupAnswer(): Omit<PineTreeAssistantAnswer, "matchedArticles"> {
  return {
    title: "Set up PineTree in four steps",
    body: "Start by creating your merchant account, completing your business profile, connecting at least one supported payment rail, then running a small POS or hosted checkout test before taking real customer payments.",
    bullets: [
      "Go to Providers and connect the rail you plan to use: Solana Pay, Base payments, Shift4, or Lightning through Speed when available for your account.",
      "For wallet rails, save the merchant wallet address PineTree should use for that network.",
      "Create a small POS sale or checkout link and confirm the payment reaches CONFIRMED before going live."
    ]
  }
}

function railAnswer(): Omit<PineTreeAssistantAnswer, "matchedArticles"> {
  return {
    title: "Connect a payment rail from Providers",
    body: "PineTree routes payments through configured rails. Solana Pay and Base use merchant wallet setup, Shift4 uses provider credentials, and Lightning uses Speed account and payment address details when platform support is enabled.",
    bullets: [
      "Connected means PineTree has enough configuration to attempt that rail; it does not guarantee every customer payment will succeed.",
      "Run a small test payment after saving provider or wallet details.",
      "If the same provider connection fails repeatedly, open a support ticket."
    ]
  }
}

function posAnswer(): Omit<PineTreeAssistantAnswer, "matchedArticles"> {
  return {
    title: "Run your first PineTree POS payment",
    body: "In PineTree POS, create or launch a terminal, enter the sale amount, review the PineTree fee and total, then let the customer choose an available payment method.",
    bullets: [
      "For crypto POS, PineTree creates the payment request and watches for status changes.",
      "Use a small test amount before using a new terminal with customers.",
      "Confirm the transaction appears in Transactions and reaches CONFIRMED."
    ]
  }
}

function checkoutAnswer(): Omit<PineTreeAssistantAnswer, "matchedArticles"> {
  return {
    title: "Hosted checkout and payment links",
    body: "PineTree Checkout gives customers a hosted payment page for online payments. Payment links can carry amount, description, customer reference, expiration, and redirect behavior.",
    bullets: [
      "The customer still needs to choose a payment method and approve the wallet or provider step.",
      "The available options depend on your connected Providers and Wallets.",
      "Expired or disabled links will not start a customer payment."
    ]
  }
}

function supportAnswer(): Omit<PineTreeAssistantAnswer, "matchedArticles"> {
  return {
    title: "What to include in a PineTree support ticket",
    body: "The fastest support tickets include enough detail for PineTree to find the payment, provider event, wallet activity, or account setup record.",
    bullets: [
      "Include the payment ID, provider or rail, wallet/network, amount, and approximate time.",
      "Add the transaction hash or provider reference if one exists.",
      "Describe what the customer saw and what you expected to happen."
    ]
  }
}

function defaultAnswer(): Omit<PineTreeAssistantAnswer, "matchedArticles"> {
  return {
    title: "PineTree AI searches PineTree setup and support docs",
    body: "Ask about account setup, payment statuses, provider connections, wallets, POS, checkout, dashboard sections, fees, reports, or what to include when escalating to support.",
    bullets: [
      "It uses PineTree help content and does not inspect private merchant data in this panel.",
      "It will not claim funds are received unless PineTree status or authorized transaction data confirms it.",
      "For account-level or payment-confirmation issues, open a support ticket."
    ]
  }
}

export function buildPineTreeAssistantAnswer(question: string): PineTreeAssistantAnswer {
  const prompt = question.trim() || DEFAULT_PROMPT
  const normalized = normalize(prompt)
  const statusKey = statusKeyForQuestion(prompt)
  const matchedArticles = searchHelpArticles(prompt, 3)

  let answer: Omit<PineTreeAssistantAnswer, "matchedArticles">
  if (statusKey) {
    answer = STATUS_ANSWERS[statusKey]
  } else if (normalized.includes("set up") || normalized.includes("setup") || normalized.includes("account")) {
    answer = setupAnswer()
  } else if (normalized.includes("rail") || normalized.includes("provider") || normalized.includes("connect")) {
    answer = railAnswer()
  } else if (normalized.includes("pos") || normalized.includes("terminal")) {
    answer = posAnswer()
  } else if (normalized.includes("checkout") || normalized.includes("payment link")) {
    answer = checkoutAnswer()
  } else if (normalized.includes("support ticket") || normalized.includes("ticket") || normalized.includes("include")) {
    answer = supportAnswer()
  } else {
    answer = defaultAnswer()
  }

  return {
    ...answer,
    matchedArticles,
    escalation: needsEscalation(prompt)
      ? "Based on what you described, this needs PineTree support review because it may involve payment confirmation or account-level data. Please open a support ticket and include the payment ID, provider, wallet/network, approximate time, and transaction hash if available."
      : undefined
  }
}

export function answerPineTreeQuestion(
  question: string,
  context: PineTreeAssistantContext
): PineTreeAssistantAnswer {
  const prompt = question.trim() || DEFAULT_PROMPT
  const matchedArticles = searchHelpArticles(prompt, 3)
  const answer = withContextAnswer(prompt, context)

  return {
    ...answer,
    matchedArticles,
    escalation: answer.escalation || (needsEscalation(prompt)
      ? "Based on what you described, this needs PineTree support review because it may involve payment confirmation or account-level data. Please open a support ticket and include the payment ID, provider, wallet/network, approximate time, and transaction hash if available."
      : undefined)
  }
}
