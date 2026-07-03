import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';

const inquirySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  company: z.string().trim().min(1).max(160),
  locations: z.number().int().min(1).max(1000000),
  staff: z.number().int().min(1).max(1000000),
  requirements: z.string().trim().min(1).max(4000),
  // Client-generated request ID makes retry after a lost response safe.
  requestId: z.uuid(),
}).strict();

export async function createEnterpriseInquiry(req: Request, res: Response) {
  const parsed = inquirySchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'Please provide valid contact details, team size, locations, and requirements.');
  const { requestId, ...details } = parsed.data;
  await prisma.enterpriseInquiry.upsert({
    where: { id: requestId },
    create: { id: requestId, ...details },
    update: {},
    select: { id: true },
  });
  res.status(201).json(new ApiResponse(201, { received: true }, 'Enterprise inquiry received'));
}
