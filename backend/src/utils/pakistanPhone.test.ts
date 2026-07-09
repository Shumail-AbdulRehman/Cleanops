import { describe, expect, it } from 'vitest';
import { formatPakistanPhone, normalizePakistanPhone } from './pakistanPhone.js';

describe('Pakistan mobile numbers', () => {
  it.each(['0300 123-4567', '300 123-4567', '92 (300) 123-4567', '+92 [300] 123-4567', '00 92-300 123-4567'])('normalizes %s', phone => {
    expect(normalizePakistanPhone(phone)).toBe('+923001234567');
  });

  it.each(['021 12345678', '0300123456', '+92 42 12345678', '0300 ABC4567', '+44 7700 900123', '0300.1234567', '++923001234567', '', null, 3001234567])('rejects %j', phone => {
    expect(normalizePakistanPhone(phone)).toBeNull();
  });

  it('formats a valid mobile number for local display', () => {
    expect(formatPakistanPhone('+923001234567')).toBe('0300 1234567');
    expect(formatPakistanPhone('invalid')).toBeNull();
  });
});
