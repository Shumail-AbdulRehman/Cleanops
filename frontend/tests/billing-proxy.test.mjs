import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8');
const rules = redirects.split(/\r?\n/).map(line => line.trim())
  .filter(line => line && !line.startsWith('#')).map(line => {
    const fields = line.split(/\s+/);
    assert.equal(fields.length, 3, 'Extend this contract reader before adding conditional redirect syntax');
    const [from, to, status] = fields;
    assert.match(status, /^\d{3}!?$/);
    return { from, to, status: Number(status.replace('!', '')), force: status.endsWith('!') };
  });
const upstream = 'https://cleanops-2f9dbc8f50cd.herokuapp.com';

// A small reader for this file's static/exact/splat rules, not a Netlify emulator.
// This checks configuration selection only, not upstream status/body or cookies.
function selectRoute(requestPath, existingFiles = []) {
  const request = new URL(requestPath, 'https://frontend.example.test');
  for (const rule of rules) {
    const wildcard = rule.from.endsWith('*');
    const prefix = wildcard ? rule.from.slice(0, -1) : rule.from;
    if (wildcard ? !request.pathname.startsWith(prefix) : request.pathname !== prefix) continue;
    if (!rule.force && existingFiles.includes(request.pathname)) return { kind: 'static', pathname: request.pathname };
    const splat = wildcard ? request.pathname.slice(prefix.length) : '';
    const target = rule.to.replace(':splat', splat);
    return {
      kind: target.startsWith('https://') ? 'proxy' : 'local',
      target: target + request.search,
      rule,
    };
  }
  return null;
}

test('API rewrite precedes the unchanged non-forced asset and SPA fallbacks', () => {
  assert.deepEqual(rules.map(rule => rule.from), ['/api/*', '/assets/*', '/*']);
  assert.equal(rules[0].to, `${upstream}/api/:splat`);
  assert.equal(rules[0].status, 200);
  assert.deepEqual(rules.slice(1), [
    { from: '/assets/*', to: '/asset-not-found.txt', status: 404, force: false },
    { from: '/*', to: '/index.html', status: 200, force: false },
  ]);
});

for (const path of [
  '/api/subscription/manage',
  '/api/subscription/manage/catalog',
  '/api/subscription/manage/checkout',
  '/api/common/refresh-token',
  '/api/unknown-endpoint',
  '/api/assets/unknown.js',
]) {
  test(`${path} selects the Heroku API rather than the SPA, including missing endpoints`, () => {
    const route = selectRoute(path);
    assert.equal(route.kind, 'proxy');
    assert.equal(route.target, upstream + path);
    assert.equal(route.rule.from, '/api/*');
    assert.notEqual(route.rule.to, '/index.html');
    // The configured 200 selects proxy mode; it is not a fake upstream success.
    assert.equal(route.rule.status, 200);
  });
}

test('nested API path, repeated query keys and encoded values are forwarded without a second /api prefix', () => {
  const path = '/api/subscription/manage/catalog?interval=year&filter=a%2Fb&filter=c%20d&empty=';
  const route = selectRoute(path);
  assert.equal(route.target, upstream + path);
  assert.equal(new URL(route.target).pathname, '/api/subscription/manage/catalog');
  assert.deepEqual(new URL(route.target).searchParams.getAll('filter'), ['a/b', 'c d']);
});

test('a missing hashed asset retains the text404 rule instead of index.html', () => {
  const route = selectRoute('/assets/SubscriptionPage-old.js?version=old');
  assert.equal(route.kind, 'local');
  assert.equal(route.target, '/asset-not-found.txt?version=old');
  assert.equal(route.rule.status, 404);
});

for (const path of ['/assets/current.js', '/brand/hygene-ops-mark.svg', '/asset-not-found.txt']) {
  test(`existing static file ${path} retains normal file serving`, () => {
    assert.deepEqual(selectRoute(path, [path]), { kind: 'static', pathname: path });
  });
}

for (const path of ['/choose-plan', '/subscription/payment?plan=PRO&interval=year', '/welcome', '/dashboard']) {
  test(`application deep link ${path} keeps the SPA fallback`, () => {
    const route = selectRoute(path);
    assert.equal(route.kind, 'local');
    assert.equal(route.rule.from, '/*');
    assert.equal(route.rule.status, 200);
    assert.equal(route.target, '/index.html' + new URL(path, 'https://frontend.example.test').search);
  });
}

test('the API namespace does not capture similarly named application paths', () => {
  assert.equal(selectRoute('/apiary').rule.from, '/*');
});
