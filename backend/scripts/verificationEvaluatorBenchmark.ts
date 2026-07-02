import {readFile,writeFile} from 'node:fs/promises';
import {benchmarkReport} from '../src/services/verification-v2/evaluatorBenchmark.js';
const args=process.argv.slice(2),requireTargets=args.includes('--require-targets');
const positional=args.filter(arg=>arg!=='--require-targets');
if(positional.length>2||positional.some(arg=>arg.startsWith('--')))throw new Error('Usage: verification:benchmark [results.json] [new-report.json] [--require-targets]');
const [input,output]=positional;
const report=benchmarkReport(input?JSON.parse(await readFile(input,'utf8')):[]);
const json=JSON.stringify(report,null,2)+'\n';
if(output)await writeFile(output,json,{flag:'wx'});else process.stdout.write(json);
// Opt-in release check. Reporting alone, including unavailable data, exits successfully.
if(requireTargets&&(!report.overall.targetMet||Object.values(report.perFixture).some(metrics=>!metrics.targetMet)))process.exitCode=1;
