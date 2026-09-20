import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function validateDeviceApiUrl(raw) {
  if (!raw?.trim()) throw new Error('Set EXPO_PUBLIC_API_BASE_URL before building a physical-device APK.');
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error('EXPO_PUBLIC_API_BASE_URL must be an absolute HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP(S) API URL without credentials, query parameters, or a fragment.');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' ||
    /^127\./.test(host) || ['[::1]', '[::]', '[::ffff:7f00:1]', '10.0.2.2', '10.0.3.2'].includes(host)) {
    throw new Error('The API URL points at loopback/emulator networking. Use a backend address reachable by the phone.');
  }
  const normalized = raw.trim().replace(/\/+$/, '');
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  const root = fileURLToPath(new URL('../', import.meta.url));
  process.env.NODE_ENV ??= 'production';
  require('@expo/env').load(root);
  try {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('EXPO_PUBLIC_') && /SECRET|PASSWORD|PRIVATE|API_KEY|API_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN/i.test(key)) {
        throw new Error(`Remove privileged configuration ${key} from the public mobile environment.`);
      }
    }
    console.log(`Physical-device API URL: ${validateDeviceApiUrl(process.env.EXPO_PUBLIC_API_BASE_URL)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
