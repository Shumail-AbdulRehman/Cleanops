export const INVALID_PAKISTAN_PHONE_MESSAGE = 'Enter a Pakistan mobile number, like 03001234567.';

export function normalizePakistanPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[\s()\[\]-]/g, '');
  const match = /^(?:0|92|\+92|0092)?(3[0-9]{9})$/.exec(compact);
  return match ? `+92${match[1]}` : null;
}

export function formatPakistanPhone(value: unknown): string | null {
  const phone = normalizePakistanPhone(value);
  return phone ? `0${phone.slice(3, 6)} ${phone.slice(6)}` : null;
}
