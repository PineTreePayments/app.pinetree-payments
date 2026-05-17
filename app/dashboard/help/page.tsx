"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  Bot,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  FileText,
  LifeBuoy,
  MessageSquare,
  MonitorSmartphone,
  Search,
  Send,
  Sparkles,
  WalletCards,
  X
} from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import { helpArticles, helpCategories, type HelpArticle } from "@/lib/help/helpContent"
import type { PineTreeAssistantAnswer } from "@/lib/help/pinetreeAssistant"
import {
  feedbackTypes,
  supportTicketCategories,
  supportTicketPriorities
} from "@/lib/help/supportOptions"
import {
  DashboardSection,
  ProviderStatusPill
} from "@/components/dashboard/DashboardPrimitives"

// ─── Types ────────────────────────────────────────────────────────────────────

type TicketRecord = {
  id: string
  category: string
  subject: string
  description: string
  priority: string
  status: string
  related_payment_id: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  archived_at: string | null
  last_response_at: string | null
  merchant_business_name: string | null
}

type TicketMessage = {
  id: string
  ticket_id: string
  merchant_id: string
  sender_type: "merchant" | "pinetree" | "system"
  sender_name: string | null
  sender_email: string | null
  message: string
  created_at: string
}

type TicketForm = {
  category: string
  subject: string
  description: string
  priority: string
  relatedPaymentId: string
}

type FeedbackForm = {
  type: string
  message: string
  rating: string
}

type AssistantMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  answer?: PineTreeAssistantAnswer
}

// ─── Constants ────────────────────────────────────────────────────────────────

const suggestedQuestions = [
  "Check my setup progress",
  "What do I still need to finish?",
  "Why isn't checkout ready?",
  "Are my wallets connected?",
  "Walk me through my first POS payment",
  "Why is my payment pending?",
  "What information should I include in a support ticket?"
]

const supportHubSections = [
  {
    title: "Getting Started",
    description: "Create your merchant account, complete the business profile, connect one rail, and run a test payment.",
    icon: CheckCircle2,
    articleIds: ["first-setup-checklist", "merchants-providers-wallets", "what-to-test-before-real-payments"]
  },
  {
    title: "Accept Payments",
    description: "Use PineTree POS, hosted checkout, payment links, and supported wallet or provider payment paths.",
    icon: CreditCard,
    articleIds: ["how-pos-works", "hosted-checkout-works", "online-checkout-links"]
  },
  {
    title: "Transactions & Statuses",
    description: "Understand CREATED, PENDING, PROCESSING, CONFIRMED, FAILED, and INCOMPLETE in merchant language.",
    icon: FileText,
    articleIds: ["status-pending", "status-processing", "status-incomplete"]
  },
  {
    title: "Wallets & Providers",
    description: "Connect Solana Pay, Base payments, Shift4, Lightning through Speed, and wallet rails when available.",
    icon: WalletCards,
    articleIds: ["providers-page-overview", "solana-provider-behavior", "base-wallet-payment-behavior"]
  },
  {
    title: "Dashboard & Reports",
    description: "Review overview metrics, transaction rows, wallet balances, exports, fees, and report windows.",
    icon: MonitorSmartphone,
    articleIds: ["dashboard-overview", "transactions-page", "reports-page"]
  },
  {
    title: "Contact Support",
    description: "Open tickets with payment ID, provider, network, timestamp, amount, and transaction hash when available.",
    icon: LifeBuoy,
    articleIds: ["open-support-ticket", "support-escalation-boundaries", "payment-stuck-processing"]
  }
]

const emptyTicketForm: TicketForm = {
  category: "Payment Issue",
  subject: "",
  description: "",
  priority: "Normal",
  relatedPaymentId: ""
}

const emptyFeedbackForm: FeedbackForm = {
  type: "Product Feedback",
  message: "",
  rating: ""
}

const DEFAULT_VISIBLE_ARTICLES = 6
const SUPPORT_STORAGE_DISABLED_MESSAGE =
  "Support storage is not enabled yet. Apply the Help Center database migration to view and create tickets."

const TICKET_FILTERS = ["All", "Open", "In Review", "Resolved", "Archived"] as const
type TicketFilter = typeof TICKET_FILTERS[number]

const TICKET_STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-blue-50 text-[#0052FF] border-blue-200" },
  in_review: { label: "In Review", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  waiting_on_merchant: { label: "Waiting on You", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  resolved: { label: "Resolved", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  archived: { label: "Archived", cls: "bg-gray-100 text-gray-500 border-gray-200" }
}

const STATUS_DESCRIPTION: Record<string, string> = {
  open: "PineTree has received your ticket.",
  in_review: "PineTree is reviewing your ticket.",
  waiting_on_merchant: "PineTree needs more information from you.",
  resolved: "PineTree has marked this issue resolved.",
  archived: "This ticket is closed and retained for history."
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function searchableText(article: HelpArticle) {
  return [
    article.title,
    article.category,
    article.description,
    article.body,
    article.tags.join(" "),
    article.keywords?.join(" ") || ""
  ].join(" ").toLowerCase()
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value))
}

function normalizeSupportErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback
  const storageMissing =
    message.includes("support_tickets") ||
    message.includes("merchant_feedback") ||
    message.includes("schema cache") ||
    message.includes("Could not find the table")

  if (storageMissing) {
    console.error("[help-center] support storage unavailable", { error: message })
    return SUPPORT_STORAGE_DISABLED_MESSAGE
  }

  return message
}

function matchesTicketFilter(ticket: TicketRecord, filter: TicketFilter): boolean {
  if (filter === "All") return true
  if (filter === "Open") return ticket.status === "open"
  if (filter === "In Review") return ticket.status === "in_review" || ticket.status === "waiting_on_merchant"
  if (filter === "Resolved") return ticket.status === "resolved"
  if (filter === "Archived") return ticket.status === "archived"
  return true
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HelpCenterPage() {
  const [query, setQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("All")
  const [articlesExpanded, setArticlesExpanded] = useState(false)
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null)
  const [ticketForm, setTicketForm] = useState<TicketForm>(emptyTicketForm)
  const [feedbackForm, setFeedbackForm] = useState<FeedbackForm>(emptyFeedbackForm)
  const [tickets, setTickets] = useState<TicketRecord[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(true)
  const [ticketError, setTicketError] = useState<string | null>(null)
  const [submittingTicket, setSubmittingTicket] = useState(false)
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const [assistantQuestion, setAssistantQuestion] = useState("")
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Ask me to check your setup, explain a payment status, inspect connected wallets or rails, or help prepare a support ticket. I use your authenticated PineTree account context when available."
    }
  ])
  const [mobileSection, setMobileSection] = useState<"ai" | "docs" | "support" | "tickets">("ai")
  const [mobileFeedbackOpen, setMobileFeedbackOpen] = useState(false)
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>("All")
  const [selectedTicket, setSelectedTicket] = useState<TicketRecord | null>(null)
  const [ticketDetailMessages, setTicketDetailMessages] = useState<TicketMessage[]>([])
  const [ticketDetailLoading, setTicketDetailLoading] = useState(false)
  const [ticketDetailError, setTicketDetailError] = useState<string | null>(null)

  const filteredArticles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return helpArticles.filter((article) => {
      const categoryMatch = selectedCategory === "All" || article.category === selectedCategory
      const queryMatch = !normalizedQuery || searchableText(article).includes(normalizedQuery)
      return categoryMatch && queryMatch
    })
  }, [query, selectedCategory])

  const categorySummaries = useMemo(() => {
    return helpCategories.map((category) => ({
      category,
      count: helpArticles.filter((article) => article.category === category).length,
      sample: helpArticles.find((article) => article.category === category)?.description || "Browse PineTree help docs."
    }))
  }, [])

  const supportHubCards = useMemo(() => {
    return supportHubSections.map((section) => ({
      ...section,
      articles: section.articleIds
        .map((id) => helpArticles.find((article) => article.id === id))
        .filter((article): article is HelpArticle => Boolean(article))
    }))
  }, [])

  const visibleLimit = articlesExpanded ? filteredArticles.length : DEFAULT_VISIBLE_ARTICLES
  const visibleArticles = filteredArticles.slice(0, visibleLimit)
  const hasMoreArticles = filteredArticles.length > visibleArticles.length
  const hasSearch = query.trim().length > 0

  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => matchesTicketFilter(ticket, ticketFilter))
  }, [tickets, ticketFilter])

  const getAccessToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || null
  }, [])

  const loadTickets = useCallback(async () => {
    try {
      setTicketsLoading(true)
      setTicketError(null)
      const token = await getAccessToken()
      if (!token) {
        setTickets([])
        setTicketError("Sign in to view support tickets.")
        return
      }

      const res = await fetch("/api/support/tickets", {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        cache: "no-store"
      })
      const payload = (await res.json().catch(() => null)) as { tickets?: TicketRecord[]; error?: string } | null

      if (!res.ok) {
        throw new Error(payload?.error || "Support ticket storage is not available yet.")
      }

      setTickets(payload?.tickets || [])
    } catch (error) {
      setTickets([])
      setTicketError(normalizeSupportErrorMessage(error, "Failed to load support tickets."))
    } finally {
      setTicketsLoading(false)
    }
  }, [getAccessToken])

  const loadTicketDetail = useCallback(async (ticketId: string) => {
    try {
      setTicketDetailLoading(true)
      setTicketDetailError(null)
      const token = await getAccessToken()
      if (!token) {
        setTicketDetailError("Sign in to view ticket details.")
        return
      }

      const res = await fetch(`/api/support/tickets/${ticketId}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        cache: "no-store"
      })
      const payload = (await res.json().catch(() => null)) as {
        ticket?: TicketRecord
        messages?: TicketMessage[]
        error?: string
      } | null

      if (!res.ok) {
        throw new Error(payload?.error || "Failed to load ticket details.")
      }

      if (payload?.ticket) {
        setSelectedTicket(payload.ticket)
      }
      setTicketDetailMessages(payload?.messages || [])
    } catch (error) {
      setTicketDetailError(normalizeSupportErrorMessage(error, "Failed to load ticket details."))
    } finally {
      setTicketDetailLoading(false)
    }
  }, [getAccessToken])

  useEffect(() => {
    void loadTickets()
  }, [loadTickets])

  useEffect(() => {
    if (!selectedArticle) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedArticle(null)
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [selectedArticle])

  useEffect(() => {
    if (!selectedTicket) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedTicket(null)
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [selectedTicket])

  function openTicketDetail(ticket: TicketRecord) {
    setSelectedTicket(ticket)
    setTicketDetailMessages([])
    setTicketDetailError(null)
    void loadTicketDetail(ticket.id)
  }

  async function sendFollowUpMessage(message: string) {
    if (!selectedTicket) return
    const token = await getAccessToken()
    if (!token) {
      toast.error("Sign in to reply.")
      return
    }
    const res = await fetch(`/api/support/tickets/${selectedTicket.id}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      credentials: "include",
      body: JSON.stringify({ message })
    })
    const payload = (await res.json().catch(() => null)) as {
      message?: TicketMessage
      error?: string
    } | null
    if (!res.ok) {
      throw new Error(payload?.error || "Failed to send message.")
    }
    if (payload?.message) {
      setTicketDetailMessages((current) => [...current, payload.message as TicketMessage])
    }
  }

  async function submitTicket() {
    const subject = ticketForm.subject.trim()
    const description = ticketForm.description.trim()

    if (!subject || !description) {
      toast.error("Add a subject and description before opening a ticket.")
      return
    }

    try {
      setSubmittingTicket(true)
      const token = await getAccessToken()
      if (!token) {
        toast.error("Please sign in to open a ticket.")
        return
      }

      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        credentials: "include",
        body: JSON.stringify({
          ...ticketForm,
          subject,
          description,
          relatedPaymentId: ticketForm.relatedPaymentId.trim() || null
        })
      })
      const payload = (await res.json().catch(() => null)) as { ticket?: TicketRecord; error?: string; warning?: string } | null

      if (!res.ok || !payload?.ticket) {
        throw new Error(payload?.error || "Failed to open support ticket.")
      }

      setTickets((current) => [payload.ticket as TicketRecord, ...current])
      setTicketForm(emptyTicketForm)
      setTicketError(null)
      if (payload.warning) {
        toast.warning(payload.warning)
      } else {
        toast.success("Support ticket opened.")
      }
    } catch (error) {
      toast.error(normalizeSupportErrorMessage(error, "Failed to open support ticket."))
    } finally {
      setSubmittingTicket(false)
    }
  }

  async function submitFeedback() {
    const message = feedbackForm.message.trim()
    if (!message) {
      toast.error("Add a message before sending feedback.")
      return
    }

    try {
      setSubmittingFeedback(true)
      const token = await getAccessToken()
      if (!token) {
        toast.error("Please sign in to send feedback.")
        return
      }

      const res = await fetch("/api/support/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        credentials: "include",
        body: JSON.stringify({
          type: feedbackForm.type,
          message,
          rating: feedbackForm.rating ? Number(feedbackForm.rating) : null
        })
      })
      const payload = (await res.json().catch(() => null)) as { error?: string; warning?: string } | null

      if (!res.ok) {
        throw new Error(payload?.error || "Failed to send feedback.")
      }

      setFeedbackForm(emptyFeedbackForm)
      if (payload?.warning) {
        toast.warning(payload.warning)
      } else {
        toast.success("Feedback sent.")
      }
    } catch (error) {
      toast.error(normalizeSupportErrorMessage(error, "Failed to send feedback."))
    } finally {
      setSubmittingFeedback(false)
    }
  }

  async function submitAssistantQuestion(questionOverride?: string) {
    const message = (questionOverride ?? assistantQuestion).trim()
    if (!message) return

    const userMessage: AssistantMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: message
    }

    setAssistantMessages((current) => [...current, userMessage])
    setAssistantQuestion("")

    try {
      setAssistantLoading(true)
      const token = await getAccessToken()
      if (!token) {
        throw new Error("Sign in to use PineTree AI with account context.")
      }

      const res = await fetch("/api/help/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        credentials: "include",
        body: JSON.stringify({ message })
      })
      const payload = (await res.json().catch(() => null)) as {
        answer?: PineTreeAssistantAnswer
        error?: string
      } | null

      if (!res.ok || !payload?.answer) {
        throw new Error(payload?.error || "PineTree AI could not answer that yet.")
      }

      setAssistantMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: payload.answer?.body || "I checked your PineTree context.",
          answer: payload.answer
        }
      ])
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "PineTree AI is unavailable right now."
      setAssistantMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content: messageText
        }
      ])
      toast.error(messageText)
    } finally {
      setAssistantLoading(false)
    }
  }

  return (
    <div className="space-y-3 md:space-y-7">

      {/* Mobile header — compact */}
      <div className="md:hidden">
        <h1 className="text-xl font-semibold text-gray-950">Help Center</h1>
        <p className="mt-0.5 text-[12px] text-gray-500">
          Account setup, payment status, support, and PineTree AI.
        </p>
      </div>

      {/* Desktop header */}
      <div className="hidden md:block">
        <h1 className="text-3xl font-semibold text-gray-950">Help Center</h1>
        <p className="mt-1 text-[12px] font-semibold leading-5 tracking-[0.01em] text-[#0052FF] sm:text-sm">
          PineTree merchant onboarding, setup, payment status, and support guidance.
        </p>
      </div>

      {/* Desktop hero card */}
      <div className="hidden md:block rounded-2xl border border-blue-200/80 bg-[radial-gradient(circle_at_top_right,rgba(0,82,255,0.12),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f8fbff_52%,#eef5ff_100%)] p-3 shadow-[0_10px_30px_rgba(0,82,255,0.09)] sm:p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
              PineTree Support Center
            </p>
            <h2 className="mt-1 text-lg font-semibold leading-tight text-gray-950 sm:text-xl">
              Set up rails, understand payment states, and know when to escalate.
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-5 text-gray-500">
              PineTree AI and the help library cover POS, checkout, providers, wallets, reports, and the payment state model.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 md:w-auto md:min-w-[250px]">
            <QuickAction label="Open a Ticket" icon={<LifeBuoy size={16} />} href="#support-ticket" />
            <QuickAction label="Ask PineTree AI" icon={<Bot size={16} />} href="#pinetree-ai" />
          </div>
        </div>
      </div>

      {/* Mobile tab row — top, sticky */}
      <div className="sticky top-0 z-10 -mx-4 bg-white/95 px-4 pb-2 pt-1 backdrop-blur-sm md:hidden">
        <div className="flex gap-2 overflow-x-auto">
          {(
            [
              { id: "ai" as const, label: "Ask AI", icon: Bot },
              { id: "docs" as const, label: "Docs", icon: BookOpen },
              { id: "support" as const, label: "Support", icon: LifeBuoy },
              { id: "tickets" as const, label: "Tickets", icon: FileText },
            ]
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMobileSection(id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                mobileSection === id
                  ? "border-[#0052FF] bg-[#0052FF] text-white shadow-sm"
                  : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:bg-blue-50"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── MOBILE ONLY: tab content ─────────────────────────────────────── */}
      <div className="md:hidden space-y-3">

        {/* AI tab */}
        {mobileSection === "ai" && (
          <div className="rounded-2xl border border-blue-200/80 bg-[radial-gradient(circle_at_top_right,rgba(0,82,255,0.13),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f7fbff_55%,#eef5ff_100%)] p-4 shadow-[0_14px_45px_rgba(37,99,235,0.10)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-[#0052FF]" />
                <h2 className="text-base font-semibold text-gray-950">Ask PineTree AI</h2>
              </div>
              <ProviderStatusPill label="Account-aware" tone="blue" />
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2">
              {suggestedQuestions.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => void submitAssistantQuestion(question)}
                  disabled={assistantLoading}
                  className="shrink-0 rounded-full border border-blue-100 bg-white/85 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-[#0052FF] hover:bg-blue-50 disabled:opacity-50"
                >
                  {question}
                </button>
              ))}
            </div>

            <div className="mt-3 max-h-[calc(100dvh-22rem)] min-h-[180px] space-y-3 overflow-y-auto rounded-xl border border-blue-100 bg-white/75 p-3">
              {assistantMessages.map((message) => (
                <AssistantMessageBubble
                  key={message.id}
                  message={message}
                  onOpenArticle={(article) => {
                    setSelectedCategory(article.category)
                    setSelectedArticle(article)
                    setQuery("")
                  }}
                />
              ))}
              {assistantLoading && (
                <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-sm text-[#0052FF]">
                  Checking your PineTree account context...
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
              <Sparkles className="h-4 w-4 shrink-0 text-[#0052FF]" />
              <input
                value={assistantQuestion}
                onChange={(event) => setAssistantQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void submitAssistantQuestion()
                  }
                }}
                placeholder="Ask PineTree AI..."
                className="min-h-9 flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
              />
              <button
                type="button"
                onClick={() => void submitAssistantQuestion()}
                disabled={assistantLoading || !assistantQuestion.trim()}
                aria-label="Ask PineTree AI"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0052FF] text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        )}

        {/* Docs tab */}
        {mobileSection === "docs" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setArticlesExpanded(false)
                  }}
                  placeholder="Search help articles..."
                  className="min-h-11 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#0052FF] focus:bg-white focus:ring-4 focus:ring-blue-100"
                />
              </div>
              <div className="mt-2.5 flex gap-2 overflow-x-auto pb-0.5">
                {["All", ...helpCategories].map((category) => {
                  const active = category === selectedCategory
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(category)
                        setArticlesExpanded(false)
                      }}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? "border-[#0052FF] bg-[#0052FF] text-white shadow-sm"
                          : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:bg-blue-50"
                      }`}
                    >
                      {category}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5">
                <p className="text-xs font-semibold text-gray-700">
                  {hasSearch ? `"${query.trim()}"` : selectedCategory === "All" ? "All docs" : selectedCategory}
                  <span className="ml-1 font-normal text-gray-400">
                    {filteredArticles.length} article{filteredArticles.length === 1 ? "" : "s"}
                  </span>
                </p>
                {(selectedCategory !== "All" || hasSearch) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory("All")
                      setQuery("")
                      setArticlesExpanded(false)
                    }}
                    className="text-xs font-semibold text-[#0052FF]"
                  >
                    Reset
                  </button>
                )}
              </div>

              <div className="divide-y divide-gray-100">
                {visibleArticles.map((article) => (
                  <button
                    key={article.id}
                    type="button"
                    onClick={() => setSelectedArticle(article)}
                    className="flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-blue-50/40 active:bg-blue-50"
                  >
                    <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-[#0052FF]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-950">{article.title}</p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{article.description}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="rounded-full border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#0052FF]">
                        {article.category.split(" ")[0]}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                    </div>
                  </button>
                ))}
                {filteredArticles.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-gray-500">
                    No articles matched. Try another search term.
                  </div>
                )}
              </div>

              {hasMoreArticles && (
                <div className="border-t border-gray-100 p-3">
                  <button
                    type="button"
                    onClick={() => setArticlesExpanded(true)}
                    className="w-full rounded-xl border border-blue-200 bg-blue-50 py-2 text-xs font-semibold text-[#0052FF] transition hover:bg-blue-100"
                  >
                    View {filteredArticles.length - visibleArticles.length} more articles
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Support tab */}
        {mobileSection === "support" && (
          <div className="space-y-3">
            <div id="support-ticket-mobile" className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-gray-950">Open a Ticket</h2>
                  <p className="mt-1 text-sm leading-5 text-gray-600">
                    Send PineTree the details needed to investigate your issue.
                  </p>
                </div>
                <LifeBuoy className="h-5 w-5 shrink-0 text-[#0052FF]" />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Category">
                  <select
                    value={ticketForm.category}
                    onChange={(event) => setTicketForm((current) => ({ ...current, category: event.target.value }))}
                    className="form-field"
                  >
                    {supportTicketCategories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </Field>
                <Field label="Priority">
                  <select
                    value={ticketForm.priority}
                    onChange={(event) => setTicketForm((current) => ({ ...current, priority: event.target.value }))}
                    className="form-field"
                  >
                    {supportTicketPriorities.map((priority) => <option key={priority}>{priority}</option>)}
                  </select>
                </Field>
                <Field label="Subject">
                  <input
                    value={ticketForm.subject}
                    onChange={(event) => setTicketForm((current) => ({ ...current, subject: event.target.value }))}
                    className="form-field"
                    placeholder="Payment is still pending"
                  />
                </Field>
                <Field label="Related Payment ID">
                  <input
                    value={ticketForm.relatedPaymentId}
                    onChange={(event) => setTicketForm((current) => ({ ...current, relatedPaymentId: event.target.value }))}
                    className="form-field"
                    placeholder="Optional"
                  />
                </Field>
                <Field label="Description" className="sm:col-span-2">
                  <textarea
                    value={ticketForm.description}
                    onChange={(event) => setTicketForm((current) => ({ ...current, description: event.target.value }))}
                    className="form-field min-h-24 resize-y"
                    placeholder="Include what happened, payment ID, provider, wallet/network, approximate time, amount, and transaction hash if available."
                  />
                  <p className="mt-1.5 text-xs text-gray-400">
                    For payment issues, include the payment ID, provider/network, wallet used, approximate time, amount, and transaction hash if available.
                  </p>
                </Field>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => void submitTicket()}
                  disabled={submittingTicket}
                  className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                >
                  <Send size={16} />
                  {submittingTicket ? "Opening..." : "Open Ticket"}
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setMobileFeedbackOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3.5"
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-[#0052FF]" />
                  <span className="text-sm font-semibold text-gray-950">General Feedback</span>
                </div>
                <ChevronRight className={`h-4 w-4 text-gray-400 transition ${mobileFeedbackOpen ? "rotate-90" : ""}`} />
              </button>
              {mobileFeedbackOpen && (
                <div className="border-t border-gray-100 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Type">
                      <select
                        value={feedbackForm.type}
                        onChange={(event) => setFeedbackForm((current) => ({ ...current, type: event.target.value }))}
                        className="form-field"
                      >
                        {feedbackTypes.map((type) => <option key={type}>{type}</option>)}
                      </select>
                    </Field>
                    <Field label="Rating">
                      <select
                        value={feedbackForm.rating}
                        onChange={(event) => setFeedbackForm((current) => ({ ...current, rating: event.target.value }))}
                        className="form-field"
                      >
                        <option value="">Optional</option>
                        <option value="5">5 - Excellent</option>
                        <option value="4">4 - Good</option>
                        <option value="3">3 - Neutral</option>
                        <option value="2">2 - Needs work</option>
                        <option value="1">1 - Poor</option>
                      </select>
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Field label="Message">
                      <textarea
                        value={feedbackForm.message}
                        onChange={(event) => setFeedbackForm((current) => ({ ...current, message: event.target.value }))}
                        className="form-field min-h-[72px] resize-y"
                        placeholder="Tell us what would make PineTree clearer or easier to use."
                      />
                    </Field>
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => void submitFeedback()}
                      disabled={submittingFeedback}
                      className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                    >
                      <CheckCircle2 size={16} />
                      {submittingFeedback ? "Sending..." : "Send Feedback"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tickets tab */}
        {mobileSection === "tickets" && (
          <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-950">My Tickets</h2>
              <button
                type="button"
                onClick={() => void loadTickets()}
                className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Refresh
              </button>
            </div>

            <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
              {TICKET_FILTERS.map((filter) => {
                const active = filter === ticketFilter
                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setTicketFilter(filter)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? "border-[#0052FF] bg-[#0052FF] text-white shadow-sm"
                        : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:bg-blue-50"
                    }`}
                  >
                    {filter}
                  </button>
                )
              })}
            </div>

            {ticketsLoading && (
              <div className="space-y-2">
                <div className="h-16 animate-pulse rounded-xl bg-gray-100" />
                <div className="h-16 animate-pulse rounded-xl bg-gray-100" />
              </div>
            )}
            {!ticketsLoading && ticketError && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                {ticketError}
              </div>
            )}
            {!ticketsLoading && !ticketError && filteredTickets.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-blue-100 bg-blue-50">
                  <LifeBuoy className="h-4 w-4 text-[#0052FF]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-950">
                    {ticketFilter === "All" ? "No support tickets yet" : `No ${ticketFilter.toLowerCase()} tickets`}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {ticketFilter === "All" ? "Open a ticket in the Support tab." : "Change the filter to see other tickets."}
                  </p>
                </div>
              </div>
            )}
            {!ticketsLoading && !ticketError && filteredTickets.length > 0 && (
              <div className="space-y-1.5">
                {filteredTickets.map((ticket) => (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => openTicketDetail(ticket)}
                    className="w-full rounded-xl border border-gray-100 bg-white p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <TicketStatusPill status={ticket.status} />
                      <span className="text-[11px] text-gray-400">{formatDate(ticket.created_at)}</span>
                    </div>
                    <p className="mt-1.5 truncate text-sm font-semibold text-gray-950">{ticket.subject}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{ticket.category} · {ticket.priority}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── DESKTOP ONLY ─────────────────────────────────────────────────── */}
      <div className="hidden md:block md:space-y-7">

      <DashboardSection title="Support Paths" titleTone="blue">
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-color:#e2e8f0_transparent] [scrollbar-width:thin]">
          {supportHubCards.map((section) => {
            const Icon = section.icon
            return (
              <div
                key={section.title}
                className="w-[320px] min-w-[320px] shrink-0 snap-start rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-[#0052FF]">
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-gray-950">{section.title}</h2>
                    <p className="mt-0.5 text-xs leading-5 text-gray-500">{section.description}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  {section.articles.map((article) => (
                    <button
                      key={article.id}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(article.category)
                        setSelectedArticle(article)
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2 text-left text-xs font-semibold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50/70"
                    >
                      <span className="min-w-0 truncate">{article.title}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#0052FF]" />
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </DashboardSection>


<DashboardSection title="Documentation" titleTone="blue">
        <div className="space-y-3">
          {!hasSearch && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {categorySummaries.map(({ category, count, sample }) => {
                const active = selectedCategory === category
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(category)
                      setArticlesExpanded(false)
                    }}
                    className={`rounded-2xl border bg-white p-3 text-left shadow-[0_8px_24px_rgba(15,23,42,0.04)] outline-none transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50/30 focus-visible:ring-4 focus-visible:ring-blue-100 ${
                      active ? "border-[#0052FF] ring-4 ring-blue-100" : "border-gray-200/80"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-gray-950">{category}</span>
                      <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-[#0052FF]">
                        {count}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-gray-600">{sample}</p>
                  </button>
                )
              })}
            </div>
          )}

          <div className="rounded-2xl border border-gray-200/80 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-4">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-950">
                  {hasSearch
                    ? `Search results for "${query.trim()}"`
                    : selectedCategory === "All"
                      ? "Recommended docs"
                      : selectedCategory}
                </p>
                <p className="text-xs text-gray-500">
                  Showing {visibleArticles.length} of {filteredArticles.length} articles
                </p>
              </div>
              {(selectedCategory !== "All" || hasSearch) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory("All")
                    setQuery("")
                    setArticlesExpanded(false)
                  }}
                  className="self-start rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 sm:self-auto"
                >
                  Reset
                </button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleArticles.map((article) => (
                <button
                  key={article.id}
                  type="button"
                  onClick={() => setSelectedArticle(article)}
                  className="group min-h-[142px] rounded-2xl border border-gray-200/80 bg-gray-50/50 p-3.5 text-left outline-none transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-white hover:shadow-[0_14px_34px_rgba(15,23,42,0.08)] focus-visible:ring-4 focus-visible:ring-blue-100"
                >
                  <div className="flex items-start justify-between gap-3">
                    <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-[#0052FF]" />
                    <ProviderStatusPill label={article.category} tone="blue" />
                  </div>
                  <h2 className="mt-3 text-base font-semibold text-gray-950">{article.title}</h2>
                  <p className="mt-2 text-sm leading-5 text-gray-600">{article.description}</p>
                  <span className="mt-4 inline-flex items-center text-xs font-semibold text-[#0052FF]">
                    Read guide
                    <span className="ml-1 transition group-hover:translate-x-0.5">-&gt;</span>
                  </span>
                </button>
              ))}

              {filteredArticles.length === 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:col-span-2 xl:col-span-3">
                  No help articles matched your search. Try a payment status, provider name, or report term.
                </div>
              )}
            </div>

            {(hasMoreArticles || articlesExpanded) && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => setArticlesExpanded((current) => !current)}
                  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-[#0052FF] transition hover:border-[#0052FF] hover:bg-blue-100"
                >
                  {articlesExpanded ? "Show fewer articles" : `View more articles (${filteredArticles.length - visibleArticles.length})`}
                </button>
              </div>
            )}
          </div>
        </div>
      </DashboardSection>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left column: Support tickets + Feedback */}
        <div className="space-y-4 md:space-y-5">
          <DashboardSection title="Support" titleTone="blue" className="min-w-0">
            {/* Open a Ticket form */}
            <div id="support-ticket" className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-950">Open a Ticket</h2>
                  <p className="mt-1 text-sm leading-6 text-gray-600">
                    Send PineTree the details needed to investigate setup, provider, wallet, payment status, dashboard, or API issues.
                  </p>
                </div>
                <LifeBuoy className="h-6 w-6 shrink-0 text-[#0052FF]" />
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <Field label="Category">
                  <select
                    value={ticketForm.category}
                    onChange={(event) => setTicketForm((current) => ({ ...current, category: event.target.value }))}
                    className="form-field"
                  >
                    {supportTicketCategories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </Field>
                <Field label="Priority">
                  <select
                    value={ticketForm.priority}
                    onChange={(event) => setTicketForm((current) => ({ ...current, priority: event.target.value }))}
                    className="form-field"
                  >
                    {supportTicketPriorities.map((priority) => <option key={priority}>{priority}</option>)}
                  </select>
                </Field>
                <Field label="Subject">
                  <input
                    value={ticketForm.subject}
                    onChange={(event) => setTicketForm((current) => ({ ...current, subject: event.target.value }))}
                    className="form-field"
                    placeholder="Payment is still pending"
                  />
                </Field>
                <Field label="Related Payment ID">
                  <input
                    value={ticketForm.relatedPaymentId}
                    onChange={(event) => setTicketForm((current) => ({ ...current, relatedPaymentId: event.target.value }))}
                    className="form-field"
                    placeholder="Optional"
                  />
                </Field>
                <Field label="Description" className="md:col-span-2">
                  <textarea
                    value={ticketForm.description}
                    onChange={(event) => setTicketForm((current) => ({ ...current, description: event.target.value }))}
                    className="form-field min-h-28 resize-y"
                    placeholder="Include what happened, payment ID, provider, wallet/network, approximate time, amount, transaction hash if available, and what you expected."
                  />
                  <p className="mt-1.5 text-xs text-gray-400">
                    For payment issues, include the payment ID, provider/network, wallet used, approximate time, amount, and transaction hash if available.
                  </p>
                </Field>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => void submitTicket()}
                  disabled={submittingTicket}
                  className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50 sm:w-auto"
                >
                  <Send size={16} />
                  {submittingTicket ? "Opening..." : "Open Ticket"}
                </button>
              </div>
            </div>

            {/* Recent Tickets window */}
            <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-950">Recent Tickets</h2>
                <button
                  type="button"
                  onClick={() => void loadTickets()}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                >
                  Refresh
                </button>
              </div>

              {/* Status filter chips */}
              <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                {TICKET_FILTERS.map((filter) => {
                  const active = filter === ticketFilter
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setTicketFilter(filter)}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? "border-[#0052FF] bg-[#0052FF] text-white shadow-sm"
                          : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:bg-blue-50"
                      }`}
                    >
                      {filter}
                    </button>
                  )
                })}
              </div>

              {/* Loading skeletons */}
              {ticketsLoading && (
                <div className="space-y-2">
                  <div className="h-[72px] animate-pulse rounded-xl bg-gray-100" />
                  <div className="h-[72px] animate-pulse rounded-xl bg-gray-100" />
                </div>
              )}

              {/* Error */}
              {!ticketsLoading && ticketError && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                  {ticketError}
                </div>
              )}

              {/* Empty state */}
              {!ticketsLoading && !ticketError && filteredTickets.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border border-blue-100 bg-blue-50">
                    <LifeBuoy className="h-5 w-5 text-[#0052FF]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-950">
                      {ticketFilter === "All" ? "No support tickets yet" : `No ${ticketFilter.toLowerCase()} tickets`}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {ticketFilter === "All"
                        ? "Open a ticket above to get help from PineTree."
                        : "Change the filter to see other tickets."}
                    </p>
                  </div>
                </div>
              )}

              {/* Ticket rows */}
              {!ticketsLoading && !ticketError && filteredTickets.length > 0 && (
                <div className="space-y-1.5">
                  {filteredTickets.map((ticket) => (
                    <button
                      key={ticket.id}
                      type="button"
                      onClick={() => openTicketDetail(ticket)}
                      className={`w-full rounded-xl border p-3 text-left outline-none transition hover:border-blue-200 hover:bg-blue-50/30 focus-visible:ring-4 focus-visible:ring-blue-100 ${
                        ticket.status === "archived"
                          ? "border-gray-100 bg-gray-50/60 opacity-80"
                          : "border-gray-100 bg-white hover:shadow-[0_4px_14px_rgba(0,82,255,0.06)]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <TicketStatusPill status={ticket.status} />
                          <span className="text-xs text-gray-500">{ticket.category}</span>
                          <span className="text-gray-300" aria-hidden>·</span>
                          <span className="text-xs text-gray-500">{ticket.priority}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="text-[11px] text-gray-400">{formatDate(ticket.created_at)}</span>
                          <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                        </div>
                      </div>
                      <div className="mt-1.5 text-sm font-semibold text-gray-950">{ticket.subject}</div>
                      {ticket.last_response_at && (
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-500">
                          <Clock className="h-3 w-3 shrink-0" />
                          Last response {formatDate(ticket.last_response_at)}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </DashboardSection>

          <DashboardSection title="Feedback" titleTone="blue">
            <div id="feedback" className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 shrink-0 text-[#0052FF]" />
                <h2 className="text-base font-semibold text-gray-950">General Feedback</h2>
              </div>
              <p className="mt-1.5 text-sm leading-5 text-gray-500">
                Share product, documentation, payment, or dashboard feedback.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Type">
                  <select
                    value={feedbackForm.type}
                    onChange={(event) => setFeedbackForm((current) => ({ ...current, type: event.target.value }))}
                    className="form-field"
                  >
                    {feedbackTypes.map((type) => <option key={type}>{type}</option>)}
                  </select>
                </Field>
                <Field label="Rating">
                  <select
                    value={feedbackForm.rating}
                    onChange={(event) => setFeedbackForm((current) => ({ ...current, rating: event.target.value }))}
                    className="form-field"
                  >
                    <option value="">Optional</option>
                    <option value="5">5 - Excellent</option>
                    <option value="4">4 - Good</option>
                    <option value="3">3 - Neutral</option>
                    <option value="2">2 - Needs work</option>
                    <option value="1">1 - Poor</option>
                  </select>
                </Field>
              </div>

              <div className="mt-3">
                <Field label="Message">
                  <textarea
                    value={feedbackForm.message}
                    onChange={(event) => setFeedbackForm((current) => ({ ...current, message: event.target.value }))}
                    className="form-field min-h-[80px] resize-y"
                    placeholder="Tell us what would make PineTree clearer or easier to use."
                  />
                </Field>
              </div>

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => void submitFeedback()}
                  disabled={submittingFeedback}
                  className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50 sm:w-auto"
                >
                  <CheckCircle2 size={16} />
                  {submittingFeedback ? "Sending..." : "Send Feedback"}
                </button>
              </div>
            </div>
          </DashboardSection>
        </div>

        {/* Right column: Assistant */}
        <div>
          <DashboardSection title="PineTree AI" titleTone="blue">
            <div id="pinetree-ai" className="rounded-2xl border border-blue-200/80 bg-[radial-gradient(circle_at_top_right,rgba(0,82,255,0.13),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f7fbff_55%,#eef5ff_100%)] p-4 shadow-[0_14px_45px_rgba(37,99,235,0.10)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-[#0052FF]" />
                    <h2 className="text-lg font-semibold text-gray-950">Ask PineTree AI</h2>
                  </div>
                  <p className="mt-1.5 text-sm leading-5 text-gray-500">
                    PineTree AI can help you understand your account setup, connected wallets, payment rails, POS, checkout, dashboard, and recent payment status.
                  </p>
                </div>
                <ProviderStatusPill label="Account-aware" tone="blue" />
              </div>

              <div className="mt-3 grid gap-1.5">
                {suggestedQuestions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => void submitAssistantQuestion(question)}
                    disabled={assistantLoading}
                    className="w-full rounded-xl border border-blue-100 bg-white/85 px-3 py-1.5 text-left text-sm font-medium text-gray-700 transition hover:border-[#0052FF] hover:bg-blue-50"
                  >
                    {question}
                  </button>
                ))}
              </div>

              <div className="mt-3 max-h-[260px] min-h-[100px] space-y-3 overflow-y-auto rounded-xl border border-blue-100 bg-white/75 p-3">
                {assistantMessages.map((message) => (
                  <AssistantMessageBubble
                    key={message.id}
                    message={message}
                    onOpenArticle={(article) => {
                      setSelectedCategory(article.category)
                      setSelectedArticle(article)
                      setQuery("")
                    }}
                  />
                ))}
                {assistantLoading && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-sm text-[#0052FF]">
                    Checking your PineTree account context...
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
                <Sparkles className="h-4 w-4 text-[#0052FF]" />
                <input
                  value={assistantQuestion}
                  onChange={(event) => setAssistantQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault()
                      void submitAssistantQuestion()
                    }
                  }}
                  placeholder="Ask PineTree AI about your setup or a payment status"
                  className="min-h-9 flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
                />
                <button
                  type="button"
                  onClick={() => void submitAssistantQuestion()}
                  disabled={assistantLoading || !assistantQuestion.trim()}
                  aria-label="Ask PineTree AI"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0052FF] text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          </DashboardSection>
        </div>
      </div>

      </div>{/* end desktop-only block */}

      {/* Article modal */}
      {selectedArticle && (
        <ArticleModal
          article={selectedArticle}
          onClose={() => setSelectedArticle(null)}
          onOpenArticle={setSelectedArticle}
        />
      )}

      {/* Ticket detail modal */}
      {selectedTicket && (
        <TicketDetailModal
          ticket={selectedTicket}
          messages={ticketDetailMessages}
          loading={ticketDetailLoading}
          error={ticketDetailError}
          onClose={() => setSelectedTicket(null)}
          onSendMessage={sendFollowUpMessage}
        />
      )}
    </div>
  )
}

function AssistantMessageBubble({
  message,
  onOpenArticle
}: {
  message: AssistantMessage
  onOpenArticle: (article: HelpArticle) => void
}) {
  const isUser = message.role === "user"
  const answer = message.answer

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-2xl border px-3 py-2.5 ${
          isUser
            ? "border-[#0052FF] bg-[#0052FF] text-white"
            : "border-gray-200 bg-white text-gray-700 shadow-sm"
        }`}
      >
        {answer ? (
          <>
            <p className="text-sm font-semibold text-gray-950">{answer.title}</p>
            <p className="mt-1 text-sm leading-6 text-gray-600">{answer.body}</p>

            {answer.checklist && answer.checklist.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {answer.checklist.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs font-semibold text-gray-700">{item.label}</span>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          item.tone === "good"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : item.tone === "warning"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-gray-200 bg-gray-100 text-gray-600"
                        }`}
                      >
                        {item.tone === "good" ? "OK" : item.tone === "warning" ? "Review" : "Info"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-gray-600">{item.value}</p>
                  </div>
                ))}
              </div>
            )}

            {answer.bullets.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {answer.bullets.map((bullet) => (
                  <div key={bullet} className="flex gap-2 text-xs leading-5 text-gray-700">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0052FF]" />
                    <span>{bullet}</span>
                  </div>
                ))}
              </div>
            )}

            {answer.followUpQuestion && (
              <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-[#0052FF]">
                {answer.followUpQuestion}
              </div>
            )}

            {answer.escalation && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                {answer.escalation}
              </div>
            )}

            {answer.matchedArticles.length > 0 && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#0052FF]">
                  Related docs
                </p>
                <div className="mt-2 space-y-1">
                  {answer.matchedArticles.map((result) => (
                    <button
                      key={result.article.id}
                      type="button"
                      onClick={() => onOpenArticle(result.article)}
                      className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-blue-50"
                    >
                      <span className="block text-xs font-semibold text-gray-950">{result.article.title}</span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-gray-600">{result.snippet}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className={`text-sm leading-6 ${isUser ? "text-white" : "text-gray-600"}`}>
            {message.content}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── TicketStatusPill ─────────────────────────────────────────────────────────

function TicketStatusPill({ status }: { status: string }) {
  const config = TICKET_STATUS_CONFIG[status] ?? {
    label: status,
    cls: "bg-gray-100 text-gray-600 border-gray-200"
  }
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${config.cls}`}>
      {config.label}
    </span>
  )
}

// ─── TicketDetailModal ────────────────────────────────────────────────────────

function TicketDetailModal({
  ticket,
  messages,
  loading,
  error,
  onClose,
  onSendMessage
}: {
  ticket: TicketRecord
  messages: TicketMessage[]
  loading: boolean
  error: string | null
  onClose: () => void
  onSendMessage: (message: string) => Promise<void>
}) {
  const [followUp, setFollowUp] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const canReply = ["open", "in_review", "waiting_on_merchant"].includes(ticket.status)
  const statusDesc = STATUS_DESCRIPTION[ticket.status] ?? ""

  async function handleSend() {
    const text = followUp.trim()
    if (!text) return
    try {
      setSubmitting(true)
      await onSendMessage(text)
      setFollowUp("")
      toast.success("Message sent.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send message.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-detail-title"
        className="flex h-[100dvh] w-full flex-col overflow-hidden rounded-t-[1.35rem] border border-white/70 bg-white/95 shadow-[0_28px_90px_rgba(15,23,42,0.30)] sm:h-auto sm:max-h-[88vh] sm:max-w-2xl sm:rounded-[1.35rem]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 bg-white/90 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TicketStatusPill status={ticket.status} />
              <span className="text-xs text-gray-500">{ticket.category}</span>
            </div>
            <h2 id="ticket-detail-title" className="mt-2 text-lg font-semibold leading-snug text-gray-950 sm:text-xl">
              {ticket.subject}
            </h2>
            {statusDesc && (
              <p className="mt-1 text-xs text-gray-500">{statusDesc}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close ticket"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 shadow-sm transition hover:border-blue-200 hover:text-[#0052FF] focus:outline-none focus:ring-4 focus:ring-blue-100"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {/* Meta cells */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MetaCell label="Priority" value={ticket.priority} />
            <MetaCell label="Created" value={formatDate(ticket.created_at)} />
            {ticket.last_response_at && (
              <MetaCell label="Last Response" value={formatDate(ticket.last_response_at)} />
            )}
            {ticket.resolved_at && (
              <MetaCell label="Resolved" value={formatDate(ticket.resolved_at)} />
            )}
            {ticket.archived_at && (
              <MetaCell label="Archived" value={formatDate(ticket.archived_at)} />
            )}
            {ticket.related_payment_id && (
              <MetaCell label="Payment ID" value={ticket.related_payment_id} mono />
            )}
          </div>

          {/* Original description */}
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
              Description
            </p>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm leading-6 text-gray-700 whitespace-pre-wrap">
              {ticket.description}
            </div>
          </div>

          {/* Message thread */}
          <div className="mt-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
              Responses
            </p>

            {loading && (
              <div className="h-16 animate-pulse rounded-xl bg-gray-100" />
            )}

            {!loading && error && (
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                {error}
              </div>
            )}

            {!loading && !error && messages.length === 0 && (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50/80 px-4 py-7 text-center">
                <MessageSquare className="h-5 w-5 text-gray-300" />
                <p className="text-sm text-gray-500">
                  No responses yet. PineTree will reply here when your ticket is reviewed.
                </p>
              </div>
            )}

            {!loading && messages.length > 0 && (
              <div className="space-y-4">
                {messages.map((msg) => (
                  <TicketMessageBubble key={msg.id} message={msg} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {canReply ? (
          <div className="border-t border-gray-100 bg-white/95 px-4 py-3 sm:px-6">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
              Add a follow-up message
            </p>
            <div className="flex items-end gap-2">
              <textarea
                value={followUp}
                onChange={(event) => setFollowUp(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    void handleSend()
                  }
                }}
                placeholder="Provide additional context or updates..."
                rows={2}
                className="form-field min-h-[60px] flex-1 resize-none text-sm"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={submitting || !followUp.trim()}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              >
                <Send size={14} />
                {submitting ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-gray-100 bg-gray-50/80 px-4 py-3 text-center text-xs text-gray-500 sm:px-6">
            {ticket.status === "resolved"
              ? "This ticket is resolved. Open a new ticket if you need further help."
              : "This ticket is archived and closed."}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── MetaCell ─────────────────────────────────────────────────────────────────

function MetaCell({
  label,
  value,
  mono = false
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-medium text-gray-950 ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </p>
    </div>
  )
}

// ─── TicketMessageBubble ──────────────────────────────────────────────────────

function TicketMessageBubble({ message }: { message: TicketMessage }) {
  const isPineTree = message.sender_type === "pinetree"
  const isSystem = message.sender_type === "system"
  const isMerchant = message.sender_type === "merchant"

  return (
    <div className={`flex gap-3 ${isMerchant ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
          isPineTree
            ? "border-blue-200 bg-blue-50 text-[#0052FF]"
            : isSystem
              ? "border-gray-200 bg-gray-100 text-gray-500"
              : "border-gray-200 bg-gray-100 text-gray-700"
        }`}
      >
        {isPineTree ? "PT" : isSystem ? "SYS" : "ME"}
      </div>
      <div className={`flex-1 ${isMerchant ? "flex flex-col items-end" : ""}`}>
        <div className={`mb-1 flex items-center gap-2 ${isMerchant ? "flex-row-reverse" : ""}`}>
          <span className="text-xs font-semibold text-gray-700">
            {message.sender_name ?? (isPineTree ? "PineTree" : isSystem ? "System" : "You")}
          </span>
          <span className="text-[10px] text-gray-400">{formatDate(message.created_at)}</span>
        </div>
        <div
          className={`max-w-[85%] rounded-xl border px-3 py-2 text-sm leading-6 text-gray-700 whitespace-pre-wrap ${
            isPineTree
              ? "border-blue-100 bg-blue-50/60"
              : isSystem
                ? "border-gray-200 bg-gray-50"
                : "border-gray-200 bg-white"
          }`}
        >
          {message.message}
        </div>
      </div>
    </div>
  )
}

// ─── ArticleModal ─────────────────────────────────────────────────────────────

function getRelatedArticles(article: HelpArticle) {
  const articleTags = new Set(article.tags.map((tag) => tag.toLowerCase()))

  return helpArticles
    .filter((candidate) => candidate.id !== article.id)
    .map((candidate) => {
      const sharedTags = candidate.tags.filter((tag) => articleTags.has(tag.toLowerCase())).length
      const categoryScore = candidate.category === article.category ? 2 : 0
      return { article: candidate, score: sharedTags + categoryScore }
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((result) => result.article)
}

function shouldShowTicketCta(article: HelpArticle) {
  const text = [
    article.category,
    article.title,
    article.description,
    article.tags.join(" ")
  ].join(" ").toLowerCase()

  return text.includes("troubleshooting") ||
    text.includes("payment") ||
    text.includes("failed") ||
    text.includes("stuck") ||
    text.includes("support")
}

function ArticleModal({
  article,
  onClose,
  onOpenArticle
}: {
  article: HelpArticle
  onClose: () => void
  onOpenArticle: (article: HelpArticle) => void
}) {
  const relatedArticles = getRelatedArticles(article)
  const paragraphs = article.body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-article-title"
        className="flex h-[100dvh] w-full flex-col overflow-hidden rounded-t-[1.35rem] border border-white/70 bg-white/95 shadow-[0_28px_90px_rgba(15,23,42,0.30)] sm:h-auto sm:max-h-[88vh] sm:max-w-2xl sm:rounded-[1.35rem]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 bg-white/90 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <ProviderStatusPill label={article.category} tone="blue" />
            <h2 id="help-article-title" className="mt-3 text-xl font-semibold text-gray-950 sm:text-2xl">
              {article.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              {article.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close article"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 shadow-sm transition hover:border-blue-200 hover:text-[#0052FF] focus:outline-none focus:ring-4 focus:ring-blue-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="space-y-4">
            {paragraphs.map((paragraph) => {
              const [label, rest] = paragraph.split(": ")
              const isLabeled = label === "What this means" || label === "What to check"

              return (
                <div
                  key={paragraph}
                  className={isLabeled ? "rounded-2xl border border-blue-100 bg-blue-50/55 p-4" : ""}
                >
                  {isLabeled ? (
                    <>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0052FF]">
                        {label}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-gray-700">{rest}</p>
                    </>
                  ) : (
                    <p className="text-sm leading-6 text-gray-700">{paragraph}</p>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {article.tags.map((tag) => (
              <span key={tag} className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600">
                {tag}
              </span>
            ))}
          </div>

          {relatedArticles.length > 0 && (
            <div className="mt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0052FF]">
                Related docs
              </p>
              <div className="mt-3 grid gap-2">
                {relatedArticles.map((related) => (
                  <button
                    key={related.id}
                    type="button"
                    onClick={() => onOpenArticle(related)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/50 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  >
                    <span className="block text-sm font-semibold text-gray-950">{related.title}</span>
                    <span className="mt-1 block text-xs leading-5 text-gray-600">{related.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {shouldShowTicketCta(article) && (
          <div className="border-t border-gray-100 bg-white/92 px-4 py-3 sm:px-6">
            <a
              href="#support-ticket"
              onClick={onClose}
              className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 sm:w-auto"
            >
              Open a ticket
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function QuickAction({ label, icon, href }: { label: string; icon: ReactNode; href: string }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-blue-200 bg-white px-3 text-sm font-semibold text-[#0052FF] shadow-sm transition hover:border-[#0052FF] hover:bg-blue-50"
    >
      {icon}
      {label}
    </a>
  )
}

function Field({
  label,
  children,
  className = ""
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
        {label}
      </span>
      {children}
    </label>
  )
}
