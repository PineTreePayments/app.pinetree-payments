"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  Bot,
  BookOpen,
  CheckCircle2,
  LifeBuoy,
  MessageSquare,
  Search,
  Send,
  Sparkles,
  X
} from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import { helpArticles, helpCategories, type HelpArticle } from "@/lib/help/helpContent"
import { searchHelpArticles, type HelpSearchResult } from "@/lib/help/retrieval"
import {
  feedbackTypes,
  supportTicketCategories,
  supportTicketPriorities
} from "@/lib/help/supportOptions"
import {
  DashboardSection,
  GroupedMetricSurface,
  ProviderStatusPill
} from "@/components/dashboard/DashboardPrimitives"

type TicketRecord = {
  id: string
  category: string
  subject: string
  description: string
  priority: string
  status: string
  related_payment_id: string | null
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

const suggestedQuestions = [
  "Why is my payment pending?",
  "How do wallet connections work?",
  "How do I troubleshoot a failed transaction?",
  "What does Processing mean?"
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

  const visibleLimit = articlesExpanded ? filteredArticles.length : DEFAULT_VISIBLE_ARTICLES
  const visibleArticles = filteredArticles.slice(0, visibleLimit)
  const hasMoreArticles = filteredArticles.length > visibleArticles.length
  const hasSearch = query.trim().length > 0

  const assistantResults = useMemo<HelpSearchResult[]>(() => {
    return searchHelpArticles(assistantQuestion, 3)
  }, [assistantQuestion])

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

  useEffect(() => {
    void loadTickets()
  }, [loadTickets])

  useEffect(() => {
    if (!selectedArticle) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedArticle(null)
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [selectedArticle])

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

  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <h1 className="text-2xl font-semibold text-gray-950 md:text-3xl">Help Center</h1>
        <p className="mt-1 text-[12px] font-semibold leading-5 tracking-[0.01em] text-[#0052FF] sm:text-sm">
          PineTree Insight for payments, wallets, checkout, and merchant support.
        </p>
      </div>

      <div className="rounded-2xl border border-blue-200/80 bg-[radial-gradient(circle_at_top_right,rgba(0,82,255,0.10),transparent_32%),linear-gradient(135deg,#ffffff_0%,#f8fbff_58%,#eef5ff_100%)] p-4 shadow-[0_12px_36px_rgba(0,82,255,0.10)] sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
              Merchant Support
            </p>
            <h2 className="mt-1.5 text-xl font-semibold leading-tight text-gray-950 sm:text-2xl">
              Support workspace
            </h2>
            <p className="mt-1 text-sm leading-5 text-gray-600">
              Search docs, open tickets, and send feedback from one compact support panel.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 md:w-auto md:min-w-[300px]">
            <QuickAction label="Open a Ticket" icon={<LifeBuoy size={18} />} href="#support-ticket" />
            <QuickAction label="General Feedback" icon={<MessageSquare size={18} />} href="#feedback" />
          </div>
        </div>
      </div>

      <GroupedMetricSurface className="p-3 sm:p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setArticlesExpanded(false)
            }}
            placeholder="Search help articles, statuses, providers, or reports"
            className="min-h-12 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#0052FF] focus:bg-white focus:ring-4 focus:ring-blue-100"
          />
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
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
                className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition ${
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
      </GroupedMetricSurface>

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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <DashboardSection title="Support" titleTone="blue" className="min-w-0">
          <div id="support-ticket" className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-950">Open a Ticket</h2>
                <p className="mt-1 text-sm leading-6 text-gray-600">
                  Send PineTree the details needed to investigate payment, dashboard, settlement, or API issues.
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
                  placeholder="Include what happened, the approximate time, provider, network, amount, and any payment reference you have."
                />
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
            {!ticketsLoading && !ticketError && tickets.length === 0 && (
              <p className="text-sm text-gray-600">No support tickets yet.</p>
            )}
            {!ticketsLoading && tickets.length > 0 && (
              <div className="divide-y divide-gray-100">
                {tickets.map((ticket) => (
                  <div key={ticket.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <ProviderStatusPill label={ticket.status} tone="blue" />
                      <span className="text-xs font-medium text-gray-500">{ticket.category}</span>
                      <span className="text-xs font-medium text-gray-500">{ticket.priority}</span>
                      <span className="text-xs text-gray-400">{formatDate(ticket.created_at)}</span>
                    </div>
                    <div className="mt-2 text-sm font-semibold text-gray-950">{ticket.subject}</div>
                    <p className="mt-1 line-clamp-2 text-sm leading-5 text-gray-600">{ticket.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DashboardSection>

        <div className="space-y-4">
          <DashboardSection title="Assistant" titleTone="blue">
            <div className="rounded-2xl border border-blue-200/80 bg-[linear-gradient(135deg,#ffffff_0%,#f7fbff_55%,#eef5ff_100%)] p-5 shadow-[0_14px_45px_rgba(37,99,235,0.10)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-[#0052FF]" />
                    <h2 className="text-lg font-semibold text-gray-950">Ask PineTree Assistant</h2>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    Private beta placeholder. When enabled, answers will be grounded in PineTree help docs, transaction states, and merchant account context.
                  </p>
                </div>
                <ProviderStatusPill label="Coming Soon" tone="blue" />
              </div>

              <div className="mt-4 space-y-2">
                {suggestedQuestions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => setAssistantQuestion(question)}
                    className="w-full rounded-xl border border-blue-100 bg-white/80 px-3 py-2 text-left text-sm text-gray-700 transition hover:border-[#0052FF] hover:bg-blue-50"
                  >
                    {question}
                  </button>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
                <Sparkles className="h-4 w-4 text-[#0052FF]" />
                <input
                  value={assistantQuestion}
                  onChange={(event) => setAssistantQuestion(event.target.value)}
                  placeholder="Search PineTree help docs"
                  className="min-h-9 flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
                />
              </div>

              <div className="mt-3 rounded-xl border border-blue-100 bg-white/75 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#0052FF]">
                  Local docs preview
                </p>
                <div className="mt-2 space-y-2">
                  {assistantResults.map((result) => (
                    <button
                      key={result.article.id}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(result.article.category)
                        setSelectedArticle(result.article)
                        setQuery("")
                      }}
                      className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-blue-50"
                    >
                      <span className="block text-sm font-semibold text-gray-950">{result.article.title}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-gray-600">{result.snippet}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </DashboardSection>
        </div>
      </div>

      <DashboardSection title="Feedback" titleTone="blue">
        <div id="feedback" className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[200px_190px_minmax(0,1fr)] lg:items-start lg:gap-5">
            <div>
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 shrink-0 text-[#0052FF]" />
                <h2 className="text-base font-semibold text-gray-950">General Feedback</h2>
              </div>
              <p className="mt-1.5 text-sm leading-5 text-gray-500">
                Share product, documentation, payment, or dashboard feedback.
              </p>
            </div>

            <div className="grid gap-3">
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

            <div className="flex flex-col gap-3">
              <Field label="Message">
                <textarea
                  value={feedbackForm.message}
                  onChange={(event) => setFeedbackForm((current) => ({ ...current, message: event.target.value }))}
                  className="form-field min-h-[88px] resize-y"
                  placeholder="Tell us what would make PineTree clearer or easier to use."
                />
              </Field>
              <button
                type="button"
                onClick={() => void submitFeedback()}
                disabled={submittingFeedback}
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50 lg:w-auto lg:self-end"
              >
                <CheckCircle2 size={16} />
                {submittingFeedback ? "Sending..." : "Send Feedback"}
              </button>
            </div>
          </div>
        </div>
      </DashboardSection>

      {selectedArticle && (
        <ArticleModal
          article={selectedArticle}
          onClose={() => setSelectedArticle(null)}
          onOpenArticle={setSelectedArticle}
        />
      )}
    </div>
  )
}

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

function QuickAction({ label, icon, href }: { label: string; icon: ReactNode; href: string }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-3 text-sm font-semibold text-[#0052FF] shadow-sm transition hover:border-[#0052FF] hover:bg-blue-50"
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
