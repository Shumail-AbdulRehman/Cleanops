# Persisted browser suite

Install exact dependencies in backend/frontend, generate the backend Prisma client, then install Chromium with `npm exec --prefix frontend -- playwright install chromium`. Node24 was used for the recorded run.

Create a dedicated local PostgreSQL16 bootstrap named `priv_e2e_test` with the local `fixture` role allowed to create disposable child databases and restore its own fixtures (the dedicated local bootstrap uses a superuser). Never point this suite at an application database. Run from the repository root, substituting the explicitly owned test port/user:

```sh
HYGENE_E2E_DATABASE_URL=postgresql://fixture@127.0.0.1:56442/priv_e2e_test npm run test:e2e --prefix frontend
```

The guard rejects absent, non-local, non-exact-name, production-mode and query-overridden targets before connecting. The runner creates a UUID-named child, applies all actual migrations, seeds synthetic company/site/role/history/review fixtures, compiles backend, browser tests and React, then starts real loopback API and built Vite servers on selected available ports. The harness never reuses existing servers, inherits production configuration or activates a provider. Individual transport faults and presentation seams are documented below. Vite builds and the managed preview both use envDir:false; the backend and unsafe-startup probe run from the fresh private directory, so checkout .env files are not loaded. Provider mirrors are synthetic SQL fixtures for local entitlement only. Each whole run uses a fresh database; cases run serially against it. Before each case, the shared fixture restores the snapshot produced by `seed.mjs`, including sequences. Trigger suppression exists only inside that private reset transaction; real API requests still enforce all database constraints. Still-valid real login sessions survive resets so setup does not exhaust the login rate limit. Case-specific data belongs in `beforeEach`, not a prior test or `beforeAll`. API setup login is real authentication; tests explicitly marked UI login/registration use React forms. Some authorization/refresh/QR checks use the actual API directly and are not claimed as UI actions.

The runner drops only its generated child and removes its private manifest/temp directory on completion/failure. An OS crash may require an operator to identify an abandoned generated child before cleanup; never reset an unknown database. Browser output under `.artifacts/` is ignored and private to the invoking user. Credential-bearing cases disable trace/video/screenshots; Playwright error-context snapshots may still include synthetic personal/account data. Do not upload raw artifacts, cookies or temporary manifests. Publish redacted results only.

Workspace redesign coverage is mapped below. Historical v5 filenames are retained so existing targeted commands keep working; selectors now use the current accessible controls. The v5 prototype's top-bar geometry, full-screen task drawer, hidden phone review queue and eager evidence placement are no longer application contracts. The task detail is an inline region, the phone review queue stays reachable, and protected evidence is loaded when its inspection enters view. Evidence writes stay under `frontend/e2e/.artifacts/`.

`e2e/playwright.config.ts` extends the existing frontend Playwright configuration and replaces only the preview launcher with the environment-file-free managed preview. It keeps one worker, zero retries, fresh local servers and the existing browser options. The database guards accept only `fixture@127.0.0.1:56442/priv_e2e_test` and the runner's UUID child; other ports, users, passwords and URL overrides are rejected.

The required ordinary frontend build can also run without opening environment files:

```sh
DOTENV_CONFIG_PATH=/dev/null NODE_OPTIONS="--import=$PWD/frontend/e2e/no-env.mjs" npm run build --prefix frontend
```

## Workspace redesign flow contract (spec 42)

All positive operational flows use the real React app, API and migrated disposable database. `workspace-flows.spec.ts` adds focused gaps; the existing files retain authentication, authorization, conflict, retry and history checks. Every case can run alone, for example:

```sh
npm run test:e2e --prefix frontend -- workspace-flows -g 'manager creation'
```

| Flow | Passing-test location / title |
|---|---|
| Owner and manager rail, review badge | `shell-v5`: owner and manager rail |
| Real company name in rail | `shell-v5`: owner and manager rail |
| New-company setup path without report filters | `workspace-flows`: new company lands on saved setup path |
| Overview period/location, figures and reload | `dashboard-v5`: performance period and location; `runtime-data`: company performance |
| Setup path destinations | `setup-v5`: exact linked forms; `workspace-flows`: new company |
| Hourly chart and by-location totals | `workspace-flows`: Today hourly figures (positive submissions, every hourly row, summary and site meters) |
| Task status filters and inline deep links | `v5-visual`: Today status filters |
| Task QR and required photo views | `workspace-flows`: task QR opens on demand |
| Save review decision, Reviewed, reload | `review`: persists manager closure; `workspace-flows`: performance issue |
| Required performance category/note | `workspace-flows`: performance issue requires category and note |
| Lazy attendance photos and zoom | `workspace-flows`: both attendance photos stay lazy, zoom reuses bytes and Escape restores focus; `lifecycle`: protected photo DTOs |
| Add/edit location persistence | `locations-v5`: phone Urdu location creation; owner edit persists |
| Area add/edit/archive | `workspace-flows`: area template can be added, edited and archived |
| Daytime and overnight cleaning schedule week | `workspace-flows`: cleaning schedule daytime / overnight |
| Valid staff import | `staff-import`: real XLSX/CSV and persisted onboarding |
| Create member then transfer with history | `workspace-flows`: add a team member then transfer; `workforce`: retains attendance/task history |
| One-use recovery code and clearing | `lifecycle`: staff recovery UI issues a one-use credential |
| Staff period/tab reload and record panel | `workspace-flows`: staff profile period; `workforce-v5`: profile tabs |
| Manager creation and taken locations | `workspace-flows`: manager creation disables taken locations |
| Settings sections and company save | `settings-v5`: organization/account/security; save conflict and refresh |
| Billing usage agrees with SQL/API | `billing-v5`: true capacity match SQL; `runtime-data`: Plan and Billing |
| Urdu RTL on each main screen | `v5-visual`: workspace main screens (24 routes × 2 languages × 2 widths) |
| 390px on each main screen | Same matrix; every route asserts document width and browser errors |

The lazy attendance-photo success case intercepts only protected storage delivery with a generated JPEG for check-in and check-out. While the photo modal is open, Radix keeps the underlying record mounted and hides it from assistive technology; Escape closes the photo before the record. Its metadata/context remain real API reads; separate real endpoint checks retain access denial and URL privacy coverage. The inherited review zoom cases explicitly intercept evidence metadata/bytes for presentation. Neither seam qualifies real storage, privacy screening or photo verification. No workspace test activates a billing provider.

The existing optional local-platform login case remains skipped unless explicitly enabled; workspace acceptance does not require that mode. Final executed counts, any numbered application-fix handoffs and verification limits are recorded in `specs-workspace-redesign/42-e2e-suite.md` and its inventory fragment.

## Billing onboarding coverage (spec62)

Billing screens now live outside the operational layout. `sandbox-onboarding.spec.ts` uses real signup/session plus an explicitly intercepted provider boundary. `billing-onboarding.spec.ts` covers plan/payment/confirmation/recovery, isolated SDK events, portal URLs, role changes and responsive EN/UR states. `billing-v5.spec.ts` retains real API/SQL lifecycle, counts, status/window absence, suspension and owner security checks; its obsolete monolithic markup/reference comparisons were replaced by behavioral assertions. `customer-auth-v5.spec.ts` recognizes the standalone signup shell; unrelated auth remains on its incumbent design.

`mockBilling` in fixtures.ts intercepts only named billing endpoints and the official SDK script, with valid synthetic DTO IDs and an initialized callback-capable overlay fixture. It is not card processing or signed provider delivery. Real stored reservation/entitlement behavior is separately proved by SQL60. No production flag/token/env values are inherited; the managed app still defaults to PADDLE_BILLING_ENABLED=false. Browser fixture output cannot satisfy deployed acceptance63.

The33 flow mapping and final command counts belong to specs-billing-onboarding/inventory/62-billing-e2e-suite.md. The operator-run Netlify same-origin cookie and real Paddle acceptance remain separately pending in the final verification report.
