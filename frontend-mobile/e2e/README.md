# Physical Android flows (Maestro)

These are **unexecuted** Maestro flows. The phone sign-in labels were updated for staff OTP Spec 15 on 2026-11-21. Physical-device execution and real photo processing remain unverified.

The browser Playwright suite (`npm run test:e2e`, files in `e2e-web/`) uses fixture responses. The Maestro cases cover a session restart after SMS sign-in, permission denial and phone alerts on Android.

| Flow | What it proves | Labels it relies on |
|---|---|---|
| `01-login-restart.yaml` | A session from phone sign-in survives an app restart | "Staff sign in", "Phone number", "Send code", "6-digit code", "Sign in", "My day" |
| `03-denied-permissions.yaml` | Denied camera and location never record a check-in | "My day", "Check in", "Camera is needed", "Open settings", "Cancel" |
| `04-help-and-alerts.yaml` | Task alerts retry gives real feedback; Help opens from Profile | "Profile", "My details", "Task alerts", "Permissions", "Retry phone alerts", "Help", "Back" |

Use an approved signed test APK and physical Android device, a dedicated non-production API reachable from the phone, and isolated staff, shift and task fixtures. Set the approved API address through "Show connection settings" before signing in. The first flow also needs a fixture staff phone approved to receive an SMS.

Supply the package as `APP_ID` and the fixture number as `E2E_PHONE` locally. While Maestro waits for "My day", enter the received code and tap "Sign in" by hand. Keep credential screenshots, video and traces out of the run, including failure artifacts. Record only redacted case, device and build results. Set `E2E_EXPECTED_ALERT_RESULT` to the observed phone alert registration outcome for flow 04.

Device verification also remains open for the task QR and required photos, the phone upload queue, force-kill and lost-response reconciliation, SMS code replay denial, permission retry, notification navigation, session renewal, Urdu and right-to-left layout, and install, update and signature checks.

Syntax references (checked 2026-10-21): https://docs.maestro.dev/maestro-flows/flow-control-and-logic/permissions and https://docs.maestro.dev/reference/commands-available/runflow. Parsing the YAML does not validate Maestro commands or selectors on a device.
