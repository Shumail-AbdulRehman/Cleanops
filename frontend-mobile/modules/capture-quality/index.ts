import { requireOptionalNativeModule } from 'expo-modules-core';
export type ClockAnchor = { bootId: string; elapsedMs: number };
export type StillQuality = { luminance: number; laplacianVariance: number; clipping: number; width: number; height: number };
const native = requireOptionalNativeModule<{ clock(): ClockAnchor; inspect(uri: string): Promise<StillQuality> }>('CaptureQuality');
export const captureClock = (): ClockAnchor => {
  if (!native) throw new Error('Photo verification requires the Hygene Ops native development or production build.');
  return native.clock();
};
export const inspectStill = (uri: string): Promise<StillQuality> => {
  if (!native) throw new Error('Photo verification requires the Hygene Ops native build.');
  return native.inspect(uri);
};
