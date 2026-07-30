"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, MessageSquare, Send, X } from "lucide-react"
import { modalCloseButtonClass } from "@/components/ui/ModalCloseButton"
import { primaryActionButtonClass } from "@/components/ui/PrimaryActionButton"
import { segmentedButtonClass } from "@/components/ui/SegmentedButtons"
import {
  SUPPORT_TICKET_STATUSES,
  formatSupportCategory,
  formatSupportPriority,
  formatSupportSenderLabel,
  formatSupportStatus,
  supportPriorityPillClass,
  supportStatusPillClass,
} from "@/lib/support/supportDisplay"

// Admin support ticket detail — a right-side slide-over panel that matches the
// Platform Transaction Detail panel's visual language (full-height white panel,
// flex-none header, section labels, shadow-2xl, backdrop at z-40).
//
// Layout contract: the panel is a fixed-height flex column whose ONLY flexible
// child is the conversation. Header, ticket-details disclosure, status row and
// composer are all flex-none, so the message history absorbs every remaining
// pixel and scrolls on its own while the reply box stays pinned near the bottom.

export type AdminSupportTicket = {
  id: string
  merchant_id: string
  merchant_email: string | null
  merchant_business_name: string | null
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
}

export type AdminSupportMessage = {
  id: string
  ticket_id: string
  merchant_id: string
  sender_type: "merchant" | "pinetree" | "system"
  sender_name: string | null
  sender_email: string | null
  message: string
  created_at: string
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const COMPOSER_MIN_HEIGHT = 104
const COMPOSER_MAX_HEIGHT = 240

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-gray-400">{label}</p>
      <p className={`mt-0.5 break-words text-gray-700 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  )
}

export default function AdminSupportTicketPanel({
  ticket,
  messages,
  loading,
  loadError,
  updatingStatus,
  formatDate,
  formatDateTime,
  onClose,
  onUpdateStatus,
  onSendReply,
}: {
  ticket: AdminSupportTicket | null
  messages: AdminSupportMessage[]
  loading: boolean
  loadError?: string | null
  updatingStatus: boolean
  formatDate: (iso: string) => string
  formatDateTime: (iso: string) => string
  onClose: () => void
  onUpdateStatus: (status: string) => void
  onSendReply: (message: string) => Promise<void>
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const conversationRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const autoScrollRef = useRef(true)

  // Ticket details start collapsed at every breakpoint — the conversation is the
  // point of the panel; merchant metadata is one tap away.
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const ticketId = ticket?.id ?? null

  // Reset per-ticket composer state when a different ticket is opened.
  useEffect(() => {
    setDraft("")
    setSendError(null)
    setDetailsOpen(false)
    autoScrollRef.current = true
  }, [ticketId])

  // Capture the element that opened the panel (the ticket row) and return focus
  // to it on close.
  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      returnFocusRef.current?.focus?.()
    }
  }, [])

  // Escape closes; Tab is trapped inside the panel.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key !== "Tab") return
      const container = panelRef.current
      if (!container) return

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((element) => element.offsetParent !== null || element === document.activeElement)
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  // Move focus into the panel when it opens.
  useEffect(() => {
    const container = panelRef.current
    if (!container) return
    const target = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    target?.focus()
  }, [ticketId])

  // The original ticket leads the conversation so the whole exchange reads top
  // to bottom inside one scroll container.
  const conversation = useMemo(() => {
    if (!ticket) return []
    return [
      {
        id: `ticket-${ticket.id}-description`,
        sender_type: "merchant" as const,
        sender_name: null,
        message: ticket.description,
        created_at: ticket.created_at,
        isOpeningMessage: true,
      },
      ...messages.map((message) => ({
        id: message.id,
        sender_type: message.sender_type,
        sender_name: message.sender_name,
        message: message.message,
        created_at: message.created_at,
        isOpeningMessage: false,
      })),
    ]
  }, [ticket, messages])

  // Newest message is in view when the ticket opens and when a reply lands, but
  // a reader who has scrolled up to older messages is left where they are.
  useLayoutEffect(() => {
    const container = conversationRef.current
    if (!container || !autoScrollRef.current) return
    container.scrollTop = container.scrollHeight
  }, [conversation.length, loading])

  const handleConversationScroll = useCallback(() => {
    const container = conversationRef.current
    if (!container) return
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    autoScrollRef.current = distanceFromBottom < 80
  }, [])

  // Composer grows with the reply up to a bounded maximum.
  useEffect(() => {
    const textarea = composerRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(
      Math.max(textarea.scrollHeight, COMPOSER_MIN_HEIGHT),
      COMPOSER_MAX_HEIGHT
    )}px`
  }, [draft])

  async function handleSend() {
    const text = draft.trim()
    if (!text || sending) return

    setSending(true)
    setSendError(null)
    try {
      await onSendReply(text)
      // Cleared only after the server confirmed the reply.
      setDraft("")
      autoScrollRef.current = true
    } catch (error) {
      // Draft is preserved so the reply is never silently lost.
      setSendError(error instanceof Error ? error.message : "Failed to send reply")
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div
        data-pinetree-overlay="true"
        className="pinetree-modal-backdrop fixed inset-0 z-40"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-ticket-title"
        className="fixed inset-y-0 right-0 z-50 flex h-[100dvh] max-h-[100dvh] w-full flex-col bg-white shadow-2xl sm:w-[600px] lg:w-[680px]"
      >
        {/* ── Ticket header + status pills ──────────────────────────────────── */}
        <div className="flex-none border-b border-gray-100 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                Support Ticket
              </p>
              <h2
                id="admin-ticket-title"
                className="mt-1 text-base font-semibold leading-snug text-gray-900"
              >
                {ticket ? ticket.subject : "Loading ticket…"}
              </h2>
              {ticket && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Pill className={supportStatusPillClass(ticket.status)}>
                    {formatSupportStatus(ticket.status)}
                  </Pill>
                  <Pill className={supportPriorityPillClass(ticket.priority)}>
                    {formatSupportPriority(ticket.priority)}
                  </Pill>
                  <Pill className="border-gray-200 bg-gray-50 text-gray-600">
                    {formatSupportCategory(ticket.category)}
                  </Pill>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close ticket detail"
              className={modalCloseButtonClass}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* ── Merchant information / ticket details disclosure ──────────────── */}
        {ticket && (
          <div className="flex-none border-b border-gray-100 bg-gray-50/60">
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
              aria-controls="admin-ticket-details"
              className="flex w-full items-center justify-between gap-2 px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 transition hover:text-[#0052FF] focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 sm:px-6"
            >
              View Ticket Details
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={`shrink-0 transition-transform ${detailsOpen ? "rotate-180" : ""}`}
              />
            </button>
            {detailsOpen && (
              <div
                id="admin-ticket-details"
                className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-gray-100 bg-white px-5 py-3.5 text-xs sm:px-6"
              >
                <DetailRow label="Merchant Email" value={ticket.merchant_email || "—"} />
                <DetailRow label="Business Name" value={ticket.merchant_business_name || "—"} />
                <DetailRow label="Ticket ID" value={ticket.id} mono />
                <DetailRow label="Merchant ID" value={ticket.merchant_id} mono />
                <DetailRow label="Created" value={formatDate(ticket.created_at)} />
                <DetailRow
                  label="Last Response"
                  value={ticket.last_response_at ? formatDate(ticket.last_response_at) : "—"}
                />
                <DetailRow
                  label="Resolved"
                  value={ticket.resolved_at ? formatDate(ticket.resolved_at) : "—"}
                />
                <DetailRow
                  label="Archived"
                  value={ticket.archived_at ? formatDate(ticket.archived_at) : "—"}
                />
                <DetailRow
                  label="Related Payment"
                  value={ticket.related_payment_id || "—"}
                  mono
                />
              </div>
            )}
          </div>
        )}

        {/* ── Status workflow (the only status control in this panel) ───────── */}
        {ticket && (
          <div className="flex-none border-b border-gray-100 px-5 py-2.5 sm:px-6">
            <div
              role="group"
              aria-label="Set ticket status"
              className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {SUPPORT_TICKET_STATUSES.map((status) => {
                const active = ticket.status === status
                return (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onUpdateStatus(status)}
                    disabled={updatingStatus || active}
                    className={`${segmentedButtonClass(active, "compact")} disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {formatSupportStatus(status)}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Original ticket + conversation history (scrolls on its own) ───── */}
        <div
          ref={conversationRef}
          onScroll={handleConversationScroll}
          tabIndex={0}
          role="log"
          aria-label="Ticket conversation"
          aria-busy={loading}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-blue-100 sm:px-6"
        >
          {loading && (
            <div className="space-y-3">
              <div className="h-16 animate-pulse rounded-2xl bg-gray-100" />
              <div className="h-16 animate-pulse rounded-2xl bg-gray-100" />
            </div>
          )}

          {!loading && loadError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {loadError}
            </div>
          )}

          {!loading &&
            !loadError &&
            conversation.map((entry) => {
              const isSupport = entry.sender_type === "pinetree"
              const isSystem = entry.sender_type === "system"

              // The opening ticket renders as a labelled block rather than a
              // chat bubble, matching the panel's section-label language.
              if (entry.isOpeningMessage) {
                return (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-gray-100 bg-gray-50 p-4"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                        Original Ticket
                      </span>
                      <span className="shrink-0 text-xs text-gray-400">
                        {formatDateTime(entry.created_at)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-gray-700">{entry.message}</p>
                  </div>
                )
              }

              return (
                <div
                  key={entry.id}
                  className={`flex ${isSupport ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 ${
                      isSupport
                        ? "bg-[#0052FF] text-white"
                        : isSystem
                          ? "bg-gray-100 text-xs italic text-gray-500"
                          : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {!isSystem && (
                      <p
                        className={`mb-1 text-xs font-semibold ${
                          isSupport ? "text-blue-100" : "text-gray-500"
                        }`}
                      >
                        {formatSupportSenderLabel(entry.sender_type, entry.sender_name)}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap text-sm">{entry.message}</p>
                    <p
                      className={`mt-1.5 text-xs ${
                        isSupport ? "text-blue-200" : "text-gray-400"
                      }`}
                    >
                      {formatDateTime(entry.created_at)}
                    </p>
                  </div>
                </div>
              )
            })}

          {!loading && !loadError && ticket && conversation.length <= 1 && (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-6 text-center">
              <MessageSquare size={20} aria-hidden="true" className="text-gray-300" />
              <p className="text-sm text-gray-500">
                No replies yet. Your reply below is the first response the merchant sees.
              </p>
            </div>
          )}
        </div>

        {/* ── Reply box ────────────────────────────────────────────────────── */}
        {ticket && (
          <div className="flex-none border-t border-gray-200 bg-gray-50 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-3">
            <label
              htmlFor="admin-ticket-reply"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400"
            >
              Reply as PineTree Support
            </label>
            <textarea
              id="admin-ticket-reply"
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
              placeholder="Write your reply to the merchant…"
              className="min-h-[104px] w-full resize-none rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-50"
            />
            {sendError && (
              <p role="alert" className="mt-2 text-xs font-medium text-red-600">
                {sendError} — your reply was kept below.
              </p>
            )}
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <p className="hidden text-xs text-gray-400 sm:block">
                Sending moves the ticket to Waiting on Merchant unless you set another status.
              </p>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={sending || !draft.trim()}
                aria-label="Send reply"
                className={`${primaryActionButtonClass} w-full sm:w-auto`}
              >
                <Send size={14} aria-hidden="true" />
                {sending ? "Sending…" : "Send Reply"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
