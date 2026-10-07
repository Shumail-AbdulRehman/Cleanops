import assert from "node:assert/strict";
import test from "node:test";
import axios, { AxiosError, AxiosHeaders } from "axios";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { client, configureApiAuth, configureNativeAppVersion, staffSignInPaths } from "./client";
import { uploadFormData } from "./client";
import { changeApiServerAddress, refreshApiTokens } from './client';
import { validateServerAddress } from './serverAddress';

test('editable server address validates physical-device URLs', () => {
  assert.equal(validateServerAddress(' http://10.54.199.4:8080/api/ '), 'http://10.54.199.4:8080/api');
  assert.equal(validateServerAddress('https://example.com'), 'https://example.com/api');
  for (const address of ['http://localhost:8080/api', 'http://10.0.2.2:8080/api',
    'http://example.com/api', 'https://user:pass@example.com/api',
    'http://10.54.199.4:8080/admin', 'http://10.54.199.4:8080/api?token=x']) {
    assert.throws(() => validateServerAddress(address));
  }
});

test('a saved server address drives login, ordinary requests, refresh and uploads', async (t) => {
  t.mock.method(AsyncStorage, 'getItem', async () => null);
  t.mock.method(AsyncStorage, 'setItem', async () => {});
  const savedAdapter = client.defaults.adapter;
  const savedFetch = globalThis.fetch;
  const savedPost = axios.post;
  let scope: string | null = null;
  const addresses: string[] = [];
  configureApiAuth({getScope:()=>scope,getTokens:async()=>({accessToken:null,refreshToken:'refresh'}),setTokens:async()=>{},clearSession:async()=>{}});
  client.defaults.adapter = async config => {
    addresses.push(String(config.baseURL));
    return {data:{},status:200,statusText:'OK',headers:{},config};
  };
  axios.post = (async (url: string) => {
    addresses.push(url);
    return {data:{data:{accessToken:'new-token',refreshToken:'new-refresh'}}};
  }) as typeof axios.post;
  globalThis.fetch = async (url) => {
    addresses.push(String(url));
    return new Response(JSON.stringify({data:{}}),{status:200});
  };
  try {
    const address = await changeApiServerAddress('http://10.54.199.4:8080/api');
    assert.equal(address, 'http://10.54.199.4:8080/api');
    await client.post(staffSignInPaths.request, {});
    await client.get('/common/get-current-user');
    await refreshApiTokens();
    await uploadFormData('/capture-session/test/attempts',()=>new FormData());
    scope = '1_1';
    await assert.rejects(changeApiServerAddress('http://192.168.1.2:8080/api'), /Sign out/);
    assert.deepEqual(addresses,[address,address,`${address}/common/refresh-token`,`${address}/capture-session/test/attempts`]);
  } finally {
    scope = null;
    client.defaults.adapter = savedAdapter;
    globalThis.fetch = savedFetch;
    axios.post = savedPost;
  }
});

test('native version reaches session requests and uploads consistently, including stale request headers', async () => {
  const savedAdapter = client.defaults.adapter;
  const savedFetch = globalThis.fetch;
  configureApiAuth({getScope:()=>null,getTokens:async()=>({accessToken:null,refreshToken:null}),setTokens:async()=>{},clearSession:async()=>{}});
  const sent: string[] = [];
  client.defaults.adapter = async config => {
    assert.equal(AxiosHeaders.from(config.headers).get('X-Hygene-Workflow'), '2');
    sent.push(String(AxiosHeaders.from(config.headers).get('X-Hygene-App-Version')));
    return {data:{},status:200,statusText:'OK',headers:{},config};
  };
  globalThis.fetch = async (_url, options) => {
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('X-Hygene-Workflow'), '2');
    sent.push(String(headers.get('X-Hygene-App-Version')));
    return new Response(JSON.stringify({data:{}}),{status:200});
  };
  try {
    configureNativeAppVersion('2.0.0');
    await client.post('/task-instance/1/capture-sessions');
    await client.post('/capture-session/test/resume', {}, {headers:{'X-Hygene-App-Version':'0.0.0'}});
    await uploadFormData('/capture-session/test/attempts',()=>new FormData());
    assert.deepEqual(sent,['2.0.0','2.0.0','2.0.0']);
    configureNativeAppVersion(null);
    await client.post('/task-instance/1/capture-sessions');
    assert.equal(sent.at(-1),'0.0.0','an unknown native version must still fail the server gate');
  } finally {
    configureNativeAppVersion(null);
    client.defaults.adapter = savedAdapter;
    globalThis.fetch = savedFetch;
  }
});

test("phone sign-in requests stay public and preserve errors without refreshing a session", async () => {
  const savedAdapter = client.defaults.adapter;
  const savedPost = axios.post;
  let refreshCalls = 0;
  let accessToken: string | null = null;
  configureApiAuth({
    getScope: () => null,
    getTokens: async () => ({ accessToken, refreshToken: "stale-refresh-token" }),
    setTokens: async () => { throw new Error("Login must not refresh tokens"); },
    clearSession: async () => { throw new Error("Login must not clear a session"); },
  });
  axios.post = (async () => {
    refreshCalls++;
    throw new Error("Unexpected refresh");
  }) as typeof axios.post;
  client.defaults.adapter = async config => {
    assert.equal(AxiosHeaders.from(config.headers).get("Authorization"), undefined);
    throw new AxiosError("Request failed with status code 401", "ERR_BAD_REQUEST", config, {}, {
      status: 401, statusText: "Unauthorized", config,
      headers: {}, data: { message: "Sign-in request rejected" },
    });
  };
  try {
    for (const token of [null, "stale-access-token"]) {
      accessToken = token;
      for (const path of Object.values(staffSignInPaths)) await assert.rejects(client.post(path, {}, {
        headers: { Authorization: "Bearer explicit-stale-token" },
      }), error => {
        assert.ok(axios.isAxiosError(error));
        assert.equal(error.response?.status, 401);
        assert.equal(error.response?.data.message, "Sign-in request rejected");
        return true;
      });
    }
    assert.equal(refreshCalls, 0);
  } finally {
    client.defaults.adapter = savedAdapter;
    axios.post = savedPost;
  }
});

test("responses arriving after an account switch cannot restore the old user or acknowledge an upload", async () => {
  const savedAdapter = client.defaults.adapter;
  const savedFetch = globalThis.fetch;
  let scope = '1_1';
  configureApiAuth({
    getScope: () => scope,
    getTokens: async () => ({ accessToken: 'access', refreshToken: 'refresh' }),
    setTokens: async () => {}, clearSession: async () => {},
  });
  client.defaults.adapter = async config => {
    scope = '1_2';
    return { data: { data: { id: 1 } }, status: 200, statusText: 'OK', headers: {}, config };
  };
  globalThis.fetch = async () => {
    scope = '1_2';
    return new Response(JSON.stringify({ data: { attemptId: 'attempt', assetId: 'asset' } }), { status: 202 });
  };
  try {
    await assert.rejects(client.get('/common/get-current-user'), /Account changed/);
    scope = '1_1';
    client.defaults.adapter = async config => {
      scope = '1_2';
      throw new AxiosError('Forbidden', 'ERR_BAD_REQUEST', config, {}, {
        status: 403, statusText: 'Forbidden', config, headers: {}, data: { message: 'Revoked' },
      });
    };
    await assert.rejects(client.get('/common/get-current-user'), /Account changed/);
    scope = '1_1';
    await assert.rejects(uploadFormData('/capture-session/session/captures', () => new FormData()), /Account changed/);
  } finally {
    client.defaults.adapter = savedAdapter;
    globalThis.fetch = savedFetch;
  }
});
