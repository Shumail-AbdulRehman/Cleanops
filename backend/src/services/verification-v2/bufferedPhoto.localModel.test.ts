import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferedClefProvider, bufferedEvaluatorVersion } from './bufferedPhoto.provider.js';
import { cleanlinessBand, scoreLocalCleanliness, type LocalCleanlinessResult } from './localCleanliness.client.js';
import { bufferedDecision } from './photoResultPolicy.js';
import { viewSurfaces } from './rubrics.js';

vi.mock(import('./localCleanliness.client.js'), async (importOriginal) => ({
  ...await importOriginal(),
  scoreLocalCleanliness: vi.fn(),
}));

const provider = new BufferedClefProvider();
const image = Buffer.from('test photo');
const score = vi.mocked(scoreLocalCleanliness);

function scored(pDirty: number): LocalCleanlinessResult {
  return { status: 'SCORED', pDirty, band: cleanlinessBand(pDirty), modelVersion: 'test-model', latencyMs: 12 };
}

function evaluate(fixtureType: string, view: string, surfaces = viewSurfaces[view]) {
  const rubric = {
    version: 1,
    criteria: ['Required surfaces must be visible.'],
    views: [{ key: view }],
    surfacesByView: { [view]: surfaces },
  };
  return provider.evaluate(image, rubric, view, fixtureType);
}

type ClefRequest = { model: string; questions: Record<string, { criteria: Record<string, string> }> };

function replyTo(body: BodyInit | null | undefined, choices: Record<string, string>) {
  const request: ClefRequest = JSON.parse(String(body));
  const answers = Object.fromEntries(Object.entries(request.questions).map(([key, { criteria }]) => {
    const options = Object.keys(criteria);
    const choice = choices[key] ?? options[0];
    return [key, {
      type: 'choice', choice, confidence: 1,
      probabilities: Object.fromEntries(options.map(option => [option, Number(option === choice)])),
    }];
  }));
  return Response.json({ success: true, result: { model: request.model, answers } });
}

function mockClef(choices: Record<string, string> = {}) {
  const fetchClef = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => replyTo(init?.body, choices));
  vi.stubGlobal('fetch', fetchClef);
  return fetchClef;
}

describe('BufferedClefProvider local model', () => {
  beforeEach(() => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', '0'.repeat(32));
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-placeholder');
    vi.stubEnv('CLEF_MODEL', 'clef');
    vi.stubEnv('CLEF_TIMEOUT_MS', '30000');
    vi.stubEnv('CLEANLINESS_PROVIDER', 'local-model');
    vi.stubEnv('LOCAL_CLEANLINESS_URL', 'http://127.0.0.1:8765');
    vi.stubEnv('LOCAL_CLEANLINESS_TIMEOUT_MS', '15000');
    vi.stubEnv('LOCAL_CLEANLINESS_MODEL_ID', 'test-model');
    score.mockReset().mockResolvedValue(scored(0.05));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('keeps the CLEF screening questions and uses the clean sink score for automatic acceptance', async () => {
    const fetchClef = mockClef();
    const assessment = await evaluate('SINK', 'basin_tap');
    const localRequest: ClefRequest = JSON.parse(String(fetchClef.mock.calls[0][1]?.body));

    vi.stubEnv('CLEANLINESS_PROVIDER', 'clef');
    await evaluate('SINK', 'basin_tap');
    const clefRequest: ClefRequest = JSON.parse(String(fetchClef.mock.calls[1][1]?.body));
    const screeningKeys = ['originality', 'object_match', 'visible_surface_0', 'visible_surface_1', 'visible_surface_2'];
    expect(Object.keys(localRequest.questions)).toEqual(screeningKeys);
    expect(localRequest.questions).toEqual(Object.fromEntries(screeningKeys.map(key => [key, clefRequest.questions[key]])));
    expect(score).toHaveBeenCalledExactlyOnceWith(image);
    expect(assessment.cleanliness).toEqual({
      verdict: 'CLEAN', confidence: null, reasonCode: 'CLEAN',
      surfaces: ['basin', 'drain', 'tap'].map(surface => ({ surface, verdict: 'CLEAN' })),
    });
    expect(bufferedDecision(assessment, true)).toEqual({ state: 'PASSED', reason: 'CLEAN', keep: true });
    expect(assessment.metadata.provider).toBe('cloudflare');
    expect(assessment.metadata.screeningAnswers).not.toHaveProperty('cleanliness');
    expect(assessment.metadata.screeningAnswers).toHaveProperty('cleanlinessModel', {
      status: 'SCORED', pDirty: 0.05, band: 'CLEAN', modelVersion: 'test-model', latencyMs: 12, reason: null, fixtureType: 'SINK',
    });
  });

  it('rejects an extra CLEF answer outside the reduced question set', async () => {
    const fetchClef = mockClef();
    fetchClef.mockImplementationOnce(async (_url, init) => {
      const envelope = await replyTo(init?.body, {}).json();
      envelope.result.answers.surface_0 = envelope.result.answers.visible_surface_0;
      return Response.json(envelope);
    });
    await expect(evaluate('SINK', 'basin_tap')).rejects.toMatchObject({ code: 'PROVIDER_MALFORMED' });
  });

  it.each([
    ['FLOOR', 'wide_zone', 0.9, 'DIRTY', 'CLEANING_REQUIRED', 'CLEANING_REQUIRED'],
    ['INDIAN_TOILET', 'squat_pan', 0.5, 'CANNOT_ASSESS', 'REVIEW_REQUIRED', 'CANNOT_ASSESS'],
  ])('applies the decision policy to the %s score for %s', async (fixtureType, view, pDirty, verdict, state, reason) => {
    mockClef();
    score.mockResolvedValue(scored(pDirty));
    const assessment = await evaluate(fixtureType, view);
    expect(assessment.cleanliness).toMatchObject({ verdict, reasonCode: reason });
    expect(bufferedDecision(assessment, true)).toEqual({ state, reason, keep: true });
  });

  it.each([
    ['WESTERN_TOILET', 'bowl_seat', ['bowl', 'seat']],
    ['MIRROR', 'reflective_surface', ['reflective_surface']],
    ['BIN', 'opening_interior', ['opening', 'interior']],
  ])('applies one model verdict to all %s surfaces', async (fixtureType, view, surfaces) => {
    mockClef();
    const assessment = await evaluate(fixtureType, view);
    expect(score).toHaveBeenCalledExactlyOnceWith(image);
    expect(assessment.cleanliness?.surfaces).toEqual(surfaces.map(surface => ({ surface, verdict: 'CLEAN' })));
  });

  it.each([
    ['SQUAT', ['pan', 'drain', 'footrests']],
    ['WESTERN', ['bowl', 'seat']],
  ])('uses only the %s surfaces selected by CLEF for generic toilets', async (style, surfaces) => {
    const fetchClef = mockClef({ toilet_style: style });
    const assessment = await evaluate('TOILET', 'bowl_seat');
    const request: ClefRequest = JSON.parse(String(fetchClef.mock.calls[0][1]?.body));
    expect(Object.keys(request.questions)).toEqual([
      'originality', 'toilet_style', 'object_match', 'visible_western_surface_0', 'visible_western_surface_1',
      'visible_squat_surface_0', 'visible_squat_surface_1', 'visible_squat_surface_2',
    ]);
    expect(assessment.toiletStyle).toBe(style);
    expect(assessment.cleanliness?.surfaces).toEqual(surfaces.map(surface => ({ surface, verdict: 'CLEAN' })));
    expect(score).toHaveBeenCalledExactlyOnceWith(image);
  });

  it('discards the parallel score if CLEF cannot select a generic toilet style', async () => {
    mockClef({ toilet_style: 'UNCERTAIN' });
    score.mockImplementation(() => new Promise(() => undefined));
    const assessment = await evaluate('TOILET', 'bowl_seat');
    expect(assessment).toMatchObject({ toiletStyle: 'UNCERTAIN', viewMatch: 'UNCERTAIN', cleanliness: null });
    expect(assessment.metadata.screeningAnswers).not.toHaveProperty('cleanlinessModel');
  });

  it('maps an unavailable model to manager review and retains the reason', async () => {
    mockClef();
    score.mockResolvedValue({ status: 'UNAVAILABLE', reason: 'TIMEOUT', latencyMs: 15000 });
    const assessment = await evaluate('SINK', 'basin_tap');
    expect(assessment.cleanliness).toMatchObject({ verdict: 'CANNOT_ASSESS', confidence: null, reasonCode: 'CANNOT_ASSESS' });
    expect(bufferedDecision(assessment, true)).toEqual({ state: 'REVIEW_REQUIRED', reason: 'CANNOT_ASSESS', keep: true });
    expect(assessment.metadata.screeningAnswers).toHaveProperty('cleanlinessModel', {
      status: 'UNAVAILABLE', pDirty: null, band: null, modelVersion: null, latencyMs: 15000, reason: 'TIMEOUT', fixtureType: 'SINK',
    });
  });

  it('starts model scoring while the CLEF response is pending', async () => {
    let releaseClef!: () => void;
    const pendingClef = new Promise<void>(resolve => { releaseClef = resolve; });
    const fetchClef = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await pendingClef;
      return replyTo(init?.body, {});
    });
    vi.stubGlobal('fetch', fetchClef);
    const assessment = evaluate('SINK', 'basin_tap');
    try {
      expect(fetchClef).toHaveBeenCalledTimes(1);
      expect(score).toHaveBeenCalledExactlyOnceWith(image);
    } finally {
      releaseClef();
      await assessment;
    }
  });

  it('keeps the CLEF 500 failure and handles a model rejection after it throws', async () => {
    vi.useFakeTimers();
    let rejectScore!: (error: Error) => void;
    score.mockReturnValue(new Promise((_resolve, reject) => { rejectScore = reject; }));
    const fetchClef = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetchClef);

    for (const mode of ['local-model', 'clef']) {
      vi.stubEnv('CLEANLINESS_PROVIDER', mode);
      const failed = expect(evaluate('SINK', 'basin_tap')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      await vi.runAllTimersAsync();
      await failed;
    }
    expect(fetchClef).toHaveBeenCalledTimes(4);
    expect(score).toHaveBeenCalledTimes(1);
    rejectScore(new Error('model scorer rejected'));
    await vi.runAllTimersAsync();
  });

  it('only screens originality for a context photo', async () => {
    const fetchClef = mockClef();
    const assessment = await provider.evaluate(image);
    const request: ClefRequest = JSON.parse(String(fetchClef.mock.calls[0][1]?.body));
    expect(Object.keys(request.questions)).toEqual(['originality']);
    expect(score).not.toHaveBeenCalled();
    expect(assessment.cleanliness).toBeNull();
    expect(assessment.metadata.screeningAnswers).not.toHaveProperty('cleanliness');
    expect(assessment.metadata.screeningAnswers).not.toHaveProperty('cleanlinessModel');
  });

  it('rejects an empty fixture rubric before requesting either provider', async () => {
    const fetchClef = mockClef();
    await expect(evaluate('SINK', 'basin_tap', [])).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(fetchClef).not.toHaveBeenCalled();
    expect(score).not.toHaveBeenCalled();
  });

  it('keeps the existing evaluator version in clef mode and hashes the model identity in local mode', () => {
    const localVersion = bufferedEvaluatorVersion();
    vi.stubEnv('LOCAL_CLEANLINESS_MODEL_ID', 'other-model');
    expect(bufferedEvaluatorVersion()).not.toEqual(localVersion);

    const legacyHash = createHash('sha256').update(JSON.stringify({ model: 'clef', timeoutMs: 30000 })).digest('hex');
    vi.stubEnv('CLEANLINESS_PROVIDER', 'clef');
    const clefVersion = bufferedEvaluatorVersion();
    expect(clefVersion).toBe(`photo-categories-v7-${legacyHash.slice(0, 20)}`);
    expect(localVersion).not.toEqual(clefVersion);
    vi.stubEnv('CLEANLINESS_PROVIDER', undefined);
    expect(bufferedEvaluatorVersion()).toBe(clefVersion);
  });
});
