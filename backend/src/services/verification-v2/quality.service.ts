import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { ApiError } from '../../utils/ApiError.js';

export const IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;
export const PIXEL_LIMIT = 25_000_000;
export const IMAGE_ALGORITHM_VERSION = 'dct64-v1';
export const QUALITY_THRESHOLD_VERSION = 'quality-thresholds-v1';
export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export function dctHash(pixels: Uint8Array): string {
  const size = 32;
  if (pixels.length !== size * size) throw new Error('Expected 32x32 luminance pixels');
  const coefficients: number[] = [];
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
    let coefficient = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      coefficient += pixels[y * size + x]! * Math.cos((2 * x + 1) * u * Math.PI / 64) * Math.cos((2 * y + 1) * v * Math.PI / 64);
    }
    coefficients.push(coefficient);
  }
  const median = [...coefficients.slice(1)].sort((a, b) => a - b)[31]!;
  let bits = 0n;
  coefficients.forEach((value, index) => { if (index !== 0 && value > median) bits |= 1n << BigInt(index); });
  return bits.toString(16).padStart(16, '0');
}

export function hammingDistance(a: string, b: string): number {
  if (!/^[a-f\d]{16}$/i.test(a) || !/^[a-f\d]{16}$/i.test(b)) return 64;
  let bits = BigInt('0x' + a) ^ BigInt('0x' + b);
  let count = 0;
  while (bits) { count++; bits &= bits - 1n; }
  return count;
}

export async function inspectImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > IMAGE_LIMIT_BYTES) throw new ApiError(422, 'Photo must be at most 5 MB');
  try {
    const image = sharp(bytes, { limitInputPixels: PIXEL_LIMIT, failOn: 'error', animated: false });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('Unsupported format');
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > PIXEL_LIMIT) throw new Error('Invalid dimensions');
    const sanitized = await image.rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const normalized = await sharp(sanitized).resize(256, 256, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const gray = await sharp(sanitized).resize(96, 96, { fit: 'fill' }).greyscale().raw().toBuffer();
    let total = 0, clipped = 0, lapSum = 0, lapSq = 0, n = 0;
    for (const value of gray) { total += value; if (value < 8 || value > 247) clipped++; }
    for (let y = 1; y < 95; y++) for (let x = 1; x < 95; x++) {
      const i = y * 96 + x;
      const lap = gray[i - 1]! + gray[i + 1]! + gray[i - 96]! + gray[i + 96]! - 4 * gray[i]!;
      lapSum += lap; lapSq += lap * lap; n++;
    }
    const luminance = total / gray.length;
    const blurVariance = lapSq / n - (lapSum / n) ** 2;
    const reasons: string[] = [];
    if (Math.min(metadata.width, metadata.height) < 480) reasons.push('PHOTO_TOO_SMALL');
    if (luminance < 25) reasons.push('PHOTO_TOO_DARK');
    if (blurVariance < 12) reasons.push('PHOTO_BLURRY');
    const oriented = await sharp(sanitized).metadata();
    const side = Math.max(1,Math.floor(Math.min(oriented.width!, oriented.height!) * .8));
    const crop = {left:Math.floor((oriented.width!-side)/2),top:Math.floor((oriented.height!-side)/2),width:side,height:side};
    const hashes = await Promise.all([sharp(sanitized), sharp(sanitized).flop(), sharp(sanitized).extract(crop)]
      .map(async pipeline => dctHash(await pipeline.resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer())));
    return { sanitized, sha256: sha256(bytes), normalizedHash: sha256(normalized), perceptualHash: hashes[0]!, hashVariants: hashes,
      width: metadata.width, height: metadata.height, format: metadata.format!, bytes: bytes.length,
      quality: { version: QUALITY_THRESHOLD_VERSION, hashAlgorithmVersion: IMAGE_ALGORITHM_VERSION, luminance, blurVariance, clippedRatio: clipped / gray.length, reasons, acceptable: reasons.length === 0 } };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, 'Use a valid JPEG, PNG or WebP photo, at most 25 megapixels');
  }
}
