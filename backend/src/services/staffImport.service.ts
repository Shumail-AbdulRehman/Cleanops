import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { fromZonedTime } from 'date-fns-tz';
import { prisma } from '../prisma/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { normalizePakistanPhone } from '../utils/pakistanPhone.js';
import { WEEKDAYS, type Weekday } from '../utils/workDays.js';
import { staffRecordSchema } from '../validations/staffRecord.validation.js';
import { requireLocationAccess, requireOperationalRole, type VerificationActor } from './verification-v2/authorization.service.js';
import { withAccountCapacity, assertAccountAction, readAccountState } from './accountAccess.service.js';
import { PLAN_DEFINITIONS } from './subscription.service.js';
import { prepareStaffAttendance } from '../utils/syncAttendanceWindow.js';
import { insertStaff, lockStaffIdentities } from './staffProvisioning.service.js';
import { writeAuditLog } from './auditLog.service.js';
import type { VerificationTransaction } from './verification-v2/transaction.js';

export const HEADERS = ['Full Name', 'Phone', 'Email', 'Shift Start', 'Shift End', 'Work days'];
export const MAX_IMPORT_BYTES = 1024 * 1024;
const MAX_ROWS = 500;
const bad = (message: string) => new ApiError(400, message);
export type ImportRow = { row: number; name: string; email: string; phone: string; start: string; end: string; workDays?: Weekday[]; errors: string[] };
const importSecret = () => {
  const value = process.env.ACCESS_TOKEN_SECRET;
  if (!value) throw new ApiError(503, 'Staff import is unavailable.');
  return value;
};
const digest = (bytes: Buffer) => createHmac('sha256', importSecret()).update('staff-import:v2\0').update(bytes).digest('hex');

/** Bound decompression before the workbook parser reads any XML. */
async function inspectZip(bytes: Buffer) {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(bad('The Excel file could not be read.'));
      let size = 0, entries = 0;
      const fail = () => { zip.close(); reject(bad('The Excel file is too large or contains unsupported content.')); };
      zip.on('error', fail);
      zip.on('entry', (entry: yauzl.Entry) => {
        size += entry.uncompressedSize;
        if (++entries > 256 || size > 8 * MAX_IMPORT_BYTES || /vbaProject|externalLinks|\.bin$/i.test(entry.fileName) || entry.isEncrypted()) return fail();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return fail();
          let actual = 0;
          stream.on('data', chunk => { actual += chunk.length; if (actual > entry.uncompressedSize || actual > 8 * MAX_IMPORT_BYTES) { stream.destroy(); fail(); } });
          stream.on('error', fail); stream.on('end', () => zip.readEntry());
        });
      });
      zip.on('end', resolve); zip.readEntry();
    });
  });
}
const clock = (value: ExcelJS.CellValue) => {
  if (value instanceof Date && value.getUTCFullYear() <= 1904 && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0) return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440);
    if (minutes >= 1440 || Math.abs(value * 1440 - minutes) > 0.001) return '';
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  return typeof value === 'string' ? value.trim() : '';
};
const textCell = (value: ExcelJS.CellValue) => typeof value === 'string' ? value.trim() : '';
export async function parseStaffFile(bytes: Buffer, filename: string): Promise<ImportRow[]> {
  if (!bytes.length || bytes.length > MAX_IMPORT_BYTES) throw bad('Choose a file smaller than 1 MB.');
  const book = new ExcelJS.Workbook();
  try {
    if (/\.xlsx$/i.test(filename)) {
      await inspectZip(bytes);
      await book.xlsx.load(bytes as unknown as Parameters<typeof book.xlsx.load>[0]);
    } else if (/\.csv$/i.test(filename)) {
      await book.csv.read(Readable.from([bytes]), { map: value => value });
    } else throw bad('Choose an .xlsx or .csv file.');
  } catch (error) { if (error instanceof ApiError) throw error; throw bad('The spreadsheet could not be read. Download the template and try again.'); }
  if (book.worksheets.length !== 1) throw bad('Use one worksheet with the template columns.');
  const sheet = book.worksheets[0]!;
  const columnCount = sheet.columnCount;
  const headers = HEADERS.slice(0, columnCount);
  if (
    (columnCount !== HEADERS.length && columnCount !== HEADERS.length - 1) ||
    headers.some((name, index) => sheet.getRow(1).getCell(index + 1).value !== name)
  ) {
    throw bad('Use the exact template headers, once each and in their original order. The sixth column, Work days, is optional.');
  }
  if (sheet.rowCount > MAX_ROWS + 1) throw bad('Use at most 500 employees.');
  const rows: ImportRow[] = [];
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  for (let index = 2; index <= sheet.rowCount; index++) {
    const sheetRow = sheet.getRow(index);
    const cells = headers.map((_, column) => sheetRow.getCell(column + 1).value);
    if (cells.every(value => value === null || value === '')) continue;
    const name = textCell(cells[0]!);
    const phoneText = textCell(cells[1]!);
    const email = textCell(cells[2]!).toLowerCase();
    const phone = staffRecordSchema.shape.phone.safeParse(phoneText);
    const row: ImportRow = { row: index, name, email, phone: phone.success ? phone.data : phoneText, start: clock(cells[3]!), end: clock(cells[4]!), errors: [] };
    if (cells.some((value, column) => {
      if (typeof value === 'string') return /^[=+@\-]/.test(value) && (column !== 1 || !phone.success);
      if (value instanceof Date) return (column !== 3 && column !== 4) || value.getUTCFullYear() > 1904;
      return value !== null && typeof value === 'object';
    })) row.errors.push('Unsupported formula, link or cell content.');
    const nameResult = staffRecordSchema.shape.name.safeParse(name);
    const emailResult = staffRecordSchema.shape.email.safeParse(email);
    for (const result of [nameResult, emailResult, phone]) {
      if (!result.success) row.errors.push(result.error.issues[0]!.message);
    }
    if (cells[2] !== null && typeof cells[2] !== 'string' && emailResult.success) row.errors.push('Enter a valid email.');
    if (![row.start,row.end].every(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) || row.start === row.end) row.errors.push('Enter different shift times in HH:mm format.');
    const workDaysCell = cells[5];
    if (workDaysCell !== undefined) {
      let days: unknown = workDaysCell;
      if (typeof workDaysCell === 'string') {
        const text = workDaysCell.trim();
        days = text ? text.toUpperCase().split(/ *, *| +/) : WEEKDAYS;
      } else if (workDaysCell === null) {
        days = WEEKDAYS;
      }
      const workDays = staffRecordSchema.shape.workDays.safeParse(days);
      if (workDays.success) row.workDays = workDays.data;
      else row.errors.push('Enter work days like Mon,Wed using Mon to Sun.');
    }
    if (email) {
      if (seenEmails.has(email)) row.errors.push('Duplicate email in this spreadsheet.');
      seenEmails.add(email);
    }
    if (phone.success) {
      if (seenPhones.has(phone.data)) row.errors.push('Duplicate phone in this spreadsheet.');
      seenPhones.add(phone.data);
    }
    rows.push(row);
  }
  if (!rows.length) throw bad('Add at least one employee to the spreadsheet.');
  return rows;
}
export async function staffTemplate() {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Staff');
  sheet.addRow(HEADERS); sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach(column => { column.width = 25; column.numFmt = '@'; });
  return book.xlsx.writeBuffer();
}
async function authorize(actor: VerificationActor, locationId: number, db: VerificationTransaction = prisma) {
  requireOperationalRole(actor);
  if (!Number.isSafeInteger(locationId) || locationId < 1) throw bad('Choose a valid location.');
  const location = await requireLocationAccess(actor, locationId, db);
  if (!location.isActive) throw new ApiError(403, 'This location is inactive.');
  await assertAccountAction(actor, 'ADD_CAPACITY', db);
  return location;
}
async function validateExisting(rows: ImportRow[], db: VerificationTransaction = prisma) {
  const phones = rows.map(row => normalizePakistanPhone(row.phone)).filter(phone => phone !== null);
  const emails = rows.map(row => row.email).filter(Boolean);
  const existing = await db.staff.findMany({
    where: { OR: [{ phone: { in: phones } }, { email: { in: emails, mode: 'insensitive' } }] },
    select: { phone: true, email: true },
  });
  const existingPhones = new Set(existing.map(staff => staff.phone));
  const existingEmails = new Set(existing.map(staff => staff.email?.toLowerCase()));
  for (const row of rows) {
    if (existingPhones.has(row.phone)) row.errors.push('This phone number is already used.');
    if (existingEmails.has(row.email)) row.errors.push('Email is already in use.');
  }
}
async function checkCapacity(actor: VerificationActor, count: number, db: VerificationTransaction = prisma) {
  const state = await readAccountState(actor.companyId, db);
  const active = await db.staff.count({ where: { companyId: actor.companyId, isActive: true } });
  if (active + count > PLAN_DEFINITIONS[state.company.plan].limits.staff) throw new ApiError(403, 'This import exceeds your plan’s staff capacity. Ask the company owner to review Plan & billing.');
}
const receiptWhere = (actor: VerificationActor, locationId: number, hash: string) => ({ companyId: actor.companyId, actorType: actor.role, actorId: actor.id, entityType: 'LOCATION', entityId: locationId, action: 'STAFF_IMPORT_COMMITTED', newValue: { path: ['digest'], equals: hash } });
export async function previewStaffImport(actor: VerificationActor, locationId: number, bytes: Buffer, filename: string) {
  const location = await authorize(actor, locationId);
  const rows = await parseStaffFile(bytes, filename); await validateExisting(rows);
  await checkCapacity(actor, rows.length);
  const secret = importSecret();
  const token = jwt.sign({ purpose: 'STAFF_IMPORT', actorId: actor.id, role: actor.role, companyId: actor.companyId, locationId, digest: digest(bytes) }, secret, { expiresIn: '10m', algorithm: 'HS256' });
  return { location: { id: location.id, name: location.name, timezone: location.timezone }, rows, total: rows.length, valid: rows.filter(row => !row.errors.length).length, token };
}
export async function confirmStaffImport(actor: VerificationActor, locationId: number, bytes: Buffer, filename: string, token: string) {
  await authorize(actor, locationId);
  const hash = digest(bytes);
  try {
    const claims = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (claims.purpose !== 'STAFF_IMPORT' || claims.actorId !== actor.id || claims.role !== actor.role || claims.companyId !== actor.companyId || claims.locationId !== locationId || claims.digest !== hash) throw Error();
  } catch { throw bad('This preview expired or changed. Upload the spreadsheet again.'); }
  const receipt = () => prisma.auditLog.findFirst({ where: receiptWhere(actor, locationId, hash) });
  const saved = await receipt(); if (saved) return saved.newValue;
  const rows = await parseStaffFile(bytes, filename);
  try {
    return await withAccountCapacity(actor, 'staff', async tx => {
      await tx.$queryRaw`SELECT id FROM "Manager" WHERE id=${actor.id} AND "companyId"=${actor.companyId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Location" WHERE id=${locationId} AND "companyId"=${actor.companyId} FOR SHARE`;
      if (actor.role === 'MANAGER') await tx.$queryRaw`SELECT "managerId" FROM "ManagerLocation" WHERE "managerId"=${actor.id} AND "locationId"=${locationId} FOR SHARE`;
      const location = await authorize(actor, locationId, tx);
      const prior = await tx.auditLog.findFirst({ where: receiptWhere(actor, locationId, hash) });
      if (prior) return prior.newValue;
      await validateExisting(rows, tx);
      await checkCapacity(actor, rows.length, tx);
      if (rows.some(row => row.errors.length)) throw bad('The spreadsheet has errors or an email or phone is now in use. Upload it again.');
      const inputs = [...rows].sort((a, b) => a.email.localeCompare(b.email)).map(row => staffRecordSchema.parse({
        name: row.name, email: row.email, phone: row.phone, locationId,
        shiftStart: fromZonedTime(`1970-01-01T${row.start}:00`, location.timezone),
        shiftEnd: fromZonedTime(`1970-01-01T${row.end}:00`, location.timezone),
        ...(row.workDays !== undefined ? { workDays: row.workDays } : {}),
      }));
      if (inputs.length > 1) await lockStaffIdentities(tx, inputs);
      const ids: number[] = [];
      for (const input of inputs) {
        const staff = await insertStaff(tx, actor.companyId, input);
        ids.push(staff.id);
        await prepareStaffAttendance(tx, staff.id);
      }
      const result = { digest: hash, count: ids.length, staffIds: ids, locationId };
      await writeAuditLog({ companyId: actor.companyId, actorType: actor.role, actorId: actor.id, entityType: 'LOCATION', entityId: locationId, action: 'STAFF_IMPORT_COMMITTED', newValue: result }, tx);
      return result;
    });
  } catch (error) {
    const reconciled = await receipt(); if (reconciled) return reconciled.newValue;
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new ApiError(409, 'An email or phone is now in use. Upload the spreadsheet again.');
    throw error;
  }
}
