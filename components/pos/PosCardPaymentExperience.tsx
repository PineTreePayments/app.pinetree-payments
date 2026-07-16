"use client"

import { useState } from "react"
import {
  Check,
  ChevronLeft,
  CircleAlert,
  Contactless,
  CreditCard,
  ExternalLink,
  Link2,
  LoaderCircle,
  Plus,
  Radio,
  RefreshCw,
  Smartphone,
} from "lucide-react"
import Button from "@/components/ui/Button"
import { StripeCardPayment } from "@/components/payment/StripeCardPayment"

export type PosCardReader = {
  id: string
  label: string
  status: "online" | "offline" | "busy" | "unknown"
  isDefault: boolean
  simulated: boolean
}

export type PosCardCapabilities = {
  terminalReaders: PosCardReader[]
  tapToPay: { available: boolean; reason: string }
  manualEntryEnabled: boolean
  recommendedMethod: "terminal_reader" | "tap_to_pay" | "manual_entry" | "payment_link" | null
}

export type PosCardView =
  | "loading"
  | "collect"
  | "no-reader"
  | "waiting"
  | "manual"
  | "processing"
  | "approved"
  | "declined"
  | "register"
  | "payment-link"

type Props = {
  amount: string
  view: PosCardView
  capabilities: PosCardCapabilities | null
  selectedReaderId: string
  loading: boolean
  error: string
  paymentLink: string
  paymentId: string
  manualClientSecret: string
  manualStripeAccountId: string
  manualReturnUrl: string
  onSelectReader: (readerId: string) => void
  onSendToReader: () => void
  onRefreshReaders: () => void
  onOpenRegister: () => void
  onRegisterReader: (registrationCode: string, label: string) => Promise<void>
  onOpenManual: () => void
  onManualSuccess: () => void
  onManualError: (message: string) => void
  onSendPaymentLink: () => void
  onTryAgain: () => void
  onBack: () => void
  onCancel: () => void
  onDone: () => void
  onViewReceipt: () => void
}

function Amount({ children }: { children: string }) {
  return <p className="mt-2 text-4xl font-bold tracking-[-0.04em] text-[#0B1F3A]">{children}</p>
}

function StatusMark({ kind }: { kind: "waiting" | "processing" | "approved" | "declined" }) {
  const config = {
    waiting: { className: "bg-blue-100 text-[#1652f0]", icon: <Contactless className="h-8 w-8" /> },
    processing: { className: "bg-blue-100 text-[#1652f0]", icon: <LoaderCircle className="h-8 w-8 animate-spin" /> },
    approved: { className: "bg-emerald-100 text-emerald-700", icon: <Check className="h-8 w-8" /> },
    declined: { className: "bg-red-100 text-red-600", icon: <CircleAlert className="h-8 w-8" /> },
  }[kind]
  return <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${config.className}`}>{config.icon}</div>
}

export default function PosCardPaymentExperience(props: Props) {
  const [registrationCode, setRegistrationCode] = useState("")
  const [readerLabel, setReaderLabel] = useState("Front Counter Reader")
  const onlineReaders = props.capabilities?.terminalReaders.filter((reader) => reader.status === "online") ?? []
  const selectedReader = onlineReaders.find((reader) => reader.id === props.selectedReaderId) ?? onlineReaders[0]

  if (props.view === "loading") {
    return (
      <section className="py-12 text-center" aria-live="polite">
        <LoaderCircle className="mx-auto h-9 w-9 animate-spin text-[#1652f0]" />
        <h1 className="mt-5 text-xl font-bold text-[#0B1F3A]">Checking Stripe Card Readers</h1>
        <p className="mt-2 text-sm text-slate-500">Finding readers connected to this business.</p>
      </section>
    )
  }

  if (props.view === "collect" && selectedReader) {
    return (
      <section className="space-y-6">
        <header className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1652f0]">Collect Card Payment</p>
          <Amount>{props.amount}</Amount>
        </header>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Recommended</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Online and ready
            </span>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-[0_12px_36px_rgba(15,55,95,0.09)] ring-1 ring-blue-100/70">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-[#1652f0]"><CreditCard className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-[#0B1F3A]">{selectedReader.label}</p>
                <p className="text-sm text-slate-500">Stripe Card Reader</p>
              </div>
            </div>
            {onlineReaders.length > 1 && (
              <div className="mt-4 grid gap-2" aria-label="Choose a Stripe Card Reader">
                {onlineReaders.map((reader) => (
                  <button key={reader.id} type="button" onClick={() => props.onSelectReader(reader.id)} className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${reader.id === selectedReader.id ? "bg-blue-50 font-semibold text-[#1652f0]" : "bg-slate-50 text-slate-700"}`}>
                    <span>{reader.label}</span><Radio className="h-4 w-4" />
                  </button>
                ))}
              </div>
            )}
            <Button className="mt-4 h-12 rounded-xl text-base" fullWidth disabled={props.loading} onClick={props.onSendToReader}>
              {props.loading ? "Sending…" : "Send to Reader"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Other ways to collect</p>
          {props.capabilities?.tapToPay.available && (
            <Button variant="secondary" fullWidth className="h-11 justify-start rounded-xl" onClick={() => undefined}><Smartphone className="mr-2 h-4 w-4" />Tap to Pay on this device</Button>
          )}
          {props.capabilities?.manualEntryEnabled && (
            <Button variant="secondary" fullWidth className="h-11 justify-start rounded-xl" onClick={props.onOpenManual}><CreditCard className="mr-2 h-4 w-4" />Enter Card Manually</Button>
          )}
          <Button variant="secondary" fullWidth className="h-11 justify-start rounded-xl" onClick={props.onSendPaymentLink}><Link2 className="mr-2 h-4 w-4" />Send Payment Link</Button>
        </div>
        <Button variant="secondary" fullWidth className="border-0 bg-transparent shadow-none" onClick={props.onCancel}>Cancel</Button>
        {props.error && <p className="text-center text-sm text-red-600" role="alert">{props.error}</p>}
      </section>
    )
  }

  if (props.view === "no-reader") {
    return (
      <section className="space-y-5 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-[#1652f0]"><CreditCard className="h-7 w-7" /></div>
        <div><h1 className="text-2xl font-bold text-[#0B1F3A]">No Stripe Card Reader Connected</h1><p className="mt-2 text-sm leading-6 text-slate-600">Connect a reader or choose another way to collect payment.</p></div>
        <div className="space-y-2 text-left">
          <Button fullWidth className="h-11 rounded-xl" disabled={props.loading} onClick={props.onRefreshReaders}><RefreshCw className={`mr-2 h-4 w-4 ${props.loading ? "animate-spin" : ""}`} />Refresh Readers</Button>
          <Button variant="secondary" fullWidth className="h-11 justify-start rounded-xl" onClick={props.onOpenRegister}><Plus className="mr-2 h-4 w-4" />Register Reader</Button>
          {props.capabilities?.manualEntryEnabled && <Button variant="secondary" fullWidth className="h-11 justify-start rounded-xl" onClick={props.onOpenManual}><CreditCard className="mr-2 h-4 w-4" />Enter Card Manually</Button>}
          <Button variant="secondary" fullWidth className="h-11 justify-start rounded-xl" onClick={props.onSendPaymentLink}><Link2 className="mr-2 h-4 w-4" />Send Payment Link</Button>
        </div>
        <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-slate-600">Tap to Pay requires the PineTree mobile app.</p>
        {props.error && <p className="text-sm text-red-600" role="alert">{props.error}</p>}
        <Button variant="secondary" fullWidth className="border-0 bg-transparent shadow-none" onClick={props.onCancel}>Cancel</Button>
      </section>
    )
  }

  if (props.view === "waiting") {
    return <section className="space-y-6 py-4 text-center"><StatusMark kind="waiting" /><div><h1 className="text-2xl font-bold text-[#0B1F3A]">Waiting for Customer</h1><Amount>{props.amount}</Amount><p className="mt-4 font-semibold text-slate-700">{selectedReader?.label || "Stripe Card Reader"}</p><p className="mt-1 text-sm text-slate-500">Tap, insert, or swipe card</p></div><div className="flex justify-center gap-1.5" aria-hidden="true"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#1652f0]" /><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#1652f0] [animation-delay:150ms]" /><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#1652f0] [animation-delay:300ms]" /></div>{props.error && <p className="text-sm text-red-600" role="alert">{props.error}</p>}<Button variant="danger" fullWidth className="h-11 rounded-xl" disabled={props.loading} onClick={props.onCancel}>Cancel Payment</Button></section>
  }

  if (props.view === "processing") {
    return <section className="space-y-5 py-12 text-center"><StatusMark kind="processing" /><div><h1 className="text-2xl font-bold text-[#0B1F3A]">Processing Payment</h1><p className="mt-2 text-sm text-slate-500">Keep the card near the reader.</p></div></section>
  }

  if (props.view === "approved") {
    return <section className="space-y-6 py-6 text-center"><StatusMark kind="approved" /><div><h1 className="text-2xl font-bold text-[#0B1F3A]">Payment Approved</h1><Amount>{props.amount}</Amount></div><div className="space-y-2"><Button fullWidth className="h-11 rounded-xl" onClick={props.onDone}>Done</Button><Button variant="secondary" fullWidth className="h-11 rounded-xl" disabled={!props.paymentId} onClick={props.onViewReceipt}>View Receipt</Button></div></section>
  }

  if (props.view === "declined") {
    return <section className="space-y-6 py-5 text-center"><StatusMark kind="declined" /><div><h1 className="text-2xl font-bold text-[#0B1F3A]">Payment Declined</h1><p className="mt-2 text-sm text-slate-500">Try again or choose another payment method.</p></div>{props.error && <p className="text-sm text-red-600" role="alert">{props.error}</p>}<div className="space-y-2"><Button fullWidth className="h-11 rounded-xl" onClick={props.onTryAgain}>Try Again</Button>{props.capabilities?.manualEntryEnabled && <Button variant="secondary" fullWidth className="h-11 rounded-xl" onClick={props.onOpenManual}>Enter Card Manually</Button>}<Button variant="secondary" fullWidth className="border-0 bg-transparent shadow-none" onClick={props.onCancel}>Cancel</Button></div></section>
  }

  if (props.view === "manual") {
    return (
      <section className="space-y-5">
        <button type="button" onClick={props.onBack} className="inline-flex items-center text-sm font-semibold text-slate-600"><ChevronLeft className="mr-1 h-4 w-4" />Back</button>
        <header className="text-center"><h1 className="text-2xl font-bold text-[#0B1F3A]">Enter Card Details</h1><Amount>{props.amount}</Amount></header>
        <div className="rounded-2xl bg-white p-4 shadow-[0_12px_36px_rgba(15,55,95,0.09)] ring-1 ring-blue-100/70">
          {props.manualClientSecret && props.manualStripeAccountId ? <StripeCardPayment clientSecret={props.manualClientSecret} stripeAccountId={props.manualStripeAccountId} returnUrl={props.manualReturnUrl} submitLabel={`Pay ${props.amount}`} showReadyStatus={false} onSuccess={props.onManualSuccess} onError={props.onManualError} /> : <div className="py-10 text-center"><LoaderCircle className="mx-auto h-7 w-7 animate-spin text-[#1652f0]" /><p className="mt-3 text-sm text-slate-500">Preparing secure card entry…</p></div>}
        </div>
        <p className="text-center text-sm text-slate-500">This is manual card entry.</p>
        {props.error && <p className="text-center text-sm text-red-600" role="alert">{props.error}</p>}
      </section>
    )
  }

  if (props.view === "register") {
    return (
      <section className="space-y-5">
        <button type="button" onClick={props.onBack} className="inline-flex items-center text-sm font-semibold text-slate-600"><ChevronLeft className="mr-1 h-4 w-4" />Back</button>
        <div className="text-center"><h1 className="text-2xl font-bold text-[#0B1F3A]">Register Stripe Card Reader</h1><p className="mt-2 text-sm text-slate-500">Enter the registration code shown on the reader.</p></div>
        <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-blue-100/70">
          <label className="block text-sm font-semibold text-slate-700">Reader name<input value={readerLabel} onChange={(event) => setReaderLabel(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-[#1652f0]" /></label>
          <label className="block text-sm font-semibold text-slate-700">Registration code<input value={registrationCode} onChange={(event) => setRegistrationCode(event.target.value)} placeholder="word-word-word" autoCapitalize="none" className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-[#1652f0]" /></label>
          <Button fullWidth className="h-11 rounded-xl" disabled={props.loading || !registrationCode.trim() || !readerLabel.trim()} onClick={() => void props.onRegisterReader(registrationCode.trim(), readerLabel.trim())}>{props.loading ? "Registering…" : "Register Reader"}</Button>
        </div>
        {props.error && <p className="text-center text-sm text-red-600" role="alert">{props.error}</p>}
      </section>
    )
  }

  return (
    <section className="space-y-5 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-[#1652f0]"><Link2 className="h-7 w-7" /></div>
      <div><h1 className="text-2xl font-bold text-[#0B1F3A]">Send Payment Link</h1><p className="mt-2 text-sm text-slate-500">Share this secure link with the customer.</p></div>
      {props.paymentLink ? <a href={props.paymentLink} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 text-left text-sm font-semibold text-[#1652f0] ring-1 ring-blue-100"><span className="truncate">{props.paymentLink}</span><ExternalLink className="h-4 w-4 shrink-0" /></a> : <div className="py-5"><LoaderCircle className="mx-auto h-7 w-7 animate-spin text-[#1652f0]" /></div>}
      {props.error && <p className="text-sm text-red-600" role="alert">{props.error}</p>}
      <Button variant="secondary" fullWidth className="h-11 rounded-xl" onClick={props.onBack}>Back to Card Options</Button>
    </section>
  )
}
