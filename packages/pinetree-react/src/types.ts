import type { ButtonHTMLAttributes, ReactNode } from "react"
import type {
  CheckoutEventHandler,
  CheckoutMode,
  CheckoutOpenResult,
  CheckoutOptions,
} from "@pinetree/js"

export type CheckoutLifecycleCallbacks = {
  onStart?: () => void
  onOpen?: (checkout: CheckoutOpenResult) => void
  onComplete?: CheckoutEventHandler
  onFailed?: CheckoutEventHandler
  onExpired?: CheckoutEventHandler
  onCanceled?: CheckoutEventHandler
  onClosed?: CheckoutEventHandler
  onError?: (error: unknown) => void
}

export type PineTreeCheckoutBaseProps = Omit<
  CheckoutOptions,
  "mode" | "container"
> &
  CheckoutLifecycleCallbacks & {
    mode?: CheckoutMode
    container?: string | HTMLElement
  }

export type PineTreeCheckoutButtonProps = PineTreeCheckoutBaseProps &
  Pick<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "disabled" | "className" | "type"
  > & {
    children?: ReactNode
  }

export type PineTreeCheckoutProps = Omit<
  PineTreeCheckoutBaseProps,
  "mode" | "container" | "redirect"
> & {
  mode?: "embedded"
  className?: string
}
