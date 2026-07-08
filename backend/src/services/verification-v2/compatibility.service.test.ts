import { describe,it,expect } from 'vitest';
import { versionSupported,verificationCapabilities } from './compatibility.service.js';
describe('native compatibility',()=>{
 it('requires a supported concrete version and never silently downgrades v2',()=>{expect(versionSupported(undefined)).toBe(false);expect(versionSupported('1.99.0')).toBe(false);expect(versionSupported('2.0.0')).toBe(true);expect(versionSupported('2.1.0')).toBe(true);expect(versionSupported('2.0.0-beta')).toBe(false);expect(versionSupported('invalid')).toBe(false);});
 it('retires legacy mutations while keeping automatic passing closed',()=>{expect(verificationCapabilities()).toMatchObject({requiredWorkflowVersion:2,legacyActiveTasksSupported:false,automaticCleanlinessPassing:false});});
});
