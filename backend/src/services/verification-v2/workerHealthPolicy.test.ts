import { it,expect } from 'vitest';
import { heartbeatFresh } from './workerHealthPolicy.js';
it('worker health rejects missing, future and expired heartbeat',()=>{expect(heartbeatFresh(null,50000)).toBe(false);expect(heartbeatFresh({lastSeenAt:new Date(49999)},50000)).toBe(true);expect(heartbeatFresh({lastSeenAt:new Date(0)},50000)).toBe(false);expect(heartbeatFresh({lastSeenAt:new Date(50001)},50000)).toBe(false);});
