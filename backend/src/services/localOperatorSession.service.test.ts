import { beforeAll, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcrypt';
import type { Request } from 'express';
import { createLocalOperatorSessions, localOperatorEnvironmentAllowed, LIVE_OPERATOR_COOKIE, LOCAL_OPERATOR_COOKIE } from './localOperatorSession.service.js';
let passwordHash:string;
const password='Synthetic-platform-only!42';
const env:NodeJS.ProcessEnv={NODE_ENV:'development',LOCAL_PLATFORM_LOGIN_ENABLED:'true',DATABASE_URL:'postgresql://test@127.0.0.1:56445/hygene_ops_local',FRONTEND_URL:'http://127.0.0.1:5173'};
type RequestFixture = Omit<Partial<Request>, 'header'> & { header?: (name: string) => string | undefined };
const req=(overrides:RequestFixture={}):Request=>({method:'GET',socket:{remoteAddress:'127.0.0.1'},cookies:{},header:(name:string)=>name==='Origin'?'http://localhost:5173':undefined,...overrides} as unknown as Request);
function setup(){let at=1000000;const settings={...env};const service=createLocalOperatorSessions({env:()=>settings,readCredentials:()=>({email:'platform@example.invalid',passwordHash}),now:()=>at});return {service,settings,advance:()=>{at+=16*60_000;}};}
beforeAll(async()=>{passwordHash=await bcrypt.hash(password,10);});
describe('strict local environment gate',()=>{
 it.each([{NODE_ENV:'production'},{NODE_ENV:'test'},{LOCAL_PLATFORM_LOGIN_ENABLED:'false'},{DATABASE_URL:'postgresql://test@remote.invalid:56445/hygene_ops_local'},{DATABASE_URL:'postgresql://test@127.0.0.1:56445/customer_db'}])('rejects nonlocal/unapproved configuration %j',patch=>{expect(localOperatorEnvironmentAllowed({...env,...patch})).toBe(false);});
 it('allows only explicitly enabled loopback local development or isolated test child DB',()=>{expect(localOperatorEnvironmentAllowed(env)).toBe(true);expect(localOperatorEnvironmentAllowed({...env,DATABASE_URL:'postgresql://test@127.0.0.1:56443/priv_e2e_test_'+'a'.repeat(32)})).toBe(true);});
});
describe('separate opaque platform sessions',()=>{
 it('signs in with bcrypt and creates a distinct platform principal',async()=>{const {service}=setup();const result=await service.login(req(),{email:'platform@example.invalid',password});expect(result.token.length).toBe(43);const actor=service.authenticate(req({cookies:{[LOCAL_OPERATOR_COOKIE]:result.token}}));expect(actor).toEqual({kind:'PLATFORM_OPERATOR',issuer:'urn:hygene:local-development',subject:'platform@example.invalid'});expect(service.status(req({cookies:{[LOCAL_OPERATOR_COOKIE]:result.token}}))).toEqual({enabled:true,authenticated:true,email:'platform@example.invalid'});});
 it('denies wrong password/email and throttles repeated attempts',async()=>{const {service}=setup();for(let i=0;i<5;i++)await expect(service.login(req(),{email:'platform@example.invalid',password:password+'wrong'})).rejects.toMatchObject({statusCode:401});await expect(service.login(req(),{email:'platform@example.invalid',password})).rejects.toMatchObject({statusCode:429});});
 it('expires and revokes sessions',async()=>{const {service,advance}=setup();const first=await service.login(req(),{email:'platform@example.invalid',password});const request=req({cookies:{[LOCAL_OPERATOR_COOKIE]:first.token}});service.logout(request);expect(()=>service.authenticate(request)).toThrow();const second=await service.login(req(),{email:'platform@example.invalid',password});advance();expect(()=>service.authenticate(req({cookies:{[LOCAL_OPERATOR_COOKIE]:second.token}}))).toThrow();});
 it('never accepts tenant cookies or JWTs as platform sessions',()=>{const {service}=setup();expect(service.authenticate(req({cookies:{accessToken:'tenant.jwt.value'}}))).toBeNull();expect(()=>service.authenticate(req({cookies:{[LOCAL_OPERATOR_COOKIE]:'tenant.jwt.value'}}))).toThrow();});
 it('does not authenticate a provisioned local cookie in production',async()=>{const {service,settings}=setup();const session=await service.login(req(),{email:'platform@example.invalid',password});settings.NODE_ENV='production';expect(service.authenticate(req({cookies:{[LOCAL_OPERATOR_COOKIE]:session.token}}))).toBeNull();await expect(service.login(req(),{email:'platform@example.invalid',password})).rejects.toMatchObject({statusCode:503});});
 it('denies remote peers, untrusted origins and mixed tenant contexts',async()=>{const {service}=setup();await expect(service.login(req({socket:{remoteAddress:'192.168.100.12'} as Request['socket']}),{email:'platform@example.invalid',password})).rejects.toMatchObject({statusCode:503});await expect(service.login(req({header:(()=> 'http://localhost:9999') as unknown as Request['header']}),{email:'platform@example.invalid',password})).rejects.toMatchObject({statusCode:403});const session=await service.login(req(),{email:'platform@example.invalid',password});expect(()=>service.authenticate(req({cookies:{[LOCAL_OPERATOR_COOKIE]:session.token},user:{id:1} as Request['user']}))).toThrow();});
});

const liveOrigin = 'https://console.example.test';
const liveEmail = 'operator@example.test';
const liveCredentials = { email: '  Operator@EXAMPLE.test  ', password };
const attemptRejection = { statusCode: 429, message: 'Too many sign-in attempts. Try again in 15 minutes.' };
const badCredentials = { statusCode: 401, message: 'Invalid platform email or password' };
const hour = 60 * 60_000;
const liveReq = (options: RequestFixture = {}) => req({
  method: 'POST',
  ip: '192.0.2.1',
  header: (name: string) => name === 'Origin' ? liveOrigin : undefined,
  ...options,
});
const liveRead = (token: string, options: RequestFixture = {}) => liveReq({
  method: 'GET',
  header: () => undefined,
  cookies: { [LIVE_OPERATOR_COOKIE]: token },
  ...options,
});
function setupLive(extra: NodeJS.ProcessEnv = {}) {
  let at = 1_000_000;
  const settings: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    FRONTEND_URL: ` "https://other.example.test/", '${liveOrigin}/' , http://console.example.test `,
    PLATFORM_LOGIN_ENABLED: 'true',
    PLATFORM_LOGIN_EMAIL: liveCredentials.email,
    PLATFORM_LOGIN_PASSWORD_HASH: passwordHash,
    ...extra,
  };
  const service = createLocalOperatorSessions({
    env: () => settings,
    now: () => at,
    readCredentials: () => ({ email: 'platform@example.invalid', passwordHash }),
  });
  return { service, settings, advance: (ms: number) => { at += ms; } };
}

describe('live platform password sessions', () => {
  it.each([
    ['PLATFORM_LOGIN_ENABLED', undefined],
    ['PLATFORM_LOGIN_ENABLED', 'TRUE'],
    ['PLATFORM_LOGIN_EMAIL', undefined],
    ['PLATFORM_LOGIN_EMAIL', 'invalid'],
    ['PLATFORM_LOGIN_PASSWORD_HASH', undefined],
    ['PLATFORM_LOGIN_PASSWORD_HASH', 'invalid'],
    ['PLATFORM_LOGIN_PASSWORD_HASH', '$2b$09$' + 'a'.repeat(53)],
    ['PLATFORM_LOGIN_PASSWORD_HASH', '$2b$15$' + 'a'.repeat(53)],
  ])('disables live sign-in for %s = %s', async (key, value) => {
    const { service } = setupLive({ [key]: value });
    expect(service.status(liveReq())).toEqual({ enabled: false, authenticated: false });
    await expect(service.login(liveReq(), liveCredentials)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('gives the provisioned local mode precedence and falls back to live for a non-loopback peer', async () => {
    const { service, settings } = setupLive(env);
    const session = await service.login(req(), { email: 'platform@example.invalid', password });
    expect(session.cookie.name).toBe(LOCAL_OPERATOR_COOKIE);
    expect(session.expiresAt.getTime()).toBe(1_000_000 + 15 * 60_000);
    await expect(service.login(liveReq(), liveCredentials)).rejects.toMatchObject({ statusCode: 403 });
    settings.FRONTEND_URL = liveOrigin;
    const remote = liveReq({ socket: { remoteAddress: '192.0.2.2' } as Request['socket'] });
    await expect(service.login(remote, liveCredentials)).resolves.toMatchObject({ cookie: { name: LIVE_OPERATOR_COOKIE } });
  });

  it.each(['2a', '2b', '2y'])('accepts a %s bcrypt hash and creates the frozen live principal', async (prefix) => {
    const { service } = setupLive({ PLATFORM_LOGIN_PASSWORD_HASH: passwordHash.replace(/^\$2b\$/, () => `$${prefix}$`) });
    const session = await service.login(liveReq(), liveCredentials);
    expect(session.cookie.name).toBe(LIVE_OPERATOR_COOKIE);
    expect(Buffer.from(session.token, 'base64url')).toHaveLength(32);
    expect(session.expiresAt.getTime()).toBe(1_000_000 + 8 * hour);
    const request = liveRead(session.token);
    const actor = service.authenticate(request);
    expect(actor).toEqual({ kind: 'PLATFORM_OPERATOR', issuer: 'urn:hygene:platform-password', subject: liveEmail });
    expect(Object.isFrozen(actor)).toBe(true);
    expect(service.status(request)).toEqual({ enabled: true, authenticated: true, email: liveEmail });
  });

  it.each([undefined, 'http://console.example.test', 'https://foreign.example.test', liveOrigin + '/'])(
    'rejects login, logout and authenticated writes with Origin %s', async (value) => {
      const { service } = setupLive();
      const session = await service.login(liveReq(), liveCredentials);
      const header = (name: string) => name === 'Origin' ? value : undefined;
      const cookies = { [LIVE_OPERATOR_COOKIE]: session.token };
      await expect(service.login(liveReq({ header }), liveCredentials)).rejects.toMatchObject({ statusCode: 403 });
      expect(() => service.logout(liveReq({ header, cookies }))).toThrow(expect.objectContaining({ statusCode: 403 }));
      expect(() => service.authenticate(liveReq({ method: 'PATCH', header, cookies }))).toThrow(expect.objectContaining({ statusCode: 403 }));
    },
  );

  it('accepts authenticated writes from another normalized configured HTTPS origin', async () => {
    const { service } = setupLive();
    const session = await service.login(liveReq(), liveCredentials);
    const request = liveRead(session.token, {
      method: 'PATCH', header: (name: string) => name === 'Origin' ? 'https://other.example.test' : undefined,
    });
    expect(service.authenticate(request)?.subject).toBe(liveEmail);
  });

  it('runs bcrypt for a wrong email and returns the same error as a wrong password', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    try {
      const { service } = setupLive();
      await expect(service.login(liveReq(), { ...liveCredentials, email: 'wrong@example.test' })).rejects.toMatchObject(badCredentials);
      expect(compare).toHaveBeenCalledWith(password, passwordHash);
      await expect(service.login(liveReq(), { ...liveCredentials, password: password + '-wrong' })).rejects.toMatchObject(badCredentials);
      expect(compare).toHaveBeenCalledTimes(2);
    } finally { compare.mockRestore(); }
  });

  it('limits concurrent failures per req.ip and resets the limit after 15 minutes', async () => {
    const { service, advance } = setupLive();
    const wrong = { ...liveCredentials, password: password + '-wrong' };
    const failures = Array.from({ length: 5 }, () => expect(service.login(liveReq(), wrong)).rejects.toMatchObject(badCredentials));
    await expect(service.login(liveReq(), liveCredentials)).rejects.toMatchObject(attemptRejection);
    await Promise.all(failures);
    await expect(service.login(liveReq({ ip: '192.0.2.2' }), liveCredentials)).resolves.toMatchObject({ email: liveEmail });
    advance(15 * 60_000);
    await expect(service.login(liveReq(), liveCredentials)).resolves.toMatchObject({ email: liveEmail });
  });

  it('clears only the successful client counter and limits the whole account to 20 failures', async () => {
    const { service, advance } = setupLive();
    const wrong = { ...liveCredentials, password: password + '-wrong' };
    const failFrom = (suffix: number) => expect(service.login(liveReq({ ip: `192.0.2.${suffix}` }), wrong)).rejects.toMatchObject(badCredentials);
    await Promise.all(Array.from({ length: 4 }, () => failFrom(1)));
    await service.login(liveReq(), liveCredentials);
    const failures = [
      ...Array.from({ length: 5 }, () => failFrom(1)),
      ...Array.from({ length: 11 }, (_, index) => failFrom(index + 2)),
    ];
    await expect(service.login(liveReq({ ip: '192.0.2.50' }), liveCredentials)).rejects.toMatchObject(attemptRejection);
    await Promise.all(failures);
    await expect(service.login(liveReq({ ip: '192.0.2.50' }), liveCredentials)).rejects.toMatchObject(attemptRejection);
    advance(15 * 60_000);
    await expect(service.login(liveReq({ ip: '192.0.2.50' }), liveCredentials)).resolves.toMatchObject({ email: liveEmail });
  });

  it('expires at eight hours even when used immediately beforehand', async () => {
    const { service, advance } = setupLive();
    const { token } = await service.login(liveReq(), liveCredentials);
    advance(8 * hour - 1);
    expect(service.authenticate(liveRead(token))?.subject).toBe(liveEmail);
    advance(1);
    expect(() => service.authenticate(liveRead(token))).toThrow(expect.objectContaining({ statusCode: 401 }));
  });

  it('evicts the oldest session when issuing a seventeenth live session', async () => {
    const { service } = setupLive();
    const oldest = await service.login(liveReq(), liveCredentials);
    const retained = await Promise.all(Array.from({ length: 16 }, (_, index) =>
      service.login(liveReq({ ip: `192.0.2.${index + 2}` }), liveCredentials)));
    expect(() => service.authenticate(liveRead(oldest.token))).toThrow(expect.objectContaining({ statusCode: 401 }));
    for (const { token } of retained) expect(service.authenticate(liveRead(token))?.subject).toBe(liveEmail);
  });

  it.each(['PLATFORM_LOGIN_EMAIL', 'PLATFORM_LOGIN_PASSWORD_HASH'])('revokes all live sessions after changing %s', async (key) => {
    const { service, settings } = setupLive();
    const [first, second] = await Promise.all([service.login(liveReq(), liveCredentials), service.login(liveReq(), liveCredentials)]);
    const previous = settings[key];
    settings[key] = key === 'PLATFORM_LOGIN_EMAIL' ? 'changed@example.test' : await bcrypt.hash(password, 10);
    expect(service.status(liveRead(first.token))).toEqual({ enabled: true, authenticated: false });
    settings[key] = previous;
    expect(() => service.authenticate(liveRead(second.token))).toThrow(expect.objectContaining({ statusCode: 401 }));
  });
});
