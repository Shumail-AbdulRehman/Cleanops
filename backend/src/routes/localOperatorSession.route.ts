import { Router } from 'express';
import { localOperatorSessions } from '../services/localOperatorSession.service.js';
const router = Router();
router.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
router.get('/',(req,res)=>res.json({data:localOperatorSessions.status(req)}));
router.post('/login',async(req,res)=>{
  const session=await localOperatorSessions.login(req,req.body);
  res.cookie(session.cookie.name,session.token,{...session.cookie.options,expires:session.expiresAt})
    .json({data:{authenticated:true,email:session.email,expiresAt:session.expiresAt}});
});
router.post('/logout',(req,res)=>{
  const cookie=localOperatorSessions.logout(req);
  res.clearCookie(cookie.name,cookie.options).json({data:{authenticated:false}});
});
export default router;
