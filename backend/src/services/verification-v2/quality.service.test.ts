import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { inspectImage, hammingDistance, dctHash } from './quality.service.js';

describe('Controlled evidence decoding and duplicate candidate hashes', () => {
  it('rejects SVG despite image MIME claims and rejects empty data', async () => {
    await expect(inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).rejects.toThrow();
    await expect(inspectImage(Buffer.alloc(0))).rejects.toThrow();
  });
  it('records darkness as a camera issue, never a cleanliness verdict', async () => {
    const image = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#010101' } }).jpeg().toBuffer();
    const result = await inspectImage(image);
    expect(result.quality.reasons).toContain('PHOTO_TOO_DARK');
    expect(result).not.toHaveProperty('cleanliness');
    expect(result.hashVariants).toHaveLength(3);
    expect(result.sanitized.length).toBeGreaterThan(0);
  });
  it('treats perceptual similarity as a distance, not proof of identity', () => {
    expect(hammingDistance('0000000000000000','ffffffffffffffff')).toBe(64);
    expect(hammingDistance('0000000000000000','0000000000000001')).toBe(1);
    expect(hammingDistance('invalid','0000000000000000')).toBe(64);
    expect(dctHash(new Uint8Array(1024))).toHaveLength(16);
  });
});
