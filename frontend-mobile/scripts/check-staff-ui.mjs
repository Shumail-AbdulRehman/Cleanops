// The browser layout check moved into the Playwright suite (spec 52 of the staff app redesign):
//   npm run test:e2e --prefix frontend-mobile
// It builds the web export, serves it on a free loopback port and answers every API call from
// fixtures in e2e-web/fixtures/. Camera, QR and GPS stay device tests (e2e/README.md).
console.error('scripts/check-staff-ui.mjs was replaced by `npm run test:e2e`. Run that instead.');
process.exit(1);
