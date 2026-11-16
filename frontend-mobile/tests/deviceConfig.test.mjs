import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDeviceApiUrl } from '../scripts/validate-device-config.mjs';

test('physical-device build refuses absent, relative, loopback, emulator and credential-bearing API URLs', () => {
  for (const url of [undefined, '', '/api', 'http://localhost:8080/api', 'http://127.1.2.3:8080/api',
    'http://[::1]:8080/api', 'http://0.0.0.0:8080/api', 'http://10.0.2.2:8080/api',
    'https://user:password@example.com/api', 'https://example.com/api?token=secret']) {
    assert.throws(() => validateDeviceApiUrl(url));
  }
  assert.equal(validateDeviceApiUrl('http://192.168.100.198:8080/api/'), 'http://192.168.100.198:8080/api');
  assert.equal(validateDeviceApiUrl('https://test.example.com'), 'https://test.example.com/api');
});
