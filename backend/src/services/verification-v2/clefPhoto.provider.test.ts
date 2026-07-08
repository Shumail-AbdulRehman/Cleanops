import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {ClefPhotoProvider,photoEvaluatorVersion} from './clefPhoto.provider.js';
const rubric={version:1,criteria:['No removable dirt'],views:[{key:'basin_tap'}],surfacesByView:{basin_tap:['basin','tap']}};
const expected={fixture:'SINK',view:'basin_tap',identity:{mode:'POSITION_HINT'},nameSnapshot:'Sink 1',order:1} as any;
let image:Buffer;
let choices:Record<string,string>;
beforeEach(async()=>{
 vi.stubEnv('CLOUDFLARE_ACCOUNT_ID','a'.repeat(32));vi.stubEnv('CLOUDFLARE_API_TOKEN','test-token');vi.stubEnv('CLEF_MODEL','clef');vi.stubEnv('CLEF_SCREENING_CONFIDENCE_THRESHOLD','.9');vi.stubEnv('CLEF_CONFIDENCE_THRESHOLD','.9');vi.stubEnv('CLEF_THRESHOLD_VERSION','test-v1');
 image=await sharp({create:{width:20,height:20,channels:3,background:'#fff'}}).jpeg().toBuffer();choices={privacy:'SAFE',coverage:'MATCH',identity:'MATCH',originality:'DIRECT',surface_0:'CLEAN',surface_1:'CLEAN'};
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
function mockClef(){const request=vi.fn(async(_url,options)=>{
 const body=JSON.parse(options.body),answers=Object.fromEntries(Object.entries(body.questions).map(([key,value]:[string,any])=>{
  const options=Object.keys(value.criteria),choice=choices[key]!;return [key,{type:'choice',choice,confidence:.98,probabilities:Object.fromEntries(options.map(option=>[option,option===choice?.98:.02/(options.length-1)]))}];
 }));return new Response(JSON.stringify({success:true,result:{model:'clef',answers,usage:{input_tokens:25}}}));
});vi.stubGlobal('fetch',request);return request;}
const evaluate=()=>new ClefPhotoProvider().evaluate(image,expected,rubric,'basin_tap');
it('checks object, privacy, originality and all cleanliness surfaces in a single Clef request',async()=>{
 const request=mockClef(),result=await evaluate();expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0]![0]).toContain('/cloudflare/clef');
 expect(result).toMatchObject({privacy:{status:'SAFE'},coverage:{verdict:'MATCH'},originality:{status:'DIRECT'},cleanliness:{result:{verdict:'CLEAN'}}});
 const body=JSON.parse(request.mock.calls[0]![1].body);expect(body.images).toHaveLength(1);expect(Object.keys(body.questions)).toEqual(['privacy','coverage','identity','originality','surface_0','surface_1']);
});
it.each(['WRONG_ITEM','MISSING_SURFACE','UNCERTAIN'])('keeps %s separate from a CLEAN surface prediction',async verdict=>{choices.coverage=verdict;mockClef();const result=await evaluate();expect(result.coverage.verdict).toBe(verdict);expect(result.coverage.identityConsistent).toBe(false);expect(result.cleanliness?.result.verdict).toBe('CLEAN');});
it.each(['SCREEN_RECAPTURE','UNCERTAIN'])('records %s as an origin issue rather than dirt',async originality=>{choices.originality=originality;mockClef();const result=await evaluate();expect(result.originality.status).toBe(originality);expect(result.cleanliness?.result.verdict).toBe('CLEAN');});
it('retains actual surface predictions when calibration is unavailable',async()=>{vi.stubEnv('CLEF_CONFIDENCE_THRESHOLD','');mockClef();const result=await evaluate();expect(result.cleanliness?.result).toMatchObject({verdict:'CANNOT_ASSESS',details:{assessmentStatus:'THRESHOLD_UNCONFIGURED',predictions:[{choice:'CLEAN'},{choice:'CLEAN'}]}});});
it('does not use an alternate provider on failure',async()=>{const request=vi.fn().mockResolvedValue(new Response('{}',{status:503}));vi.stubGlobal('fetch',request);await expect(evaluate()).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});expect(request).toHaveBeenCalledTimes(1);});
it('binds the joint evaluator to the screening and cleanliness policy',()=>{const version=photoEvaluatorVersion();vi.stubEnv('CLEF_SCREENING_CONFIDENCE_THRESHOLD','.95');expect(photoEvaluatorVersion()).not.toBe(version);});
