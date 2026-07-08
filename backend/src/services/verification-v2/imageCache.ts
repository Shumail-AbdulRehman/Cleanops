import { privateImageBytes } from './media.service.js';

/** Short-lived, bounded RAM only. Keys include the protected tenant asset path. */
export function createEvidenceImageCache(read = privateImageBytes, maxBytes = 32 * 1024 * 1024, ttlMs = 120000) {
  const cache = new Map<string, { bytes: Buffer; until: number }>();
  const loading = new Map<string, Promise<Buffer>>();
  let total = 0;
  function remove(key: string) { const value = cache.get(key); if (value) { total -= value.bytes.length; cache.delete(key); } }
  return async (publicId: string, format: string) => {
    const key = `${publicId}:${format}`;
    for (const [id, value] of cache) if (value.until <= Date.now()) remove(id);
    const cached = cache.get(key);
    if (cached) { cache.delete(key); cache.set(key, cached); return cached.bytes; }
    const pending = loading.get(key); if (pending) return pending;
    const work = read(publicId, format).then(bytes => {
      if (bytes.length <= maxBytes) {
        while (total + bytes.length > maxBytes && cache.size) remove(cache.keys().next().value!);
        cache.set(key, { bytes, until: Date.now() + ttlMs }); total += bytes.length;
      }
      return bytes;
    }).finally(() => { loading.delete(key); });
    loading.set(key, work); return work;
  };
}
