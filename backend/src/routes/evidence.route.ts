import {Router} from 'express';
import {z} from 'zod';
import {verifyJwt} from '../middlewares/auth.middleware.js';
import {ApiError} from '../utils/ApiError.js';
import {evidenceContent} from '../services/verification-v2/evidence.service.js';
const router=Router();router.use(verifyJwt);
router.get('/:assetId/content',async (req,res)=>{
 const id=z.uuid().safeParse(req.params.assetId);const variant=z.enum(['original','review']).safeParse(req.query.variant??'review');
 if(!id.success||!variant.success)throw new ApiError(400,'Invalid evidence request');
 const data=await evidenceContent(req.user!,id.data,variant.data);
 res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Type':`image/${data.format}`}).send(data.bytes);
});
export default router;
