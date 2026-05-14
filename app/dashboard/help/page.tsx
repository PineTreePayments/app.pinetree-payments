"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  Bot,
  CheckCircle2,
  FileText,
  LifeBuoy,
  MessageSquare,
  Search,
  Send,
  Sparkles
} from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import { helpArticles, helpCategories, type HelpArticle } from "@/lib/help/helpContent"
import {
  DashboardHeroCard,
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

const ticketCategories = [
  "Payment Issue",
  "Wallet Connection",
  "Dashboard Issue",
  "Settlement Question",
  "POS Issue",
  "Feature Request",
  "API Support",
  "General Support"
]

const priorities = ["Low", "Normal", "High", "Urgent"]

const feedbackTypes = [
  "Product Feedback",
  "Documentation Feedback",
  "Payment Experience",
  "Dashboard Experience",
  "Feature Request",
  "Other"
]

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

function searchableText(article: HelpArticle) {
  return [
    article.title,
    article.category,
    article.description,
    article.body,
    article.tags.join(" ")
  ].join(" ").toLowerCase()
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value))
}

export default function HelpCenterPage() {
  const [query, setQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("All")
  const [activeArticle, setActiveArticle] = useState<HelpArticle | null>(helpArticles[0] ?? null)
  const [ticketForm, setTicketForm] = useState<TicketForm>(emptyTicketForm)
  const [feedbackForm, setFeedbackForm] = useState<FeedbackForm>(emptyFeedbackForm)
  const [tickets, setTickets] = useState<TicketRecord[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(true)
  const [ticketError, setTicketError] = useState<string | null>(null)
  const [submittingTicket, setSubmittingTicket] = useState(false)
  const [submittingFeedback, setSubmittingFeedback] = useState(false)

  const filteredArticles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return helpArticles.filter((article) => {
      const categoryMatch = selectedCategory === "All" || article.category === selectedCategory
      const queryMatch = !normalizedQuery || searchableText(article).includes(normalizedQuery)
      return categoryMatch && queryMatch
    })
  }, [query, selectedCategory])

  useEffect(() => {
    if (filteredArticles.length === 0) {
      setActiveArticle(null)
      return
    }

    if (!activeArticle || !filteredArticles.some((article) => article.id === activeArticle.id)) {
      setActiveArticle(filteredArticles[0])
    }
  }, [activeArticle, filteredArticles])

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
      setTicketError(error instanceof Error ? error.message : "Failed to load support tickets.")
    } finally {
      setTicketsLoading(false)
    }
  }, [getAccessToken])

  useEffect(() => {
    void loadTickets()
  }, [loadTickets])

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
      const payload = (await res.json().catch(() => null)) as { ticket?: TicketRecord; error?: string } | null

      if (!res.ok || !payload?.ticket) {
        throw new Error(payload?.error || "Failed to open support ticket.")
      }

      setTickets((current) => [payload.ticket as TicketRecord, ...current])
      setTicketForm(emptyTicketForm)
      setTicketError(null)
      toast.success("Support ticket opened.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open support ticket.")
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
      const payload = (await res.json().catch(() => null)) as { error?: string } | null

      if (!res.ok) {
        throw new Error(payload?.error || "Failed to send feedback.")
      }

      setFeedbackForm(emptyFeedbackForm)
      toast.success("Feedback sent.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send feedback.")
    } finally {
      setSubmittingFeedback(false)
    }
  }

  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <h1 className="text-2xl font-semibold text-gray-950 md:text-3xl">Help Center</h1>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          Find answers, troubleshoot payments, and contact PineTree support.
        </p>
      </div>

      <DashboardHeroCard
        eyebrow="Merchant Support"
        title="Documentation and support requests"
        value="Help Center"
        detail="Search PineTree payment concepts, open support tickets, and leave product feedback from one dashboard workspace."
        secondary={
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:min-w-[320px]">
            <QuickAction label="Open a Ticket" icon={<LifeBuoy size={18} />} href="#support-ticket" />
            <QuickAction label="General Feedback" icon={<MessageSquare size={18} />} href="#feedback" />
          </div>
        }
      />

      <GroupedMetricSurface>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
                onClick={() => setSelectedCategory(category)}
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
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredArticles.map((article) => (
              <button
                key={article.id}
                type="button"
                onClick={() => setActiveArticle(article)}
                className={`min-h-[148px] rounded-2xl border bg-white p-4 text-left shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-blue-200 ${
                  activeArticle?.id === article.id ? "border-[#0052FF] ring-4 ring-blue-100" : "border-gray-200/80"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <FileText className="mt-0.5 h-5 w-5 shrink-0 text-[#0052FF]" />
                  <ProviderStatusPill label={article.category} tone="blue" />
                </div>
                <h2 className="mt-3 text-base font-semibold text-gray-950">{article.title}</h2>
                <p className="mt-2 text-sm leading-5 text-gray-600">{article.description}</p>
              </button>
            ))}

            {filteredArticles.length === 0 && (
              <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:col-span-2">
                No help articles matched your search. Try a payment status, provider name, or report term.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            {activeArticle ? (
              <>
                <ProviderStatusPill label={activeArticle.category} tone="blue" />
                <h2 className="mt-3 text-xl font-semibold text-gray-950">{activeArticle.title}</h2>
                <p className="mt-3 text-sm leading-6 text-gray-700">{activeArticle.body}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {activeArticle.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600">
                      {tag}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-600">Select an article to preview details.</p>
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
                  {ticketCategories.map((category) => <option key={category}>{category}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  value={ticketForm.priority}
                  onChange={(event) => setTicketForm((current) => ({ ...current, priority: event.target.value }))}
                  className="form-field"
                >
                  {priorities.map((priority) => <option key={priority}>{priority}</option>)}
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
                className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
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

            {ticketsLoading && <p className="text-sm text-gray-600">Loading support tickets...</p>}
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
                    Private beta placeholder. Future responses will be based only on PineTree documentation, transaction states, and merchant account context.
                  </p>
                </div>
                <ProviderStatusPill label="Coming Soon" tone="blue" />
              </div>

              <div className="mt-4 space-y-2">
                {suggestedQuestions.map((question) => (
                  <div key={question} className="rounded-xl border border-blue-100 bg-white/80 px-3 py-2 text-sm text-gray-700">
                    {question}
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
                <Sparkles className="h-4 w-4 text-[#0052FF]" />
                <input
                  disabled
                  placeholder="Assistant integration is not enabled"
                  className="min-h-9 flex-1 bg-transparent text-sm text-gray-500 outline-none placeholder:text-gray-400"
                />
              </div>
            </div>
          </DashboardSection>

          <DashboardSection title="Feedback" titleTone="blue">
            <div id="feedback" className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-950">General Feedback</h2>
                  <p className="mt-1 text-sm leading-6 text-gray-600">
                    Share product, documentation, payment, or dashboard feedback.
                  </p>
                </div>
                <MessageSquare className="h-6 w-6 shrink-0 text-[#0052FF]" />
              </div>

              <div className="mt-4 space-y-3">
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
                <Field label="Message">
                  <textarea
                    value={feedbackForm.message}
                    onChange={(event) => setFeedbackForm((current) => ({ ...current, message: event.target.value }))}
                    className="form-field min-h-24 resize-y"
                    placeholder="Tell us what would make PineTree clearer or easier to use."
                  />
                </Field>
              </div>

              <button
                type="button"
                onClick={() => void submitFeedback()}
                disabled={submittingFeedback}
                className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              >
                <CheckCircle2 size={16} />
                {submittingFeedback ? "Sending..." : "Send Feedback"}
              </button>
            </div>
          </DashboardSection>
        </div>
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
