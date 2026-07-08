import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BufferedClefProvider, bufferedEvaluatorVersion } from './bufferedPhoto.provider.js';
import {bufferedDecision} from './photoResultPolicy.js';
const rubric = { version: 1, criteria: ['No removable dirt'], views: [{ key: 'basin_tap' }], surfacesByView: { basin_tap: ['basin', 'tap'] } };
let choices: Record<string, string>;
beforeEach(() => {
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'a'.repeat(32)); vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test'); vi.stubEnv('CLEF_MODEL', 'clef'); vi.stubEnv('CLEF_SCREENING_CONFIDENCE_THRESHOLD', '.9'); vi.stubEnv('CLEF_CONFIDENCE_THRESHOLD', '.9'); vi.stubEnv('CLEF_THRESHOLD_VERSION', 'test-v1');
  choices = { originality: 'DIRECT', object_match: 'MATCH', surface_0: 'CLEAN', surface_1: 'CLEAN' };
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function mock() {
  const request = vi.fn(async (_url, options) => {
    const body = JSON.parse(options.body), answers = Object.fromEntries(Object.entries(body.questions).map(([key, value]: [string, any]) => {
      const options = Object.keys(value.criteria), choice = choices[key] ?? (key.startsWith('visible_')?'VISIBLE':'NEEDS_ATTENTION');
      return [key, { type: 'choice', choice, confidence: .98, probabilities: Object.fromEntries(options.map(o => [o, o === choice ? .98 : .02 / (options.length - 1)])) }];
    }));
    return new Response(JSON.stringify({ success: true, result: { model: 'clef', answers } }));
  }); vi.stubGlobal('fetch', request); return request;
}
it('one request checks the required object and view alongside cleanliness and screen recapture', async () => {
  const request = mock(), result = await new BufferedClefProvider().evaluate(Buffer.from('sanitized'), rubric, 'basin_tap', 'SINK');
  expect(result.cleanliness?.verdict).toBe('CLEAN'); expect(request).toHaveBeenCalledOnce();
  const body = JSON.parse(request.mock.calls[0]![1].body);
  expect(Object.keys(body.questions)).toEqual(['originality', 'object_match', 'visible_surface_0', 'surface_0', 'visible_surface_1', 'surface_1']);
  expect(result.objectMatch).toBe('MATCH');
  expect(body.state.expected).toEqual({fixtureType:'SINK',view:'basin_tap',requiredSurfaces:['basin','tap']});
  expect(body.questions).not.toHaveProperty('privacy');
  expect(body.questions).not.toHaveProperty('identity');
});
it.each(['DIRTY', 'NEEDS_ATTENTION'] as const)('returns %s without fabricating success', async verdict => {
  choices.surface_0 = verdict; mock();
  expect((await new BufferedClefProvider().evaluate(Buffer.from('sanitized'), rubric, 'basin_tap', 'SINK')).cleanliness?.verdict).toBe(verdict === 'NEEDS_ATTENTION' ? 'CANNOT_ASSESS' : verdict);
});
it('context images have only the originality question, not fixture or privacy checks', async () => {
  const request = mock(), result = await new BufferedClefProvider().evaluate(Buffer.from('sanitized'));
  expect(result.cleanliness).toBeNull(); expect(Object.keys(JSON.parse(request.mock.calls[0]![1].body).questions)).toEqual(['originality']);
});
it('malformed responses and outages throw service failures, never dirty results', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { model: 'clef', answers: {} } }))));
  await expect(new BufferedClefProvider().evaluate(Buffer.from('sanitized'), rubric, 'basin_tap', 'SINK')).rejects.toMatchObject({ code: 'PROVIDER_MALFORMED' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
  await expect(new BufferedClefProvider().evaluate(Buffer.from('sanitized'), rubric, 'basin_tap', 'SINK')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
});

it('without confidence configuration, model categories are preserved and approval is a separate gate', async () => {
  vi.stubEnv('CLEF_CONFIDENCE_THRESHOLD', '');choices.surface_0='DIRTY';mock();
  const dirty=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),rubric,'basin_tap','SINK');
  expect(dirty.cleanliness?.surfaces[0]?.verdict).toBe('DIRTY');
  choices.surface_0='CLEAN';mock();
  expect((await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),rubric,'basin_tap','SINK')).cleanliness?.verdict).toBe('CLEAN');
});

it.each(['WRONG_ITEM', 'MISSING_SURFACE', 'UNCERTAIN'])('records %s for an object/view mismatch', async verdict => {
  if(verdict==='MISSING_SURFACE')choices.visible_surface_0='MISSING';else choices.object_match=verdict==='WRONG_ITEM'?'NOT_MATCH':'NOT_SURE'; mock();
  const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'), rubric, 'basin_tap', 'SINK');
  expect(verdict==='MISSING_SURFACE'?result.viewMatch:result.objectMatch).toBe(verdict);
});

it('uses the selected MATCH category regardless of its diagnostic confidence', async () => {
  mock();
  const request = fetch;
  vi.stubGlobal('fetch', vi.fn(async (...args: Parameters<typeof fetch>) => {
    const response = await request(...args), body = await response.json();
    body.result.answers.object_match.confidence = .5;
    return new Response(JSON.stringify(body));
  }));
  expect((await new BufferedClefProvider().evaluate(Buffer.from('sanitized'), rubric, 'basin_tap', 'SINK')).objectMatch).toBe('MATCH');
});

it('requires the expected category from the server and invalidates older assessment caches', async () => {
  const request = mock();
  await expect(new BufferedClefProvider().evaluate(Buffer.from('sanitized'), rubric, 'basin_tap')).rejects.toMatchObject({code:'PROVIDER_CONFIGURATION_INVALID'});
  expect(request).not.toHaveBeenCalled();
  expect(bufferedEvaluatorVersion()).toMatch(/^photo-categories-v7-/);
});

const toiletRubric={version:1,criteria:['No removable dirt'],views:[{key:'bowl_seat'},{key:'exterior_base'}],surfacesByView:{bowl_seat:['bowl','seat'],exterior_base:['exterior','base']}};
const indianRubric={version:1,criteria:['No removable dirt'],views:[{key:'squat_pan'}],surfacesByView:{squat_pan:['pan']}};
it('checks a configured Indian toilet with one object check and one pan, without style or footrest questions',async()=>{
 choices.surface_0='CLEAN';const request=mock();
 const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),indianRubric,'squat_pan','INDIAN_TOILET');
 expect(result).toMatchObject({objectMatch:'MATCH',toiletStyle:'SQUAT',viewMatch:'MATCH',cleanliness:{verdict:'CLEAN',surfaces:[{surface:'pan',verdict:'CLEAN'}]}});
 const body=JSON.parse(request.mock.calls[0]![1].body);
 expect(request).toHaveBeenCalledOnce();
 expect(Object.keys(body.questions)).toEqual(['originality','object_match','visible_surface_0','surface_0']);
 expect(body.state.expected).toEqual({fixtureType:'INDIAN_TOILET',view:'squat_pan',requiredSurfaces:['pan']});
 expect(body.questions.object_match.instructions).toContain('floor-level toilet pan');
 expect(body.questions.object_match.instructions).toContain('A Western seated toilet is NOT_MATCH');
});
it('checks a configured Western toilet without asking the model to select another toilet design',async()=>{
 const request=mock();
 const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),toiletRubric,'bowl_seat','WESTERN_TOILET');
 expect(result).toMatchObject({objectMatch:'MATCH',toiletStyle:'WESTERN',cleanliness:{surfaces:[{surface:'bowl'},{surface:'seat'}]}});
 const body=JSON.parse(request.mock.calls[0]![1].body);
 expect(body.questions).not.toHaveProperty('toilet_style');
 expect(body.questions.object_match.instructions).toContain('An Indian/squat toilet is NOT_MATCH');
});
it.each(['INDIAN_TOILET','WESTERN_TOILET'])('a wrong toilet design is rejected for %s even when the shown surfaces look clean',async fixture=>{
 choices.object_match='NOT_MATCH';mock();
 const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),fixture==='INDIAN_TOILET'?indianRubric:toiletRubric,fixture==='INDIAN_TOILET'?'squat_pan':'bowl_seat',fixture);
 expect(bufferedDecision(result,false,true)).toEqual({state:'RECAPTURE_REQUIRED',reason:'WRONG_ITEM',keep:false});
});
it.each([
  ['SQUAT','bowl_seat',['pan','drain','footrests']],
  ['WESTERN','bowl_seat',['bowl','seat']],
  ['SQUAT','exterior_base',['pan_edges','surrounding_floor']],
  ['WESTERN','exterior_base',['exterior','base']],
] as const)('accepts %s for toilet %s and only assesses its actual parts',async(style,view,surfaces)=>{
  choices.toilet_style=style;
  for(let i=0;i<surfaces.length;i++)choices[`${style.toLowerCase()}_surface_${i}`]='CLEAN';
  const request=mock();
  const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),toiletRubric,view,'TOILET');
  expect(result).toMatchObject({objectMatch:'MATCH',toiletStyle:style,cleanliness:{verdict:'CLEAN'}});
  expect(result.cleanliness?.surfaces.map(s=>s.surface)).toEqual([...surfaces]);
  expect(bufferedDecision(result,true,true).state).toBe('PASSED');
  expect(request).toHaveBeenCalledOnce();
  const body=JSON.parse(request.mock.calls[0]![1].body);
  expect(body.state.expected).not.toHaveProperty('requiredSurfaces');
  expect(body.state.expected.acceptableToiletViews).toHaveLength(2);
  expect(body.questions.object_match.instructions).toContain('Do not require a seat or raised pedestal');
});

it('a dirty Indian toilet still requires cleaning',async()=>{
  Object.assign(choices,{toilet_style:'SQUAT',squat_surface_0:'DIRTY',squat_surface_1:'CLEAN',squat_surface_2:'CLEAN'});mock();
  const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),toiletRubric,'bowl_seat','TOILET');
  expect(bufferedDecision(result,true,true)).toMatchObject({state:'CLEANING_REQUIRED',keep:true});
  expect(result.cleanliness?.surfaces[0]).toEqual({surface:'pan',verdict:'DIRTY'});
});

it.each(['WRONG_ITEM','MISSING_SURFACE'] as const)('support for Indian toilets does not bypass %s',async objectMatch=>{
  Object.assign(choices,{toilet_style:'SQUAT',object_match:objectMatch==='MISSING_SURFACE'?'MATCH':'NOT_MATCH',squat_surface_0:'CLEAN',squat_surface_1:'CLEAN',squat_surface_2:'CLEAN',...(objectMatch==='MISSING_SURFACE'?{visible_squat_surface_0:'MISSING'}:{})});mock();
  const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),toiletRubric,'bowl_seat','TOILET');
  expect(bufferedDecision(result,true,true)).toMatchObject({state:'RECAPTURE_REQUIRED',reason:objectMatch,keep:false});
});

it('an uncertain toilet design cannot silently select Western surfaces or pass',async()=>{
  choices.toilet_style='UNCERTAIN';mock();
  const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),toiletRubric,'bowl_seat','TOILET');
  expect(result).toMatchObject({toiletStyle:'UNCERTAIN',objectMatch:'MATCH',viewMatch:'UNCERTAIN',cleanliness:null});
  expect(bufferedDecision(result,true,true)).toMatchObject({state:'REVIEW_REQUIRED',reason:'VIEW_UNCERTAIN'});
});

it('checks object category and each required part as separate questions',async()=>{
 const request=mock();
 const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),rubric,'basin_tap','SINK');
 const body=JSON.parse(request.mock.calls[0]![1].body);
 expect(Object.keys(body.questions.object_match.criteria)).toEqual(['MATCH','NOT_MATCH','NOT_SURE']);
 expect(body.questions.object_match.instructions).toContain('Part visibility is checked separately');
 expect(body.questions.visible_surface_0.instructions).toContain('A dirty surface can still be fully visible');
 expect(result).toMatchObject({objectMatch:'MATCH',viewMatch:'MATCH',missingSurfaces:[]});
});
it('names a confirmed missing part independently from the object and dirt checks',async()=>{
 choices.visible_surface_1='MISSING';choices.surface_0='DIRTY';mock();
 const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),rubric,'basin_tap','SINK');
 expect(result).toMatchObject({objectMatch:'MATCH',viewMatch:'MISSING_SURFACE',missingSurfaces:['tap']});
 expect(bufferedDecision(result,true,true)).toMatchObject({state:'RECAPTURE_REQUIRED',reason:'MISSING_SURFACE'});
});
it('uses an explicit missing-part category regardless of diagnostic confidence',async()=>{
 choices.visible_surface_1='MISSING';mock();const request=fetch;
 vi.stubGlobal('fetch',vi.fn(async(...args:Parameters<typeof fetch>)=>{
  const response=await request(...args),body=await response.json();body.result.answers.visible_surface_1.confidence=.4;
  return new Response(JSON.stringify(body));
 }));
 const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),rubric,'basin_tap','SINK');
 expect(result).toMatchObject({objectMatch:'MATCH',viewMatch:'MISSING_SURFACE',missingSurfaces:['tap']});
 expect(bufferedDecision(result,true,true)).toMatchObject({state:'RECAPTURE_REQUIRED',reason:'MISSING_SURFACE'});
});
it('a selected squat-toilet match with visible dirt requests cleaning even with a low diagnostic score',async()=>{
 Object.assign(choices,{toilet_style:'SQUAT',squat_surface_0:'DIRTY',squat_surface_1:'DIRTY',squat_surface_2:'DIRTY'});mock();const request=fetch;
 vi.stubGlobal('fetch',vi.fn(async(...args:Parameters<typeof fetch>)=>{
  const response=await request(...args),body=await response.json();body.result.answers.object_match.confidence=.4325;
  return new Response(JSON.stringify(body));
 }));
 const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),toiletRubric,'bowl_seat','TOILET');
 expect(result.toiletStyle).toBe('SQUAT');
 expect(bufferedDecision(result,true,true)).toEqual({state:'CLEANING_REQUIRED',reason:'CLEANING_REQUIRED',keep:true});
});

it('preserves a wrong-object category with the recorded diagnostic scores',async()=>{
 choices.object_match='NOT_MATCH';choices.surface_0='NEEDS_ATTENTION';mock();const request=fetch;
 vi.stubGlobal('fetch',vi.fn(async(...args:Parameters<typeof fetch>)=>{
  const response=await request(...args),body=await response.json();
  body.result.answers.object_match={type:'choice',choice:'NOT_MATCH',confidence:.8758,probabilities:{MATCH:.014,NOT_SURE:.0288,NOT_MATCH:.9572}};
  body.result.answers.originality={type:'choice',choice:'DIRECT',confidence:.6446,probabilities:{DIRECT:.8686,UNCERTAIN:.0635,SCREEN_RECAPTURE:.0679}};
  return new Response(JSON.stringify(body));
 }));
 const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),indianRubric,'squat_pan','INDIAN_TOILET');
 expect(result.objectMatch).toBe('WRONG_ITEM');
 expect(bufferedDecision(result,false,true)).toEqual({state:'RECAPTURE_REQUIRED',reason:'WRONG_ITEM',keep:false});
});
it.each([0,.4,.8999])('wrong objects at confidence %s require a new photo, without enabling a match',async confidence=>{
 choices.object_match='NOT_MATCH';mock();const request=fetch;
 vi.stubGlobal('fetch',vi.fn(async(...args:Parameters<typeof fetch>)=>{
  const response=await request(...args),body=await response.json();body.result.answers.object_match.confidence=confidence;
  return new Response(JSON.stringify(body));
 }));
 const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),indianRubric,'squat_pan','INDIAN_TOILET');
 expect(bufferedDecision(result,true,true)).toEqual({state:'RECAPTURE_REQUIRED',reason:'WRONG_ITEM',keep:false});
});
it('a MATCH category satisfies the object check even below the former threshold',async()=>{
 mock();const request=fetch;
 vi.stubGlobal('fetch',vi.fn(async(...args:Parameters<typeof fetch>)=>{
  const response=await request(...args),body=await response.json();body.result.answers.object_match.confidence=.8758;
  return new Response(JSON.stringify(body));
 }));
 const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),indianRubric,'squat_pan','INDIAN_TOILET');
 expect(result.objectMatch).toBe('MATCH');expect(bufferedDecision(result,true,true).state).toBe('PASSED');
});
it('the selected NOT_MATCH category is authoritative even when diagnostic probabilities tie',async()=>{
 mock();const request=fetch;
 vi.stubGlobal('fetch',vi.fn(async(...args:Parameters<typeof fetch>)=>{
  const response=await request(...args),body=await response.json();body.result.answers.object_match={type:'choice',choice:'NOT_MATCH',confidence:.98,probabilities:{MATCH:.5,NOT_MATCH:.5,NOT_SURE:0}};
  return new Response(JSON.stringify(body));
 }));
 const result=await new BufferedClefProvider().evaluate(Buffer.from('sanitized'),indianRubric,'squat_pan','INDIAN_TOILET');
 expect(result.objectMatch).toBe('WRONG_ITEM');
});

it.each(['CLEAN', 'DIRTY', 'NEEDS_ATTENTION'] as const)('preserves the model category %s across diagnostic scores, without threshold configuration', async choice => {
  choices.surface_0 = choice; choices.surface_1 = choice;
  vi.stubEnv('CLEF_CONFIDENCE_THRESHOLD', '');
  vi.stubEnv('CLEF_SCREENING_CONFIDENCE_THRESHOLD', '.99');
  mock(); const request = fetch;
  for (const confidence of [0, .01, .8498, 1]) {
    vi.stubGlobal('fetch', vi.fn(async (...args: Parameters<typeof fetch>) => {
      const response = await request(...args), body = await response.json();
      for (const answer of Object.values(body.result.answers) as any[]) answer.confidence = confidence;
      return new Response(JSON.stringify(body));
    }));
    const result = await new BufferedClefProvider().evaluate(Buffer.from('sanitized'), rubric, 'basin_tap', 'SINK');
    expect(result).toMatchObject({objectMatch: 'MATCH', viewMatch: 'MATCH', originality: 'DIRECT',
      cleanliness: {verdict: choice === 'NEEDS_ATTENTION' ? 'CANNOT_ASSESS' : choice, confidence: null},
      metadata: {decisionMode: 'MODEL_CATEGORIES_V1', screeningAnswers: {cleanliness: {surface_0: {choice, confidence}}}}});
    expect(bufferedDecision(result, true, true).state).toBe(choice === 'CLEAN' ? 'PASSED' : choice === 'DIRTY' ? 'CLEANING_REQUIRED' : 'REVIEW_REQUIRED');
  }
});

it('defines the requested categories and leaves genuine object uncertainty to the model', async () => {
  choices.object_match = 'NOT_SURE'; choices.surface_0 = 'NEEDS_ATTENTION';
  const request = mock();
  const result = await new BufferedClefProvider().evaluate(Buffer.from('sanitized'), rubric, 'basin_tap', 'SINK');
  const body = JSON.parse(request.mock.calls[0]![1].body);
  expect(Object.keys(body.questions.surface_0.criteria)).toEqual(['CLEAN', 'DIRTY', 'NEEDS_ATTENTION']);
  expect(body.questions.surface_0.instructions).toContain('permanent discoloration or damage');
  expect(bufferedDecision(result, true, true)).toEqual({state:'REVIEW_REQUIRED',reason:'OBJECT_UNCERTAIN',keep:true});
});

it('ignores retired confidence settings in the active evaluator configuration and cache version', () => {
  const version = bufferedEvaluatorVersion();
  vi.stubEnv('CLEF_CONFIDENCE_THRESHOLD', 'invalid-retired-setting');
  vi.stubEnv('CLEF_SCREENING_CONFIDENCE_THRESHOLD', 'invalid-retired-setting');
  vi.stubEnv('CLEF_THRESHOLD_VERSION', '');
  expect(bufferedEvaluatorVersion()).toBe(version);
});

it('rejects an unknown category rather than silently creating a classification', async () => {
  choices.object_match = 'OTHER'; mock();
  await expect(new BufferedClefProvider().evaluate(Buffer.from('sanitized'), rubric, 'basin_tap', 'SINK'))
    .rejects.toMatchObject({code: 'PROVIDER_MALFORMED'});
});
