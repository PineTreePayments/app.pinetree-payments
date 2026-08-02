# Shift4 feature flags

All values are server-side and default to `false`. None uses a `NEXT_PUBLIC_` name.

| Variable | Purpose | Additional requirements |
| --- | --- | --- |
| `SHIFT4_REST_ENABLED` | Enables the internal REST application boundary | Authenticated merchant connection |
| `SHIFT4_ECOMMERCE_ENABLED` | Enables e-commerce capability | Certification, REST, environment permission |
| `SHIFT4_RETAIL_ENABLED` | Enables retail capability | Certification and online registered terminal |
| `SHIFT4_CERTIFICATION_MODE` | Enables internal certification-only surfaces | Never implies processing readiness |
| `SHIFT4_MANUAL_AUTH_ENABLED` | Enables certified referral/manual authorization | Certification mode and referral lineage |
| `SHIFT4_PARTIAL_APPROVAL_ENABLED` | Declares partial-approval capability | Channel and certification gates |
| `SHIFT4_SPLIT_TENDER_ENABLED` | Permits an explicitly marked additional tender | Exact database-derived remainder |
| `SHIFT4_APPLE_PAY_ENABLED` | Declares Apple Pay capability | Official i4Go configuration and certification |
| `SHIFT4_GOOGLE_PAY_ENABLED` | Declares Google Pay capability | Official i4Go configuration and certification |
| `SHIFT4_PRODUCTION_ENABLED` | Permits a production connection to become ready | Recorded certification and all channel prerequisites |

i4Go additionally requires official administrator-provided `SHIFT4_I4GO_SCRIPT_URL`, `SHIFT4_I4GO_IFRAME_ORIGIN`, and `SHIFT4_I4GO_APPLICATION_ID`. URLs must be HTTPS. Missing values block tokenization; PineTree does not supply defaults.

The certification CLI live-mode prerequisites are `SHIFT4_ENVIRONMENT=test`, `SHIFT4_CERTIFICATION_MODE=true`, a test-only `SHIFT4_CERTIFICATION_ACCESS_TOKEN`, and the command-line acknowledgement `--confirm-test-environment`. Even with those values, live execution remains blocked until official missing wire contracts and analyst authorization are supplied.
`SHIFT4_ONBOARDING_REQUIRED` makes provider approval a production prerequisite for merchants whose Shift4 program requires underwriting. `SHIFT4_COMMERCE_ENGINE_CONFIGURED` records that the reviewed Commerce Engine contract/configuration is present; it is not inferred from a registered reader. Both default to false.

`SHIFT4_I4GO_SCRIPT_URL`, `SHIFT4_I4GO_IFRAME_ORIGIN`, and `SHIFT4_I4GO_APPLICATION_ID` are server-read configuration inputs. Hosted checkout and tokenization remain blocked unless all three are valid and centralized readiness also passes REST, onboarding (when required), certification, environment, and explicit enablement gates.

The admin fixture dashboard does not alter these gates. Certification fixture mode supplies isolated synthetic states to the Engine and UI; it never changes merchant readiness, selects production, or makes a provider request.
