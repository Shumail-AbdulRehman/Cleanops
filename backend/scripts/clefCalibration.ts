import {readFile,writeFile} from 'node:fs/promises';
import {calibrateCleanliness,digest} from '../src/services/verification-v2/cleanlinessRelease.js';
const [input,output,thresholdVersion]=process.argv.slice(2);
if(!input||!output||!thresholdVersion)throw new Error('Usage: verification:clef-calibrate development-predictions.json calibration.json threshold-version');
const bytes=await readFile(input);
const calibration=calibrateCleanliness(JSON.parse(bytes.toString('utf8')),digest(bytes),thresholdVersion);
await writeFile(output,JSON.stringify(calibration,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({candidateThreshold:calibration.threshold,thresholdVersion:calibration.thresholdVersion,fixtureTypes:calibration.fixtureTypes,automaticPassing:false}));
