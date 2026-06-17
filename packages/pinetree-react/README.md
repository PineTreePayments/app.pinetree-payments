# @pinetreepayments/react

Official PineTree React SDK — browser checkout components and hooks.

---

## Installation

```bash
npm install @pinetreepayments/react
```

The React SDK installs `@pinetreepayments/js` as a dependency.

---

## API key

This package uses a browser-safe **public key** (`pk_live_*`). Public keys
are safe to include in client-side React code and `NEXT_PUBLIC_` environment
variables.

**Never** pass a server API key (`pt_live_*`) to `PineTreeProvider` or any
React component. Server keys grant full merchant access and must stay on the
server. Use `@pinetreepayments/node` for server-side operations.

---

## Provider

```tsx
import { PineTreeProvider } from "@pinetreepayments/react"

export function App() {
  return (
    <PineTreeProvider publicKey={process.env.NEXT_PUBLIC_PINETREE_PUBLIC_KEY!}>
      <CheckoutPage />
    </PineTreeProvider>
  )
}
```

Local development can override the API origin:

```tsx
<PineTreeProvider
  publicKey="pk_live_..."
  baseUrl="http://localhost:3000"
>
  <App />
</PineTreeProvider>
```

---

## Checkout Button

```tsx
<PineTreeCheckoutButton
  amount={1000}
  currency="USD"
  mode="popup"
  onComplete={({ status }) => console.log(status)}
  onError={(error) => console.error(error)}
>
  Pay with PineTree
</PineTreeCheckoutButton>
```

The button disables itself while checkout is opening and wires all browser SDK
lifecycle events to typed callbacks: `onComplete`, `onFailed`, `onExpired`,
`onCanceled`, `onError`, `onClosed`.

---

## Embedded Checkout

```tsx
<PineTreeCheckout
  amount={1000}
  currency="USD"
  rails={["base", "solana"]}
  onComplete={({ status }) => console.log(status)}
/>
```

`rails` restricts network rails. Use `["solana"]` to offer SOL on Solana and
USDC on Solana; use `["base"]` to offer ETH on Base and USDC on Base.

`PineTreeCheckout` owns the iframe it creates. It destroys the browser SDK
checkout instance and removes the iframe when unmounted.

---

## Hook

```tsx
const pinetree = usePineTree()
```

`usePineTree()` must be called below `PineTreeProvider`. Returns the
underlying `@pinetreepayments/js` client for direct use.

---

## Development

```bash
# Build @pinetreepayments/js first (required peer)
npm run build --workspace packages/pinetree-js

# Type-check @pinetreepayments/react
npm run typecheck --workspace packages/pinetree-react

# Build @pinetreepayments/react
npm run build --workspace packages/pinetree-react

# Tests
npm test --workspace packages/pinetree-react
```

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
