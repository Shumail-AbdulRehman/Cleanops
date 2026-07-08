/** Reviewed visible criteria; no claim about sanitation or invisible contamination. */
export const visibleRubricV1={version:1,criteria:['Required surface is fully visible and assessable.','No visible loose waste, soil, residue or pooled liquid on the required surface.','Distinguish permanent wear, discoloration or damage from removable dirt.','If visibility or condition is ambiguous return CANNOT_ASSESS.'],outcomes:{CLEAN:'All visible required surfaces meet criteria.',DIRTY:'Visible removable dirt, waste, soiling or localized residue needs cleaning.',CANNOT_ASSESS:'Visibility or interpretation cannot support a cleanliness decision.'}};

/** Compound preset views are assessed surface by surface, never as one opaque view. */
export const viewSurfaces:Record<string,string[]>={bowl_seat:['bowl','seat'],exterior_base:['exterior','base'],squat_pan:['pan'],basin_tap:['basin','drain','tap'],reflective_surface:['reflective_surface'],opening_interior:['opening','interior'],exterior:['exterior','surrounding_floor'],wide_zone:['whole_floor_zone']};
export function requiredRubricSurfaces(rubric:unknown,view:string):string[]{
 const r=rubric as {version?:unknown;criteria?:unknown;views?:{key:string}[];surfacesByView?:Record<string,unknown>};
 if(r?.version!==1||!Array.isArray(r.criteria)||!r.criteria.length||r.criteria.some(c=>typeof c!=='string'||!c.trim())||!Array.isArray(r.views)||!r.views.some(v=>v.key===view)||!r.surfacesByView||!Array.isArray(r.surfacesByView[view]))throw new Error('RUBRIC_REVIEW_REQUIRED');
 const surfaces=r.surfacesByView![view] as unknown[];
 if(!surfaces.length||surfaces.length>20||surfaces.some(s=>typeof s!=='string'||!s.trim()||s.length>100)||new Set(surfaces).size!==surfaces.length)throw new Error('RUBRIC_REVIEW_REQUIRED');
 return [...surfaces] as string[];
}
