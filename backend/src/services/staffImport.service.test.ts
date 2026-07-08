import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
const m=vi.hoisted(()=>({staff:vi.fn(),audit:vi.fn(),create:vi.fn(),lockStaff:vi.fn(),authorize:vi.fn(),capacity:vi.fn(),action:vi.fn(),state:vi.fn(),count:vi.fn()}));
vi.mock('../prisma/prisma.js',()=>({prisma:{staff:{findMany:m.staff,count:m.count},auditLog:{findFirst:m.audit}}}));
vi.mock('./verification-v2/authorization.service.js',()=>({requireOperationalRole:(actor:{role:string})=>{if(actor.role==='STAFF')throw Error('Denied');},requireLocationAccess:m.authorize}));
vi.mock('./accountAccess.service.js',()=>({assertAccountAction:m.action,readAccountState:m.state,withAccountCapacity:m.capacity}));
vi.mock('../utils/syncAttendanceWindow.js',()=>({prepareStaffAttendance:vi.fn()}));
vi.mock('./staffProvisioning.service.js',()=>({insertStaff:m.create,lockStaffIdentities:m.lockStaff}));
vi.mock('./auditLog.service.js',()=>({writeAuditLog:vi.fn()}));
import { HEADERS, parseStaffFile, staffTemplate, previewStaffImport, confirmStaffImport } from './staffImport.service.js';
const actor={id:1,companyId:1,role:'ADMIN' as const};
const csv=(line='Ahmed Khan,03001234567,ahmed@example.com,22:00,06:00')=>Buffer.from(HEADERS.slice(0, 5).join(',')+'\n'+line);
const workDaysCsv = (cell: string) =>
  Buffer.from(HEADERS.join(',') + '\nAhmed Khan,03001234567,ahmed@example.com,22:00,06:00,' + cell);
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('ACCESS_TOKEN_SECRET','unit-test-only-import-secret-long-enough');m.authorize.mockResolvedValue({id:3,name:'Site',timezone:'Asia/Karachi',isActive:true});m.staff.mockResolvedValue([]);m.audit.mockResolvedValue(null);m.state.mockResolvedValue({company:{plan:'ADVANCED'}});m.count.mockResolvedValue(0);});
afterEach(() => vi.unstubAllEnvs());
describe('bounded spreadsheet parsing',()=>{
 it('reads CSV text without dropping phone zero and normalizes email',async()=>{const [row]=await parseStaffFile(csv('Ahmed Khan,03001234567,AHMED@example.com,22:00,06:00'),'staff.csv');expect(row).toMatchObject({row:2,email:'ahmed@example.com',phone:'+923001234567',start:'22:00',end:'06:00',errors:[]});});
 it('generates exact XLSX headers and reads real Excel time numbers', async () => {
   const book = new ExcelJS.Workbook();
   await book.xlsx.load(await staffTemplate());
   const sheet = book.worksheets[0]!;
   expect(sheet.getRow(1).values).toEqual([undefined, 'Full Name', 'Phone', 'Email', 'Shift Start', 'Shift End', 'Work days']);
   expect(sheet.getColumn(6).numFmt).toBe('@');
   sheet.addRow(['Ahmed Khan', '03001234567', 'ahmed@example.com', 22 / 24, 6 / 24]);
   const [row] = await parseStaffFile(Buffer.from(await book.xlsx.writeBuffer()), 'staff.xlsx');
   expect(row).toMatchObject({ start: '22:00', end: '06:00', errors: [] });
 });
 it.each(['bad.exe','staff.xls'])('rejects unsupported %s',async name=>{await expect(parseStaffFile(csv(),name)).rejects.toMatchObject({statusCode:400});});
 it('rejects an oversized expanded workbook before XML parsing',async()=>{const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Staff');sheet.addRow(HEADERS);sheet.addRow(['x'.repeat(9*1024*1024),'03001234567','a@example.com','08:00','16:00']);const bytes=Buffer.from(await book.xlsx.writeBuffer());expect(bytes.length).toBeLessThan(1024*1024);await expect(parseStaffFile(bytes,'staff.xlsx')).rejects.toMatchObject({statusCode:400});});
 it('accepts native Excel time cells and rejects phone separators without digits',async()=>{const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Staff');sheet.addRow(HEADERS);sheet.addRow(['Worker','-------','a@example.com',new Date('1899-12-30T22:00:00Z'),new Date('1899-12-30T06:00:00Z')]);sheet.getCell('D2').numFmt='hh:mm';sheet.getCell('E2').numFmt='hh:mm';const [row]=await parseStaffFile(Buffer.from(await book.xlsx.writeBuffer()),'staff.xlsx');expect(row).toMatchObject({start:'22:00',end:'06:00'});expect(row!.errors).toContain('Enter a Pakistan mobile number, like 03001234567.');});
 it('rejects malformed xlsx',async()=>{await expect(parseStaffFile(csv(),'staff.xlsx')).rejects.toMatchObject({statusCode:400});});
 it('rejects oversized file',async()=>{await expect(parseStaffFile(Buffer.alloc(1024*1024+1),'staff.csv')).rejects.toMatchObject({statusCode:400});});
 it.each(['','Full Name,Email,Email,Shift Start,Shift End\nA,a,b,08:00,16:00','Full Name,Phone,Email,Shift Start,Shift End,Location\nA,a,b,08:00,16:00,site'])('rejects empty/duplicate/additional columns',async text=>{await expect(parseStaffFile(Buffer.from(text),'staff.csv')).rejects.toMatchObject({statusCode:400});});
 it.each(['X,bad,bad,25:00,06:00','Ahmed,03001234567,a@example.com,08:00,08:00','Ahmed,03001234567,a@example.com,8:00,16:00'])('reports row field errors for %s',async line=>{expect((await parseStaffFile(csv(line),'staff.csv'))[0]!.errors.length).toBeGreaterThan(0);});
 it('marks duplicate normalized file emails',async()=>{const rows=await parseStaffFile(csv('Ahmed,03001234567,a@example.com,08:00,16:00\nAli,03011234567,A@example.com,09:00,17:00'),'staff.csv');expect(rows[1]!.errors).toContain('Duplicate email in this spreadsheet.');});
 it('rejects the old six-column template', async () => {
   const bytes = Buffer.from('Full Name,Email,Phone,Shift Start,Shift End,Password\nWorker,worker@example.com,03001234567,08:00,16:00,unused');
   await expect(parseStaffFile(bytes, 'staff.csv')).rejects.toMatchObject({ statusCode: 400 });
 });
 it('refuses an incorrect sixth header with the optional column guidance', async () => {
   const bytes = Buffer.from('Full Name,Phone,Email,Shift Start,Shift End,Work Days\nAhmed,03001234567,a@example.com,08:00,16:00,Mon');
   await expect(parseStaffFile(bytes, 'staff.csv')).rejects.toMatchObject({
     statusCode: 400,
     message: 'Use the exact template headers, once each and in their original order. The sixth column, Work days, is optional.',
   });
 });
 it.each(['mon wed', '"MON, WED"', '"wed, MON wed"'])('normalizes work days from %s', async cell => {
   const [row] = await parseStaffFile(workDaysCsv(cell), 'staff.csv');
   expect(row).toMatchObject({ workDays: ['MON', 'WED'], errors: [] });
 });
 it('rejects a formula in the work days column even with a valid cached result', async () => {
   const book = new ExcelJS.Workbook();
   const sheet = book.addWorksheet('Staff');
   sheet.addRow(HEADERS);
   sheet.addRow(['Ahmed', '03001234567', 'a@example.com', '08:00', '16:00', { formula: '"Mon"', result: 'Mon' }]);
   const [row] = await parseStaffFile(Buffer.from(await book.xlsx.writeBuffer()), 'staff.xlsx');
   expect(row!.errors).toContain('Unsupported formula, link or cell content.');
 });
 it('marks a duplicate phone written in a different format and allows multiple blank emails', async () => {
   const rows = await parseStaffFile(csv('Ahmed,03001234567,,08:00,16:00\nAli,+92 (300) 123-4567,,09:00,17:00'), 'staff.csv');
   expect(rows[0]!.errors).toEqual([]);
   expect(rows[1]).toMatchObject({ phone: '+923001234567', errors: ['Duplicate phone in this spreadsheet.'] });
 });
 it('rejects formula cells without evaluating them',async()=>{const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Staff');sheet.addRow(HEADERS);sheet.addRow([{formula:'1+1'},'03001234567','a@example.com','08:00','16:00']);const rows=await parseStaffFile(Buffer.from(await book.xlsx.writeBuffer()),'staff.xlsx');expect(rows[0]!.errors).toContain('Unsupported formula, link or cell content.');});
 it('validates 500 rows and refuses 501',async()=>{const lines=Array.from({length:500},(_,i)=>`Worker ${i},0300${String(i).padStart(7,"0")},worker${i}@example.com,08:00,16:00`).join('\n');expect(await parseStaffFile(csv(lines),'staff.csv')).toHaveLength(500);await expect(parseStaffFile(csv(lines+'\nWorker501,03001234567,a@example.com,08:00,16:00'),'staff.csv')).rejects.toMatchObject({statusCode:400});});
});
describe('confirming staff work days', () => {
 const transaction = () => {
   const tx = { $queryRaw: vi.fn(), staff: { findMany: m.staff, count: m.count }, auditLog: { findFirst: m.audit } };
   m.capacity.mockImplementation(async (_actor, _resource, run) => run(tx));
   return tx;
 };

 it.each([
   ['"Mon,Wed"', ['MON', 'WED']],
   ['', ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']],
 ])('provisions work days from a six-column cell containing %j', async (cell, workDays) => {
   const bytes = workDaysCsv(cell);
   const preview = await previewStaffImport(actor, 3, bytes, 'staff.csv');
   expect(preview.valid).toBe(1);
   expect(preview.rows[0]).toMatchObject({ workDays, errors: [] });
   const tx = transaction();
   m.create.mockResolvedValue({ id: 9 });
   await expect(confirmStaffImport(actor, 3, bytes, 'staff.csv', preview.token)).resolves.toMatchObject({ count: 1 });
   expect(m.create).toHaveBeenCalledWith(tx, actor.companyId, expect.objectContaining({ workDays }));
 });

 it('reports an invalid work day and refuses to provision the row', async () => {
   const bytes = workDaysCsv('Funday');
   const preview = await previewStaffImport(actor, 3, bytes, 'staff.csv');
   expect(preview.valid).toBe(0);
   expect(preview.rows[0]).toMatchObject({ row: 2, errors: ['Enter work days like Mon,Wed using Mon to Sun.'] });
   transaction();
   await expect(confirmStaffImport(actor, 3, bytes, 'staff.csv', preview.token)).rejects.toMatchObject({ statusCode: 400 });
   expect(m.create).not.toHaveBeenCalled();
 });

 it('imports the five-column template using the existing database default', async () => {
   const bytes = csv();
   const preview = await previewStaffImport(actor, 3, bytes, 'staff.csv');
   expect(preview.valid).toBe(1);
   transaction();
   m.create.mockResolvedValue({ id: 9 });
   await expect(confirmStaffImport(actor, 3, bytes, 'staff.csv', preview.token)).resolves.toMatchObject({ count: 1 });
   expect(m.create.mock.calls[0]![2]).not.toHaveProperty('workDays');
 });
});
describe('preview and confirmation security',()=>{
 it('previews without provisioning and marks existing emails',async()=>{m.staff.mockResolvedValue([{email:'ahmed@example.com'}]);const result=await previewStaffImport(actor,3,csv(),'staff.csv');expect(result.valid).toBe(0);expect(m.create).not.toHaveBeenCalled();expect(m.capacity).not.toHaveBeenCalled();});
 it('marks a globally used phone on a staff row with no email', async () => {
   m.staff.mockResolvedValue([{ phone: '+923001234567', email: null }]);
   const result = await previewStaffImport(actor, 3, csv('Ahmed Khan,03001234567,,22:00,06:00'), 'staff.csv');
   expect(result.valid).toBe(0);
   expect(result.rows[0]!.errors).toEqual(['This phone number is already used.']);
   expect(m.staff).toHaveBeenCalledWith({
     where: { OR: [{ phone: { in: ['+923001234567'] } }, { email: { in: [], mode: 'insensitive' } }] },
     select: { phone: true, email: true },
   });
 });
 it('locks all batch identities before the first insert', async () => {
   const bytes = csv('Ahmed,03001234567,,08:00,16:00\nAli,03011234567,ali@example.com,09:00,17:00');
   const preview = await previewStaffImport(actor, 3, bytes, 'staff.csv');
   const tx = { $queryRaw: vi.fn(), staff: { findMany: m.staff, count: m.count }, auditLog: { findFirst: m.audit } };
   m.capacity.mockImplementation(async (_actor, _resource, run) => run(tx));
   m.create.mockResolvedValueOnce({ id: 9 }).mockResolvedValueOnce({ id: 10 });
   await expect(confirmStaffImport(actor, 3, bytes, 'staff.csv', preview.token)).resolves.toMatchObject({ count: 2, staffIds: [9, 10] });
   expect(m.lockStaff).toHaveBeenCalledBefore(m.create);
   expect(m.lockStaff).toHaveBeenCalledWith(tx, [
     expect.objectContaining({ phone: '+923001234567', email: undefined }),
     expect.objectContaining({ phone: '+923011234567', email: 'ali@example.com' }),
   ]);
 });
 it('rejects staff role',async()=>{await expect(previewStaffImport({...actor,role:'STAFF'},3,csv(),'staff.csv')).rejects.toThrow('Denied');});
 it('propagates cross-tenant/site denial before parsing',async()=>{m.authorize.mockRejectedValue(Error('Site denied'));await expect(previewStaffImport(actor,3,csv(),'staff.csv')).rejects.toThrow('Site denied');expect(m.staff).not.toHaveBeenCalled();});
 it('rejects inactive location',async()=>{m.authorize.mockResolvedValue({isActive:false});await expect(previewStaffImport(actor,3,csv(),'staff.csv')).rejects.toMatchObject({statusCode:403});});
 it('refuses over-capacity preview',async()=>{m.count.mockResolvedValue(200);await expect(previewStaffImport(actor,3,csv(),'staff.csv')).rejects.toMatchObject({statusCode:403});});
 it('binds confirmation to file and actor',async()=>{const preview=await previewStaffImport(actor,3,csv(),'staff.csv');await expect(confirmStaffImport(actor,3,csv('Ali,03001234567,ali@example.com,08:00,16:00'),'staff.csv',preview.token)).rejects.toMatchObject({statusCode:400});await expect(confirmStaffImport({...actor,id:2},3,csv(),'staff.csv',preview.token)).rejects.toMatchObject({statusCode:400});expect(m.create).not.toHaveBeenCalled();});
 it('reconciles duplicate confirmation without creating accounts',async()=>{const preview=await previewStaffImport(actor,3,csv(),'staff.csv');m.audit.mockResolvedValue({newValue:{count:1,staffIds:[9]}});expect(await confirmStaffImport(actor,3,csv(),'staff.csv',preview.token)).toEqual({count:1,staffIds:[9]});expect(m.capacity).not.toHaveBeenCalled();});
 it('creates without email within the capacity transaction and preserves site-local overnight clocks',async()=>{const bytes=csv('Ahmed Khan,03001234567,,22:00,06:00');const preview=await previewStaffImport(actor,3,bytes,'staff.csv');expect(preview.valid).toBe(1);const tx={$queryRaw:vi.fn(),staff:{findMany:m.staff,count:m.count},auditLog:{findFirst:m.audit}};m.capacity.mockImplementation(async(_a,_r,run)=>run(tx));m.create.mockResolvedValue({id:9});expect(await confirmStaffImport(actor,3,bytes,'staff.csv',preview.token)).toMatchObject({count:1,staffIds:[9],locationId:3});const input=m.create.mock.calls[0]![2];expect(input.shiftStart.toISOString()).toBe('1970-01-01T17:00:00.000Z');expect(input.shiftEnd.toISOString()).toBe('1970-01-01T01:00:00.000Z');expect(input.email).toBeUndefined();expect(input).not.toHaveProperty('password');expect(input.phone).toBe('+923001234567');});
});
