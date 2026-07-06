import { Router } from 'express';
import multer from 'multer';
import { verifyJwt } from '../middlewares/auth.middleware.js';
import authorize from '../middlewares/authorize.middleware.js';
import { accountAccess } from '../middlewares/accountAccess.middleware.js';
import { requireLocationAccess } from '../services/verification-v2/authorization.service.js';
import { MAX_IMPORT_BYTES, staffTemplate, previewStaffImport, confirmStaffImport } from '../services/staffImport.service.js';
import { ApiError } from '../utils/ApiError.js';
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 1, fieldSize: 4096, parts: 3 } });
router.use('/:id/staff-import', verifyJwt, authorize('ADMIN', 'MANAGER'), accountAccess('ADD_CAPACITY'));
router.get('/:id/staff-import/template', async (req,res) => {
  await requireLocationAccess(req.user!, Number(req.params.id));
  res.setHeader('Cache-Control','no-store');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('staff-template.xlsx').send(Buffer.from(await staffTemplate()));
});
router.post('/:id/staff-import/:action', (req,res,next) => upload.single('file')(req,res,error => next(error ? new ApiError(400,'Choose one spreadsheet smaller than 1 MB.') : undefined)), async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  if (!req.file) throw new ApiError(400,'Choose a spreadsheet.');
  const args = [req.user!, Number(req.params.id), req.file.buffer, req.file.originalname] as const;
  if (req.params.action === 'preview') res.json({ data: await previewStaffImport(...args) });
  else if (req.params.action === 'confirm' && typeof req.body.token === 'string') res.json({ data: await confirmStaffImport(...args, req.body.token) });
  else throw new ApiError(400,'Invalid import action.');
});
export default router;
