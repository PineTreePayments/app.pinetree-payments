# PineTree React SDK

`@pinetreepayments/react` wraps `@pinetreepayments/js`. It does not add API
endpoints or payment behavior.

## Install

```bash
npm install @pinetreepayments/react
```

`@pinetreepayments/js` is installed as a dependency. React and React DOM are
peer dependencies.

## Provider

```tsx
import { PineTreeProvider } from "@pinetreepayments/react"

<PineTreeProvider publicKey="pk_live_...">
  <App />
</PineTreeProvider>
```

```tsx
<PineTreeProvider
  publicKey="pk_live_..."
  baseUrl="http://localhost:3000"
>
  <App />
</PineTreeProvider>
```

The provider memoizes one browser SDK client for its current `publicKey` and
`baseUrl`.

## Hook

```tsx
const pinetree = usePineTree()
```

Calling the hook outside `PineTreeProvider` throws a developer-facing error.

## Checkout Button

```tsx
<PineTreeCheckoutButton
  amount={1000}
  currency="USD"
  reference="order_123"
  rails={["base"]}
  mode="popup"
  onStart={() => console.log("Opening")}
  onOpen={(checkout) => console.log(checkout.sessionId)}
  onComplete={({ status }) => console.log(status)}
  onFailed={({ status }) => console.log(status)}
  onError={(error) => console.error(error)}
>
  Pay with PineTree
</PineTreeCheckoutButton>
```

The button supports all browser SDK checkout options plus `disabled`,
`className`, children, and lifecycle callbacks. It disables while opening and
resets its loading state after success or failure.

## Embedded Checkout

```tsx
<PineTreeCheckout
  amount={1000}
  currency="USD"
  rails={["base", "solana"]}
  onComplete={({ status }) => console.log(status)}
  onClosed={({ status }) => console.log(status)}
/>
```

The component renders a developer-owned container, opens the browser SDK in
embedded mode, and calls `destroy()` during unmount. The SDK-created iframe is
removed; the container remains.

## Exports

- `PineTreeProvider`
- `usePineTree`
- `PineTreeCheckoutButton`
- `PineTreeCheckout`
- Provider, hook, component, checkout, and lifecycle event types

## Safety

- Use only `pk_live_*` browser public keys.
- Never place `pt_live_*` merchant API keys or webhook secrets in React code.
- The package remains private and must not be published yet.

## Integration Testing

For a real local Next.js, embedded iframe, lifecycle event, and teardown
checklist, see
[React SDK integration testing](./react-sdk-integration-testing.md).
