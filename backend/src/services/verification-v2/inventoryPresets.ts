import {toiletPhotoInstruction} from './toiletViews.js';
export const fixturePresets:Record<string,{name:string;views:{key:string;instructions:string}[]}>= {
 TOILET:{name:'Toilet',views:[{key:'bowl_seat',instructions:toiletPhotoInstruction('bowl_seat')!},{key:'exterior_base',instructions:toiletPhotoInstruction('exterior_base')!}]},
 INDIAN_TOILET:{name:'Indian toilet',views:[{key:'squat_pan',instructions:'Show the whole Indian toilet pan clearly.'}]},
 WESTERN_TOILET:{name:'Western toilet',views:[{key:'bowl_seat',instructions:'Show the whole toilet bowl and seat.'},{key:'exterior_base',instructions:'Show the outside and base of the toilet.'}]},
 SINK:{name:'Sink',views:[{key:'basin_tap',instructions:'Show the entire basin, drain and tap.'}]},
 MIRROR:{name:'Mirror',views:[{key:'reflective_surface',instructions:'Show the entire mirror. Keep people out of reflections.'}]},
 BIN:{name:'Bin',views:[{key:'opening_interior',instructions:'Show the bin opening and interior.'},{key:'exterior',instructions:'Show the exterior and surrounding floor.'}]},
 FLOOR:{name:'Floor zone',views:[{key:'wide_zone',instructions:'Show the whole configured floor zone.'}]},
};
export function expandCounts(counts:{fixtureType:string;count:number}[],existing:{stableCode:string;sequence:number}[]=[]) {
 const result:{stableCode:string;displayName:string;fixtureType:string;sequence:number;rubricKey:string;rubricVersion:number;requiredViews:{key:string;instructions:string}[]}[]=[];let sequence=Math.max(0,...existing.map(i=>i.sequence));
 for(const group of counts){if(!Number.isSafeInteger(group.count)||group.count<0||group.count>200)throw new Error('Count must be between 0 and 200');const type=group.fixtureType.toUpperCase();const preset=fixturePresets[type];if(!preset)throw new Error('Unsupported fixture type');
 let number=Math.max(0,...existing.concat(result).filter(i=>i.stableCode.startsWith(`${type}-`)).map(i=>Number(i.stableCode.split('-')[1])||0));
 for(let n=0;n<group.count;n++){number++;result.push({stableCode:`${type}-${String(number).padStart(2,'0')}`,displayName:`${preset.name} ${String(number).padStart(2,'0')}`,fixtureType:type,sequence:++sequence,rubricKey:type.toLowerCase(),rubricVersion:1,requiredViews:preset.views});}
 }return result;
}
