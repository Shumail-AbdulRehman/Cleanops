// Spec 70: a photo already kept as evidence is sent back for a retake before any AI or storage spend.
import {readFileSync} from 'node:fs';
import {beforeEach,describe,expect,it,vi} from 'vitest';
type Asset={id:string;companyId:number;locationId:number;areaId:number;taskInstanceId:number;sha256:string;normalizedHash:string;perceptualHash:string|null;privacyState:string;createdAt:Date;originalPublicId:string};
const m=vi.hoisted(()=>({attempt:null as any,assets:[] as Asset[],decision:vi.fn(),findFirst:vi.fn(),findMany:vi.fn(),info:null as any}));
// In-memory evidence table that honours exactly the filters the reuse check sends.
const kept=(a:Asset,w:any)=>a.companyId===w.companyId&&a.privacyState!==w.privacyState.not&&a.originalPublicId!==w.originalPublicId.not;
vi.mock('./launchQualification.js',()=>({requireLaunchPhotoQualification:vi.fn()}));
vi.mock('../../prisma/prisma.js',()=>({prisma:{
 evidenceAsset:{findFirst:m.findFirst,findMany:m.findMany},
 verificationAttempt:{updateMany:vi.fn(async({where,data}:any)=>{if(m.attempt.directProcessingToken!==where.directProcessingToken)return {count:0};Object.assign(m.attempt,data);return {count:1};}),findUniqueOrThrow:vi.fn(async()=>m.attempt),findUnique:vi.fn(async()=>m.attempt),update:vi.fn(async({data}:any)=>{Object.assign(m.attempt,data);return m.attempt;})},
 $transaction:vi.fn(async(fn:any)=>fn({verificationAttempt:{findUniqueOrThrow:async()=>m.attempt,update:async({data}:any)=>{Object.assign(m.attempt,data);return m.attempt;}},evidenceAsset:{upsert:async({create}:any)=>{m.attempt.media={id:'asset',...create};return m.attempt.media;}}}))
}}));
vi.mock('./authorization.service.js',()=>({requireTaskAccess:vi.fn()}));
vi.mock('./captureSession.service.js',()=>({lockTask:vi.fn(),staffAttemptResult:()=>({})}));
vi.mock('./quality.service.js',async importOriginal=>({...await importOriginal<object>(),sha256:()=> 'sha-new',inspectImage:async()=>m.info}));
vi.mock('./evidence.service.js',()=>({originalPublicId:()=> 'verification/1/attempts/a/original'}));
vi.mock('./photoDecision.service.js',()=>({applyLockedDecision:m.decision}));
vi.mock('./completion.service.js',()=>({finalizeTask:vi.fn()}));
vi.mock('./cleanliness.service.js',async importOriginal=>({...await importOriginal<object>(),autoPassAllowed:()=>false}));
import {processDirectPhoto,REUSED_PHOTO_AREA_LIMIT,REUSED_PHOTO_AREA_WINDOW_MS,REUSED_PHOTO_NEAR_DISTANCE} from './directPhoto.service.js';
import {staffPhotoInstructions} from './staffPhotoInstructions.js';
const actor={id:1,companyId:1,role:'STAFF' as const};
const clean={originality:'DIRECT' as const,objectMatch:'MATCH' as const,viewMatch:'MATCH' as const,cleanliness:{verdict:'CLEAN' as const,surfaces:[{surface:'basin',verdict:'CLEAN' as const}],confidence:.99,reasonCode:'CLEAN' as const},metadata:{} as any};
const HASH='0f0f0f0f0f0f0f0f';
// Flip n low bits of the stored hash: a perceptual distance of exactly n.
const at=(n:number)=>(BigInt('0x'+HASH)^((1n<<BigInt(n))-1n)).toString(16).padStart(16,'0');
const asset=(over:Partial<Asset>):Asset=>({id:'old',companyId:1,locationId:2,areaId:5,taskInstanceId:7,sha256:'sha-old',normalizedHash:'norm-old',perceptualHash:at(40),privacyState:'NOT_REQUIRED',createdAt:new Date(Date.now()-3600_000),originalPublicId:'verification/1/attempts/old/original',...over});
function run(){
 const evaluate=vi.fn(async()=>clean),store=vi.fn(async()=>({asset_id:'cloud'})),discard=vi.fn(async()=>{});
 return {evaluate,store,discard,result:processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate},store,discard)};
}
beforeEach(()=>{vi.clearAllMocks();
 m.info={sha256:'sha-new',normalizedHash:'norm-new',perceptualHash:HASH,hashVariants:[HASH,'ffffffffffffffff','0000000000000000'],format:'jpeg',bytes:5,width:1800,height:1200,sanitized:Buffer.from('sanitized'),quality:{acceptable:true}};
 m.attempt={id:'a',staffId:1,committedHash:'sha-new',state:'RESERVED',session:{taskInstanceId:7,areaId:5,task:{locationId:2}},requirement:{id:'r2',viewKey:'basin_tap',item:{typeSnapshot:'SINK',rubricSnapshot:{version:1}}},media:null,qualityResult:null,receivedAt:null};
 m.assets=[];
 m.decision.mockImplementation(async(_tx,_a,state)=>{m.attempt.state=state;});
 m.findFirst.mockImplementation(async({where}:any)=>m.assets.find(a=>kept(a,where)&&where.OR.some((o:any)=>o.sha256===a.sha256||o.normalizedHash===a.normalizedHash))??null);
 m.findMany.mockImplementation(async({where,take}:any)=>m.assets.filter(a=>kept(a,where)&&a.locationId===where.locationId&&a.areaId===where.task.areaId&&a.createdAt>=where.createdAt.gte&&a.perceptualHash!==null).slice(0,take));
});
async function expectRetake(r:ReturnType<typeof run>){
 expect(await r.result).toMatchObject({state:'RECAPTURE_REQUIRED',storage:'discarded'});
 expect(m.decision).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({id:'a'}),'RECAPTURE_REQUIRED','DUPLICATE_EVIDENCE',expect.anything());
 expect(r.evaluate).not.toHaveBeenCalled();expect(r.store).not.toHaveBeenCalled();expect(r.discard).not.toHaveBeenCalled();
 expect(m.attempt.media).toMatchObject({privacyState:'DISCARDED',sanitizedPublicId:null});
}
async function expectChecked(r:ReturnType<typeof run>){
 expect(await r.result).toMatchObject({state:'REVIEW_REQUIRED',storage:'cloud'});
 expect(r.evaluate).toHaveBeenCalledOnce();expect(r.store).toHaveBeenCalledTimes(2);
}

describe('reused photo: rejected before the AI and storage',()=>{
 it('rejects the exact same photo kept for another task in the same company, with no AI or storage call',async()=>{
  m.assets=[asset({sha256:'sha-new',taskInstanceId:99,areaId:77,locationId:9,createdAt:new Date(Date.now()-90*86400_000)})];
  await expectRetake(run());
 });
 it('rejects a re-encoded copy whose normalized bytes match a kept photo',async()=>{
  m.assets=[asset({normalizedHash:'norm-new',taskInstanceId:99,areaId:77})];
  await expectRetake(run());
 });
 it('rejects a near-duplicate of a kept photo in the same task (Sink 1 reused for Sink 2)',async()=>{
  m.assets=[asset({perceptualHash:at(REUSED_PHOTO_NEAR_DISTANCE)})];
  await expectRetake(run());
 });
 it('rejects a mirrored copy through the flipped hash variant',async()=>{
  m.info.hashVariants[1]=at(30);m.assets=[asset({perceptualHash:at(30)})];
  await expectRetake(run());
 });
 it('rejects a near-duplicate kept for another task in the same area within the window',async()=>{
  m.assets=[asset({taskInstanceId:8,perceptualHash:at(1),createdAt:new Date(Date.now()-REUSED_PHOTO_AREA_WINDOW_MS+60_000)})];
  await expectRetake(run());
 });
});

describe('reused photo: genuine photos still go to the check',()=>{
 it('accepts a different photo of the same item in the same task (distance just above the threshold)',async()=>{
  m.assets=[asset({perceptualHash:at(REUSED_PHOTO_NEAR_DISTANCE+2)})];
  await expectChecked(run());
 });
 it('does not block the identical photo kept by another company',async()=>{
  m.assets=[asset({companyId:2,sha256:'sha-new',normalizedHash:'norm-new',perceptualHash:HASH})];
  await expectChecked(run());
 });
 it('ignores earlier photos that were discarded (dirty, wrong item, retake)',async()=>{
  m.assets=[asset({sha256:'sha-new',perceptualHash:HASH,privacyState:'DISCARDED'})];
  await expectChecked(run());
 });
 it('ignores a near-duplicate from another area or older than the window',async()=>{
  m.assets=[asset({areaId:6,perceptualHash:HASH}),asset({id:'old2',taskInstanceId:8,perceptualHash:HASH,createdAt:new Date(Date.now()-REUSED_PHOTO_AREA_WINDOW_MS-60_000)})];
  await expectChecked(run());
 });
 it('never blocks the flow: a failed reuse check falls through to the normal check',async()=>{
  m.findFirst.mockRejectedValue(new Error('db down'));
  await expectChecked(run());
 });
 it('does not run the reuse check for a photo that already failed the quality check',async()=>{
  m.info.quality={acceptable:false,reasons:['PHOTO_BLURRY']};
  const r=run();expect(await r.result).toMatchObject({state:'RECAPTURE_REQUIRED'});
  expect(m.findFirst).not.toHaveBeenCalled();expect(r.evaluate).not.toHaveBeenCalled();
 });
});

describe('reused photo: bounded queries and staff message',()=>{
 it('exact match uses the company hash indexes; near match is bounded by location, area, window and count',async()=>{
  await run().result;
  expect(m.findFirst).toHaveBeenCalledWith({where:{companyId:1,privacyState:{not:'DISCARDED'},originalPublicId:{not:'verification/1/attempts/a/original'},OR:[{sha256:'sha-new'},{normalizedHash:'norm-new'}]},select:{id:true}});
  const near=m.findMany.mock.calls[0]![0];
  expect(near).toMatchObject({where:{companyId:1,locationId:2,task:{areaId:5},perceptualHash:{not:null}},orderBy:{createdAt:'desc'},take:REUSED_PHOTO_AREA_LIMIT});
  expect(Date.now()-near.where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(REUSED_PHOTO_AREA_WINDOW_MS);
  expect(Date.now()-near.where.createdAt.gte.getTime()).toBeLessThan(REUSED_PHOTO_AREA_WINDOW_MS+5_000);
 });
 it('staff see a retake with "This photo was already used."',()=>{
  expect(staffPhotoInstructions({state:'RECAPTURE_REQUIRED',reasonCode:'DUPLICATE_EVIDENCE',context:{fixtureType:'SINK'}})).toBe('This photo was already used. Please take a new photo of the sink.');
 });
 it('every retake text for a reused photo has Urdu in the staff app',()=>{
  const urdu=readFileSync(new URL('../../../../frontend-mobile/src/i18n/staffAppTranslations.ts',import.meta.url),'utf8');
  for(const fixtureType of ['TOILET','INDIAN_TOILET','WESTERN_TOILET','SINK','MIRROR','BIN','FLOOR',undefined]){
   const text=staffPhotoInstructions({state:'RECAPTURE_REQUIRED',reasonCode:'DUPLICATE_EVIDENCE',context:{fixtureType}})!;
   expect(urdu,text).toMatch(new RegExp(`"${text.replace(/[.]/g,'\\.')}": "[^"]*[\u0600-\u06FF][^"]*",`));
  }
 });
});

describe('reused photo: threshold against real image hashes',()=>{
 const fixture=(name:string)=>readFileSync(new URL(`../../../../docs/verification/evidence/photo-flow/${name}`,import.meta.url));
 it('a re-encoded, resized copy is within the threshold; two shots of the same sink are far outside it',async()=>{
  const {inspectImage,hammingDistance}=await vi.importActual<typeof import('./quality.service.js')>('./quality.service.js');
  const sharp=(await import('sharp')).default;
  const original=fixture('clean-synthetic.jpg');
  const [base,copy,otherShot]=await Promise.all([inspectImage(original),inspectImage(await sharp(original).resize(900).jpeg({quality:60}).toBuffer()),inspectImage(fixture('dirty-synthetic.jpg'))]);
  expect(hammingDistance(base.perceptualHash,copy.perceptualHash)).toBeLessThanOrEqual(REUSED_PHOTO_NEAR_DISTANCE);
  expect(copy.sha256).not.toBe(base.sha256);
  expect(hammingDistance(base.perceptualHash,otherShot.perceptualHash)).toBeGreaterThan(REUSED_PHOTO_NEAR_DISTANCE*4);
 });
});
