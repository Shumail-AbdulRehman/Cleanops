export function heartbeatFresh(record:{lastSeenAt:Date}|null,now=Date.now()) {return !!record&&Number.isFinite(+record.lastSeenAt)&&now-+record.lastSeenAt>=0&&now-+record.lastSeenAt<45000;}
