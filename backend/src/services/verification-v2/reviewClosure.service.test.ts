import {expect,it,vi} from 'vitest';
vi.mock('../../prisma/prisma.js',()=>({prisma:{}}));
import {closeReviewSchema} from './reviewClosure.service.js';
const base={requestId:'00000000-0000-4000-8000-000000000001',expectedVersion:1,note:'Manager checked the circumstances.'};
it('requires an explicit staff member and category for KPI reports',()=>{
 expect(closeReviewSchema.safeParse({...base,action:'RECORD_PERFORMANCE_ISSUE'}).success).toBe(false);
 expect(closeReviewSchema.safeParse({...base,action:'RECORD_PERFORMANCE_ISSUE',staffId:1,category:'MISSING_PHOTOS'}).success).toBe(true);
});
it('requires a real manager note and forbids staff attribution on a plain resolution',()=>{
 expect(closeReviewSchema.safeParse({...base,action:'RESOLVE_REVIEW'}).success).toBe(true);
 expect(closeReviewSchema.safeParse({...base,action:'RESOLVE_REVIEW',staffId:1,category:'OTHER'}).success).toBe(false);
 expect(closeReviewSchema.safeParse({...base,action:'RESOLVE_REVIEW',note:'  '}).success).toBe(false);
});
it('does not accept photo requests or arbitrary performance categories',()=>{
 expect(closeReviewSchema.safeParse({...base,action:'REQUEST_RECAPTURE'}).success).toBe(false);
 expect(closeReviewSchema.safeParse({...base,action:'RECORD_PERFORMANCE_ISSUE',staffId:1,category:'AUTOMATIC_PENALTY'}).success).toBe(false);
});
