# Owner billing sandbox release

Updated 2026-11-10. The current procedure is [SaaS onboarding sandbox release runbook](../docs/implementation/saas-onboarding-runbook.md). It supersedes the historical overlay/trial repair procedure previously in this file. A procedure is not evidence of a deployed/provider pass.

New owner purchases use Paddle's inline card frame and have **no free trial**. The catalog comes from `PADDLE_PRICE_CATALOG_JSON`; the six sandbox IDs live in `config/paddle-sandbox-catalog.json`. Prices with provider trials are unavailable for new purchases. Existing historical `trialing` subscriptions retain their access policy.

From repository root, `node --experimental-strip-types scripts/billing-flow-preflight.mjs` checks supplied sandbox configuration offline and prints names/statuses only. It never implicitly loads private dotenv files, calls Paddle or accesses a database. See the runbook for explicit env-file usage, Netlify/Heroku variables, proxy-hop qualification, default payment link and signed webhook destination.

For a separately authorized provider session, run `npx tsx scripts/removePaddleTrials.ts` from `backend` for a read-only preview. Only `--apply` enables writes; each attempted update is read back and must finish `REMOVED` or `ALREADY_CLEAR`. Rerun preview to verify all six prices clear. Preview itself contacts real Paddle; neither command belongs in offline/unit verification. Never infer current price/trial state from historical documentation.

Publish additive backend before the matching frontend. Verify same-sandbox configuration, browser sessions, signed delivery and owner-scoped server confirmation separately. On localhost, webhooks can remain directed to Heroku while the local server confirms its own saved transaction directly with Paddle and invokes shared fulfilment. Only server-verified facts grant workspace access. Use an isolated local test database for runtime checks, never an application database.

Preserve uncertain reservations, account restrictions and append-only audits. Never clear holds, recreate customers/accounts, run migrations or grant access manually. Existing subscribers retain their billing page/portal. Mobile icons require a new APK build. Docker Compose lacks Paddle configuration and is not the release path. Detailed release and rollback steps are in the linked runbook.
