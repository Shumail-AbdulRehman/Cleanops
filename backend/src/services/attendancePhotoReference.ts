// Pure opaque attendance reference contract; no provider or database imports.
const REFERENCE = /^attendance:v1:([1-9]\d*):([1-9]\d*):([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
export function parseAttendancePhoto(reference: string | null | undefined) {
  const match = REFERENCE.exec(reference ?? "");
  if (!match) return null;
  const companyId = Number(match[1]), staffId = Number(match[2]);
  if (!Number.isSafeInteger(companyId) || !Number.isSafeInteger(staffId)) return null;
  return { companyId, staffId, publicId: `attendance/${companyId}/${staffId}/${match[3]}` };
}

