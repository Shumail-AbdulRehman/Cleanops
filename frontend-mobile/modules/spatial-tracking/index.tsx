import { requireOptionalNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import type { SpatialSample } from '../../src/verification/spatialTypes';
export type SpatialCapability = 'FULL_SPATIAL'|'LIMITED_SPATIAL'|'NO_SPATIAL';
type Native = {
  isSupported():Promise<SpatialCapability>;
  start():Promise<void>;
  stop():Promise<void>;
  interrupt():Promise<void>;
  getTrackingState():Promise<SpatialSample>;
  captureSpatialObservation():Promise<{uri:string;sample:SpatialSample}>;
};
const native=requireOptionalNativeModule<Native>('SpatialTracking');
export const spatialTracking={
  isSupported:async():Promise<SpatialCapability>=>native?native.isSupported():'NO_SPATIAL',
  start:async()=>{if(!native)throw new Error('Spatial camera unavailable');await native.start();},
  stop:async()=>{await native?.stop();},
  interrupt:async()=>{await native?.interrupt();},
  getTrackingState:async():Promise<SpatialSample>=>native?native.getTrackingState():unavailableSample(),
  captureSpatialObservation:async()=>{if(!native)throw new Error('Spatial camera unavailable');return native.captureSpatialObservation();},
};
export const unavailableSample=():SpatialSample=>({tracking:'UNAVAILABLE',continuity:'BROKEN',camera:null,worldPoint:null,nativeTimestampMs:null});
// Resolve only in a compatible native binary; older binaries keep ordinary capture.
export const SpatialCamera:ComponentType<ViewProps>=native?requireNativeViewManager('SpatialTracking'):()=>null;
