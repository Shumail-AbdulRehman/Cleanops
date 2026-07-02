import {readFile,writeFile} from 'node:fs/promises';
import {spatialEvaluation} from '../src/services/verification-v2/spatialEvaluation.js';
const [input,output]=process.argv.slice(2);
const report=spatialEvaluation(input?JSON.parse(await readFile(input,'utf8')):[]);
if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));
