# SDKs

PineTree publishes SDKs for server, browser, and React integrations.

| SDK | Package | Use |
|---|---|---|
| Node SDK | `@pinetreepayments/node` | Server REST API calls and webhook verification. |
| JavaScript SDK | `@pinetreepayments/js` | Browser checkout creation/opening with public keys. |
| React SDK | `@pinetreepayments/react` | React checkout button and embedded checkout components. |

See:

- [Node SDK](./node-sdk.md)
- [Browser SDK](./browser-sdk.md)
- [React SDK](./react-sdk.md)

The Node SDK includes `pinetree.webhooks.constructEvent(...)`, which verifies PineTree webhook signatures against the raw request body.
