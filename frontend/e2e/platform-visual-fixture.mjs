/** Synthetic network fixture for platform-visual.mjs, never a provider adapter. */
export const inquiryId = '00000000-0000-4000-8000-000000000001';
const stamp = '2026-10-29T06:00:00.000Z';
const clone = value => structuredClone(value);

export function createPlatformFixture() {
  let state;
  const held = [];
  function reset(scenario = 'ready') {
    while (held.length) held.shift()();
    const company = { id: 42, name: 'Synthetic Facilities', plan: 'PRO', isActive: true, operationalStatus: 'ACTIVE', accountVersion: 3, createdAt: '2026-10-01T09:00:00.000Z', updatedAt: stamp };
    const handling = { version: 0, status: 'NEW', owner: null, updatedAt: null };
    state = { scenario, requests: [], changes: 0, patches: 0, supportReads: 0, supportFailure: false,
      company: { company: { ...company, suspendedAt: null, suspensionReason: null }, operationalReadAllowed: true, billingConfigured: false, mirroredSubscriptionStatus: 'ACTIVE', providerState: 'LINKED', subscription: { status: 'ACTIVE', plan: 'PRO', catalogQualified: false, periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z', canceledAt: null, pausedAt: null, scheduledChangeAction: null, scheduledChangeAt: null, lastEventAt: stamp, mirroredAt: stamp }, activity: [{ id: 3, action: 'COMPANY_REACTIVATED', reason: 'Synthetic reviewed account access', createdAt: stamp }] },
      rows: [company, { ...company, id: 43, name: 'Synthetic Services', plan: 'STARTER', operationalStatus: 'SUSPENDED', accountVersion: 2 }],
      inquiry: { id: inquiryId, company: 'Synthetic Prospect', requestedLocations: 7, requestedStaff: 35, createdAt: stamp, contactVerification: 'UNVERIFIED', handling, contactName: 'Synthetic Sender', contactEmail: 'sender@example.invalid', requirements: 'Please explain onboarding for an assigned multi-site team.' },
      diagnostics: { observedAt: stamp, identityConfigured: false, supportContactAvailable: false, providerConnectivity: 'NOT_CHECKED', database: 'REACHABLE', observations: { lastWebhookOccurredAt: stamp, lastWebhookProcessedAt: stamp, lastWorkerHeartbeatAt: null } },
    };
    if (scenario === 'inactive') { state.company.company.isActive = false; state.company.company.operationalStatus = 'SUSPENDED'; state.company.operationalReadAllowed = false; }
    if (scenario === 'unavailable') { state.diagnostics.database = 'UNAVAILABLE'; state.diagnostics.observations = null; }
  }
  reset();
  function release() { state.scenario = 'ready'; while (held.length) held.shift()(); }
  function control(value) { if (value.ready) release(); if (value.supportFailure !== undefined) state.supportFailure = value.supportFailure; }
  async function request(path, options = {}) {
    const method = options.method ?? 'GET';
    state.requests.push({ path, method, ...(options.body ? { body: clone(options.body) } : {}) });
    if (state.scenario === 'loading' || (state.scenario === 'pending' && method === 'PATCH')) await new Promise(resolve => held.push(resolve));
    if (method === 'GET' && ['error', 'denied'].includes(state.scenario)) return { status: state.scenario === 'denied' ? 403 : 503, body: { message: 'Synthetic network boundary failure' } };
    const url = new URL(path, 'https://fixture.example.invalid');
    if (method === 'PATCH') {
      state.patches++;
      if (state.scenario === 'conflict' && state.patches === 1) {
        state.company.company.accountVersion++;
        state.inquiry.handling.version++;
        return { status: 409, body: { message: 'Synthetic concurrent record change' } };
      }
      let data;
      if (url.pathname === '/platform/companies/42/status') {
        const changed = state.company.company.operationalStatus !== options.body.operationalStatus;
        if (options.body.expectedVersion !== state.company.company.accountVersion) return { status: 409, body: { message: 'Synthetic version conflict' } };
        if (changed) {
          state.changes++;
          state.company.company.operationalStatus = options.body.operationalStatus;
          state.company.company.accountVersion++;
          state.company.company.suspendedAt = options.body.operationalStatus === 'SUSPENDED' ? stamp : null;
          state.company.company.suspensionReason = options.body.operationalStatus === 'SUSPENDED' ? options.body.reason : null;
          state.company.operationalReadAllowed = options.body.operationalStatus === 'ACTIVE';
          state.company.activity.unshift({ id: 4, action: options.body.operationalStatus === 'SUSPENDED' ? 'COMPANY_SUSPENDED' : 'COMPANY_REACTIVATED', reason: options.body.reason, createdAt: stamp });
        }
        data = { company: clone(state.company.company), changed };
      } else if (url.pathname === `/platform/service/inquiries/${inquiryId}`) {
        if (options.body.expectedVersion !== state.inquiry.handling.version) return { status: 409, body: { message: 'Synthetic version conflict' } };
        const owner = options.body.ownership === 'SELF' ? { issuer: 'https://issuer.example.invalid', subject: 'synthetic-operator' } : null;
        const changed = state.inquiry.handling.status !== options.body.status || JSON.stringify(state.inquiry.handling.owner) !== JSON.stringify(owner);
        if (changed) {
          state.changes++;
          state.inquiry.handling = { version: state.inquiry.handling.version + 1, status: options.body.status, owner, updatedAt: stamp };
        }
        data = { handling: clone(state.inquiry.handling), changed };
      } else return { status: 404, body: { message: 'Unexpected synthetic mutation path' } };
      if (state.scenario === 'uncertain' && state.patches === 1) return { status: 503, body: { message: 'Synthetic response lost after in-memory save' } };
      return { status: 200, body: { data } };
    }
    let data;
    if (url.pathname === '/platform/companies') {
      const rows = state.rows.filter(row => (!url.searchParams.get('q') || row.name.toLowerCase().includes(url.searchParams.get('q').toLowerCase())) && (!url.searchParams.get('status') || row.operationalStatus === url.searchParams.get('status')));
      data = { items: state.scenario === 'empty' ? [] : clone(url.searchParams.has('after') ? rows.slice(1) : rows), nextCursor: state.scenario === 'empty' || url.searchParams.has('after') ? null : '42' };
    } else if (url.pathname === '/platform/companies/42') data = clone(state.company);
    else if (url.pathname === '/platform/service/diagnostics') data = clone(state.diagnostics);
    else if (url.pathname === '/support/contact') {
      state.supportReads++;
      if (state.supportFailure) return { status: 503, body: { message: 'Synthetic support refresh failure' } };
      data = state.scenario === 'support' ? { available: true, email: 'support@example.invalid', channel: 'EMAIL', verification: 'OPERATOR_CONFIGURED' } : { available: false, email: null, channel: null, verification: 'UNAVAILABLE' };
    } else if (url.pathname === '/platform/service/audit') data = { items: state.scenario === 'empty' ? [] : [{ id: 12, companyId: 42, action: 'COMPANY_SUSPENDED', actorType: 'PLATFORM_OPERATOR', createdAt: stamp }], nextCursor: url.searchParams.has('after') || state.scenario === 'empty' ? null : '12' };
    else if (url.pathname === '/platform/service/inquiries') data = { items: state.scenario === 'empty' ? [] : [clone(state.inquiry)], nextCursor: url.searchParams.has('after') || state.scenario === 'empty' ? null : inquiryId };
    else if (url.pathname === `/platform/service/inquiries/${inquiryId}`) data = clone(state.inquiry);
    else return { status: 404, body: { message: 'Unexpected synthetic read path' } };
    return { status: 200, body: { data } };
  }
  return { reset, request, control, inspect: () => clone(state) };
}
