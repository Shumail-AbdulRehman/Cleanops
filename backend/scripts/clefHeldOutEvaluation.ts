import 'dotenv/config';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ClefCleanlinessProvider,clefConfiguration,clefEvaluatorVersion} from '../src/services/verification-v2/clef.provider.js';
import {benchmarkRowsSchema,benchmarkReport} from '../src/services/verification-v2/evaluatorBenchmark.js';
import {ProviderServiceFailure} from '../src/services/verification-v2/provider.service.js';
import {requiredRubricSurfaces} from '../src/services/verification-v2/rubrics.js';

// Private, sanitized JPEGs only. This command never connects to the task DB or grants credit.
const label=benchmarkRowsSchema.element.omit({predictedCleanliness:true,wouldAutoPass:true,provider:true,model:true,requestedModel:true,promptVersion:true,latencyMs:true,costUsd:true,confidence:true,threshold:true,thresholdVersion:true,providerVersion:true,evaluatorVersion:true,imageSha256:true,evaluationInputHash:true,assessment:true}).extend({imagePath:z.string().min(1),requiredView:z.string().min(1),rubric:z.unknown()}).strict();
const [manifestPath,outputPath,flag]=process.argv.slice(2);
if(!manifestPath||!outputPath||flag&&flag!=='--resume')throw new Error('Usage: verification:clef-evaluate manifest.json predictions.json [--resume]');
const labels=z.array(label).parse(JSON.parse(await readFile(manifestPath,'utf8')));
const config=clefConfiguration(),evaluatorVersion=clefEvaluatorVersion(),provider=new ClefCleanlinessProvider();
const baseRows=labels.map(({imagePath,requiredView,rubric,...r})=>({...r,predictedCleanliness:'CANNOT_ASSESS',wouldAutoPass:false,provider:'cloudflare',model:config.model,requestedModel:`@cf/cloudflare/${config.model}`,promptVersion:config.promptVersion,rubricVersion:(rubric as {version:number}).version,latencyMs:0,costUsd:null}));
// Validate IDs, consent, split leakage and frozen rubric version before any paid request.
benchmarkReport(baseRows);
for(const row of labels){requiredRubricSurfaces(row.rubric,row.requiredView);if(row.rubricVersion!==(row.rubric as {version:number}).version)throw new Error('Rubric version mismatch');if(row.privacySafe!==true)throw new Error('Every evaluation image must be independently cleared for privacy');}
let output:z.infer<typeof benchmarkRowsSchema>=flag==='--resume'?benchmarkRowsSchema.parse(JSON.parse(await readFile(outputPath,'utf8'))):[];
if(output.some(r=>!labels.some(label=>label.id===r.id)))throw new Error('Resume contains examples absent from the manifest');
if(!process.env.CLOUDFLARE_API_TOKEN||!/^[a-fA-F0-9]{32}$/.test(process.env.CLOUDFLARE_ACCOUNT_ID??''))throw new Error('Configure server-side Cloudflare token and account ID');
if(!flag)await writeFile(outputPath,'[]\n',{flag:'wx'});
for(const row of labels){
 const {imagePath,requiredView,rubric,...labelsOnly}=row;
 const image=await readFile(resolve(dirname(resolve(manifestPath)),imagePath));
 const imageSha256=createHash('sha256').update(image).digest('hex');
 const evaluationInputHash=createHash('sha256').update(JSON.stringify(row)).digest('hex');
 const existing=output.find(r=>r.id===row.id);
 if(existing){
  if(existing.evaluationInputHash!==evaluationInputHash||existing.evaluatorVersion!==evaluatorVersion||existing.imageSha256!==imageSha256||existing.rubricVersion!==(rubric as {version:number}).version||['roomId','fixtureId','fixtureType','split','visibility','identity','cleanliness'].some(k=>(existing as any)[k]!==(row as any)[k]))throw new Error(`Resume configuration/image/labels changed: ${row.id}`);
  continue; // Includes service failures: an explicit new run is needed to rebill them.
 }
 const started=Date.now();let prediction:any;
 try{
  const assessment=await provider.evaluate(image,rubric,requiredView,row.fixtureType);
  prediction={predictedCleanliness:assessment.result.verdict,confidence:assessment.result.confidence,model:assessment.metadata.model,latencyMs:assessment.metadata.latencyMs,costUsd:assessment.metadata.costUsd,assessment};
 }catch(error){
  if(!(error instanceof ProviderServiceFailure))throw error;
  prediction={predictedCleanliness:'SERVICE_FAILURE',confidence:null,model:config.model,latencyMs:Date.now()-started,costUsd:null,assessment:{status:'SERVICE_FAILURE',reasonCode:error.code,metadata:error.metadata}};
 }
 output.push({...labelsOnly,...prediction,wouldAutoPass:false,provider:'cloudflare',requestedModel:`@cf/cloudflare/${config.model}`,promptVersion:config.promptVersion,providerVersion:config.providerVersion,threshold:config.threshold,thresholdVersion:config.thresholdVersion,evaluatorVersion,imageSha256,evaluationInputHash});
 await writeFile(outputPath+'.tmp',JSON.stringify(output,null,2)+'\n',{flag:'w'});await rename(outputPath+'.tmp',outputPath);
 process.stdout.write(`${row.id}: ${prediction.predictedCleanliness}\n`);
}
process.stdout.write('Predictions saved. Run verification:benchmark to report them; automatic passing remains disabled.\n');
