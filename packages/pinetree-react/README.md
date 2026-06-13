# @pinetree/react

Private React bindings for `@pinetree/js`.

**Status:** Private Beta / Preview  
**Published:** No  
**Usage:** Local package only

## Provider

```tsx
import { PineTreeProvider } from "@pinetree/react"

export function App() {
  return (
    <PineTreeProvider publicKey="pk_live_...">
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

Only browser-safe public keys belong in React applications. Never expose a
merchant API key or webhook secret.

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
lifecycle events to typed callbacks.

## Embedded Checkout

```tsx
<PineTreeCheckout
  amount={1000}
  currency="USD"
  rails={["base", "solana"]}
  onComplete={({ status }) => console.log(status)}
/>
```

`PineTreeCheckout` owns the iframe it creates. It destroys the browser SDK
checkout instance and removes the iframe when unmounted.

## Hook

```tsx
const pinetree = usePineTree()
```

`usePineTree()` must be called below `PineTreeProvider`.

## Development

```bash
npm run build --prefix packages/pinetree-js
npm run typecheck --prefix packages/pinetree-react
npm run build --prefix packages/pinetree-react
npm test --prefix packages/pinetree-react
```
