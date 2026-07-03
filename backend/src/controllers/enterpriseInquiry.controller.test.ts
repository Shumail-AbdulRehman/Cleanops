import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
const save = vi.hoisted(() => vi.fn());
vi.mock('../prisma/prisma.js', () => ({ prisma: { enterpriseInquiry: { upsert: save } } }));
import { createEnterpriseInquiry } from './enterpriseInquiry.controller.js';
const body = { requestId: '5c6f75b6-82ea-4e25-b512-d5713bb96b44', name: ' Amina ', email: 'TEAM@EXAMPLE.COM', company: ' Office ', locations: 25, staff: 250, requirements: ' Multiple sites ' };
const response = () => { const json = vi.fn(); const status = vi.fn().mockReturnValue({ json }); return { json, status }; };
describe('enterprise inquiries', () => {
  beforeEach(() => { save.mockReset(); });
  it('saves normalized details with a stable id and returns no contact data', async () => {
    const res = response();
    await createEnterpriseInquiry({ body } as Request, res as unknown as Response);
    expect(save).toHaveBeenCalledWith({where:{id:body.requestId},create:{id:body.requestId,name:'Amina',email:'team@example.com',company:'Office',locations:25,staff:250,requirements:'Multiple sites'},update:{},select:{id:true}});
    expect(res.json.mock.calls[0][0].data).toEqual({received:true});
  });
  it('retry uses the same immutable upsert key', async () => {
    for(let i=0;i<2;i++) await createEnterpriseInquiry({body} as Request,response() as unknown as Response);
    expect(save.mock.calls[0][0]).toEqual(save.mock.calls[1][0]);
  });
  it.each([{email:'bad'},{name:' '},{staff:1.5},{locations:0},{requirements:'x'.repeat(4001)},{requestId:'bad'},{companyId:123}])('rejects invalid or unexpected fields %j', async (change) => {
    await expect(createEnterpriseInquiry({body:{...body,...change}} as Request,response() as unknown as Response)).rejects.toMatchObject({statusCode:400});
    expect(save).not.toHaveBeenCalled();
  });
  it('does not confirm receipt when persistence fails',async()=>{
    save.mockRejectedValue(new Error('offline'));const res=response();
    await expect(createEnterpriseInquiry({body} as Request,res as unknown as Response)).rejects.toThrow('offline');expect(res.json).not.toHaveBeenCalled();
  });
});
