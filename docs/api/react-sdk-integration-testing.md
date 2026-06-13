# PineTree React SDK Integration Testing

`@pinetree/react` is a private, unpublished package. These smoke checks exercise
the local React package against a real local PineTree app without using merchant
secret keys in the browser.

## Local Setup

1. Apply all migrations and start the PineTree app at
   `http://localhost:3000`.
2. Create a local merchant public key from **Dashboard > Developer > Public
   Keys** or `POST /api/merchant/public-keys`.
3. Store it in an uncommitted local environment variable:

```powershell
$env:NEXT_PUBLIC_PINETREE_PUBLIC_KEY = "pk_live_local_value"
```

Never use `pt_live_*` keys or webhook secrets in React code.

## Next.js Smoke Component

```tsx
"use client"

import {
  PineTreeCheckoutButton,
  PineTreeProvider,
} from "@pinetree/react"

export function PineTreeSmokeTest() {
  return (
    <PineTreeProvider
      publicKey={process.env.NEXT_PUBLIC_PINETREE_PUBLIC_KEY!}
      baseUrl="http://localhost:3000"
    >
      <PineTreeCheckoutButton
        amount={100}
        currency="USD"
        mode="popup"
        reference={`react-smoke-${Date.now()}`}
        onOpen={(checkout) => console.log("opened", checkout.sessionId)}
        onComplete={(event) => console.log("complete", event.status)}
        onFailed={(event) => console.log("failed", event.status)}
        onExpired={(event) => console.log("expired", event.status)}
        onCanceled={(event) => console.log("canceled", event.status)}
        onClosed={(event) => console.log("closed", event.status)}
        onError={(error) => console.error("checkout error", error)}
      >
        Open PineTree checkout
      </PineTreeCheckoutButton>
    </PineTreeProvider>
  )
}
```

Confirm the popup opens, the button is disabled while opening, and no merchant
secret appears in the browser bundle or network request.

## Embedded Mode

```tsx
"use client"

import { PineTreeCheckout, PineTreeProvider } from "@pinetree/react"

export function EmbeddedPineTreeSmokeTest() {
  return (
    <PineTreeProvider
      publicKey={process.env.NEXT_PUBLIC_PINETREE_PUBLIC_KEY!}
      baseUrl="http://localhost:3000"
    >
      <PineTreeCheckout
        amount={100}
        currency="USD"
        reference={`react-embed-${Date.now()}`}
        onComplete={({ sessionId, status }) =>
          console.log("complete", sessionId, status)
        }
        onClosed={({ sessionId }) => console.log("closed", sessionId)}
      />
    </PineTreeProvider>
  )
}
```

Confirm exactly one iframe is appended to the component container. Navigating
away or unmounting the component must remove that iframe.

## Lifecycle Event Validation

For popup and embedded modes:

1. Register callbacks before interacting with hosted checkout.
2. Complete, fail, expire, cancel, or close a local checkout as supported by the
   test state.
3. Confirm the callback has the expected session ID and public status.
4. Confirm no callback fires for a message from another origin, another session,
   an unknown event, or an unsupported message version.
5. Unmount the component and confirm subsequent postMessage events are ignored.

Lifecycle callbacks receive only browser-safe checkout fields. They do not
receive metadata, wallet addresses, provider payloads, or API keys.

## Teardown

- Unmount the smoke component so `destroy()` removes message listeners and
  closes/removes SDK-owned checkout surfaces.
- Disable the local `pk_live_*` key after validation.
- Remove `NEXT_PUBLIC_PINETREE_PUBLIC_KEY` from the shell.
- Stop the local server when the full stack checklist is complete.
- Never commit local keys, checkout URLs, screenshots containing tokens, or
  captured postMessage payloads with unreviewed data.

See [Local stack release validation](./local-stack-release-validation.md) for
the Node SDK and `/api/v1` portions of the release candidate.
