import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ProviderServiceFailure} from './provider.service.js';

export function clefConfiguration(){
 const model=z.enum(['clef','clef-flash']).parse(process.env.CLEF_MODEL??'clef');
 const raw=process.env.CLEF_CONFIDENCE_THRESHOLD;
 const threshold=raw?.trim()?z.number().finite().min(0).max(1).parse(Number(raw)):null;
 const thresholdVersion=z.string().regex(/^[a-zA-Z0-9._-]{1,60}$/).parse(process.env.CLEF_THRESHOLD_VERSION??'unvalidated-no-threshold');
 if(threshold!==null&&!process.env.CLEF_THRESHOLD_VERSION)throw new ProviderServiceFailure('PROVIDER_THRESHOLD_NOT_VERSIONED');
 const timeoutMs=z.coerce.number().int().min(100).max(60000).parse(process.env.CLEF_TIMEOUT_MS??30000);
 return {model,threshold,thresholdVersion,timeoutMs,promptVersion:'clef-surfaces-v1',providerVersion:'cloudflare-system-one-v1'};
}
export function clefEvaluatorVersion(){
 const c=clefConfiguration();
 return 'clef-v1-'+createHash('sha256').update(JSON.stringify([c.model,c.threshold,c.thresholdVersion,c.promptVersion,c.providerVersion])).digest('hex').slice(0,24);
}
