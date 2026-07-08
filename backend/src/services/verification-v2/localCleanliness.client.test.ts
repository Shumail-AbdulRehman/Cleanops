import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanlinessBand,
  isLocalCleanlinessEnabled,
  localCleanlinessConfiguration,
  localCleanlinessVersionPart,
  scoreLocalCleanliness,
} from './localCleanliness.client.js';
import { ProviderServiceFailure } from './provider.service.js';

const jpeg = Buffer.from([0x00, 0xff, 0xd8, 0xff, 0xd9, 0x00]).subarray(1, 5);
const scoreResponse = { pDirty: 0.20, modelVersion: 'cleandirty-4cat-dinov2-001122aabbcc', latencyMs: 24 };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('CLEANLINESS_PROVIDER', undefined);
  vi.stubEnv('LOCAL_CLEANLINESS_URL', undefined);
  vi.stubEnv('LOCAL_CLEANLINESS_TIMEOUT_MS', undefined);
  vi.stubEnv('LOCAL_CLEANLINESS_MODEL_ID', undefined);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('local cleanliness configuration', () => {
  it('applies the defaults and reads the mode at call time', () => {
    expect(localCleanlinessConfiguration()).toEqual({
      mode: 'clef',
      url: 'http://127.0.0.1:8765',
      timeoutMs: 15000,
      modelId: 'cleandirty-4cat-dinov2-20261117',
    });
    expect(isLocalCleanlinessEnabled()).toBe(false);
    vi.stubEnv('CLEANLINESS_PROVIDER', 'clef');
    expect(isLocalCleanlinessEnabled()).toBe(false);
    vi.stubEnv('CLEANLINESS_PROVIDER', 'local-model');
    expect(isLocalCleanlinessEnabled()).toBe(true);
  });

  it.each([
    ['CLEANLINESS_PROVIDER', 'unknown'],
    ['LOCAL_CLEANLINESS_URL', 'ftp://127.0.0.1:8765'],
    ['LOCAL_CLEANLINESS_URL', 'not-a-url'],
    ['LOCAL_CLEANLINESS_TIMEOUT_MS', '99'],
    ['LOCAL_CLEANLINESS_TIMEOUT_MS', '60001'],
    ['LOCAL_CLEANLINESS_TIMEOUT_MS', '100.5'],
    ['LOCAL_CLEANLINESS_MODEL_ID', 'invalid model id'],
    ['LOCAL_CLEANLINESS_MODEL_ID', 'x'.repeat(81)],
  ])('rejects %s=%s with a provider configuration failure', (name, value) => {
    vi.stubEnv(name, value);
    expect(localCleanlinessConfiguration).toThrow(new ProviderServiceFailure('PROVIDER_CONFIGURATION_INVALID'));
  });

  it('validates the switch independently of the local service settings', () => {
    vi.stubEnv('LOCAL_CLEANLINESS_URL', 'invalid');
    expect(isLocalCleanlinessEnabled()).toBe(false);
    vi.stubEnv('CLEANLINESS_PROVIDER', 'unknown');
    expect(isLocalCleanlinessEnabled).toThrow(new ProviderServiceFailure('PROVIDER_CONFIGURATION_INVALID'));
  });

  it('includes the mode, model id and both band edges in the version part', () => {
    const clefVersion = localCleanlinessVersionPart();
    vi.stubEnv('CLEANLINESS_PROVIDER', 'local-model');
    const localVersion = localCleanlinessVersionPart();
    expect(localVersion).not.toBe(clefVersion);
    vi.stubEnv('LOCAL_CLEANLINESS_MODEL_ID', 'test-model_v2.1');
    expect(localCleanlinessVersionPart()).toBe('local-model:test-model_v2.1:0.2:0.8');
    expect(localCleanlinessVersionPart()).not.toBe(localVersion);
  });
});

describe('cleanliness bands', () => {
  it.each([
    [0, 'CLEAN'],
    [0.1999, 'CLEAN'],
    [0.20, 'REVIEW'],
    [0.7999, 'REVIEW'],
    [0.80, 'DIRTY'],
    [1, 'DIRTY'],
  ])('classifies %s as %s', (pDirty, band) => {
    expect(cleanlinessBand(pDirty)).toBe(band);
  });
});

describe('local cleanliness scoring', () => {
  beforeEach(() => {
    vi.stubEnv('CLEANLINESS_PROVIDER', 'local-model');
  });

  it('posts the exact JPEG once and uses the service score, version and latency', async () => {
    vi.stubEnv('LOCAL_CLEANLINESS_URL', 'https://127.0.0.1:9000/');
    vi.stubEnv('LOCAL_CLEANLINESS_TIMEOUT_MS', '60000');
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValueOnce(Response.json(scoreResponse));

    await expect(scoreLocalCleanliness(jpeg)).resolves.toEqual({ status: 'SCORED', ...scoreResponse, band: 'REVIEW' });
    expect(timeout).toHaveBeenCalledWith(60000);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://127.0.0.1:9000/score', {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      signal: timeout.mock.results[0].value,
      redirect: 'manual',
    });
  });

  it('returns unavailable for invalid configuration without making a request', async () => {
    vi.stubEnv('LOCAL_CLEANLINESS_MODEL_ID', 'invalid id');
    await expect(scoreLocalCleanliness(jpeg)).resolves.toMatchObject({
      status: 'UNAVAILABLE', reason: 'PROVIDER_CONFIGURATION_INVALID',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts the request after the configured timeout', async () => {
    vi.stubEnv('LOCAL_CLEANLINESS_TIMEOUT_MS', '100');
    fetchMock.mockImplementationOnce(async (_url, options) => {
      const signal = options?.signal;
      if (!signal) throw new Error('Missing abort signal');
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    const result = await scoreLocalCleanliness(jpeg);
    expect(result).toMatchObject({ status: 'UNAVAILABLE', reason: 'TIMEOUT' });
    expect(result.latencyMs).toBeGreaterThanOrEqual(90);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a timeout while reading the response', async () => {
    const response = Response.json(scoreResponse);
    vi.spyOn(response, 'json').mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    fetchMock.mockResolvedValueOnce(response);
    await expect(scoreLocalCleanliness(jpeg)).resolves.toMatchObject({ status: 'UNAVAILABLE', reason: 'TIMEOUT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a refused connection', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') }));
    await expect(scoreLocalCleanliness(jpeg)).resolves.toMatchObject({ status: 'UNAVAILABLE', reason: 'CONNECTION_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([201, 302, 500])('reports non-200 HTTP status %s', async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json(scoreResponse, { status }));
    await expect(scoreLocalCleanliness(jpeg)).resolves.toMatchObject({ status: 'UNAVAILABLE', reason: 'HTTP_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports malformed JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{'));
    await expect(scoreLocalCleanliness(jpeg)).resolves.toMatchObject({ status: 'UNAVAILABLE', reason: 'INVALID_JSON' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, -0.1, 1.5, NaN, Infinity, '0.20'])('reports invalid pDirty %s', async (pDirty) => {
    const response = new Response();
    vi.spyOn(response, 'json').mockResolvedValueOnce({ ...scoreResponse, pDirty });
    fetchMock.mockResolvedValueOnce(response);
    await expect(scoreLocalCleanliness(jpeg)).resolves.toMatchObject({ status: 'UNAVAILABLE', reason: 'INVALID_SCORE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { modelVersion: undefined },
    { latencyMs: -1 },
    { latencyMs: 1.5 },
  ])('reports invalid response metadata %j', async (metadata) => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...scoreResponse, ...metadata }));
    await expect(scoreLocalCleanliness(jpeg)).resolves.toMatchObject({ status: 'UNAVAILABLE', reason: 'INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
