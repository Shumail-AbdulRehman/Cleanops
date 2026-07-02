import {readFile,writeFile} from 'node:fs/promises';
import {createCleanlinessRelease,digest} from '../src/services/verification-v2/cleanlinessRelease.js';
const [input,calibrationPath,reviewPath,output]=process.argv.slice(2);
if(!input||!calibrationPath||!reviewPath||!output)throw new Error('Usage: verification:clef-release heldout-predictions.json calibration.json independent-review.json release.json');
const [bytes,calibrationBytes,reviewBytes]=await Promise.all([readFile(input),readFile(calibrationPath),readFile(reviewPath)]);
const record=createCleanlinessRelease(JSON.parse(bytes.toString('utf8')),JSON.parse(calibrationBytes.toString('utf8')),JSON.parse(reviewBytes.toString('utf8')),digest(bytes));
const encoded=JSON.stringify(record,null,2)+'\n';await writeFile(output,encoded,{flag:'wx'});
console.log(JSON.stringify({eligibleFixtureTypes:record.eligibleFixtureTypes,releaseSha256:digest(encoded),deploymentChanged:false,instructions:'Review the artifact, then configure CLEF_RELEASE_RECORD_PATH and CLEF_RELEASE_RECORD_SHA256 on the backend and worker with the exact evaluated threshold/model/version.'}));
