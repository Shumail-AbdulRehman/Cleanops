import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config';

const STORAGE_KEY = '@cleanops-staff/api-address';
let currentAddress = API_BASE_URL;
let loading: Promise<string> | null = null;

export function validateServerAddress(input: string): string {
  const trimmed = input.trim();
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error('Enter a full server address, such as http://192.168.1.10:8080/api.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS address without a username, password, query, or fragment.');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || /^127\./.test(host) ||
      ['[::1]', '[::]', '10.0.2.2', '10.0.3.2'].includes(host)) {
    throw new Error('Use the computer’s Wi-Fi address so the phone can reach it.');
  }
  if (url.protocol === 'http:') {
    const parts = host.split('.').map(Number);
    const privateIpv4 = parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) &&
      (parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
    if (!privateIpv4) throw new Error('Use HTTPS for public servers. HTTP is only supported for private Wi-Fi addresses.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== '' && path !== '/api') throw new Error('The server address must end in /api.');
  return `${url.origin}/api`;
}

export function loadServerAddress(): Promise<string> {
  if (!loading) loading = AsyncStorage.getItem(STORAGE_KEY).then(saved => {
    if (saved) {
      try { currentAddress = validateServerAddress(saved); } catch { currentAddress = API_BASE_URL; }
    }
    return currentAddress;
  }).catch(() => currentAddress);
  return loading;
}

export function getServerAddress(): string { return currentAddress; }

export async function saveServerAddress(input: string): Promise<string> {
  const next = validateServerAddress(input);
  await loadServerAddress();
  await AsyncStorage.setItem(STORAGE_KEY, next);
  currentAddress = next;
  return next;
}
