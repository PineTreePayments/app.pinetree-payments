// Consumer validation for @pinetree/react
// Typechecked against dist/types — verifies all documented exports compile.
import type { ReactNode } from "react"
import {
  PineTreeProvider,
  PineTreeCheckout,
  PineTreeCheckoutButton,
  usePineTree,
} from "@pinetree/react"
import type {
  PineTreeProviderProps,
  PineTreeCheckoutButtonProps,
  PineTreeCheckoutProps,
  CheckoutEvent,
  CheckoutEventName,
  CheckoutMode,
  CheckoutOpenResult,
} from "@pinetree/react"

function AppWrapper({ children }: { children: ReactNode }) {
  const _providerProps: PineTreeProviderProps = {
    publicKey: "pk_live_test",
    baseUrl: "http://localhost:3000",
  }
  return (
    <PineTreeProvider publicKey="pk_live_test" baseUrl="http://localhost:3000">
      {children}
    </PineTreeProvider>
  )
}

function HookConsumer() {
  const pinetree = usePineTree()
  void pinetree.checkout.open
  return null
}

function ButtonConsumer() {
  const _mode: CheckoutMode = "popup"
  const _props: PineTreeCheckoutButtonProps = {
    amount: 2500,
    currency: "USD",
    mode: "popup",
    onComplete: (event: CheckoutEvent) => void event.status,
    onFailed: (event: CheckoutEvent) => void event.status,
    onError: (err: unknown) => console.error(err),
  }
  const _eventName: CheckoutEventName = "complete"
  return (
    <PineTreeCheckoutButton
      amount={2500}
      currency="USD"
      mode="popup"
      onComplete={({ status }) => console.log(status)}
      onFailed={({ status }) => console.log(status)}
      onExpired={({ status }) => console.log(status)}
      onCanceled={({ status }) => console.log(status)}
      onClosed={({ status }) => console.log(status)}
      onError={(err) => console.error(err)}
      disabled={false}
      className="pay-btn"
    >
      Pay with PineTree
    </PineTreeCheckoutButton>
  )
}

function EmbeddedConsumer() {
  const _props: PineTreeCheckoutProps = {
    amount: 2500,
    currency: "USD",
    rails: ["base", "solana"],
    onComplete: ({ status }) => console.log(status),
    onClosed: ({ status }) => console.log(status),
  }
  return (
    <PineTreeCheckout
      amount={2500}
      currency="USD"
      rails={["base", "solana"]}
      onComplete={({ status }) => console.log(status)}
      className="checkout-embed"
    />
  )
}

const _onOpenCallback = (checkout: CheckoutOpenResult) => {
  void checkout.sessionId
  void checkout.checkoutUrl
  checkout.destroy()
}

export { AppWrapper, HookConsumer, ButtonConsumer, EmbeddedConsumer }
