/** Read-only trace: no evidence URLs, coordinates, credentials or provider prose. */
import 'dotenv/config';
import pg from 'pg';
const attemptId=process.argv[2];
if(!attemptId||!/^[a-f0-9-]{36}$/i.test(attemptId))throw new Error('Usage: npm run verification:trace -- <attempt UUID>');
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{
 const a=(await db.query(`SELECT a.id,a."sessionId",s."taskInstanceId",a.state,a."claimedCapturedAt",a."createdAt",a."receivedAt" FROM "VerificationAttempt" a JOIN "CaptureSession" s ON s.id=a."sessionId" WHERE a.id=$1`,[attemptId])).rows[0];
 if(!a)throw new Error('Attempt not found');
 const jobs=(await db.query(`SELECT id,stage,state,attempts,"createdAt","availableAt","finishedAt","lastErrorCode",result->'timing' AS timing,result->'metadata'->'latencyMs' AS "providerLatencyMs" FROM "VerificationJob" WHERE "attemptId"=$1 ORDER BY "createdAt",id`,[attemptId])).rows;
 const delta=(from:any,to:any)=>from&&to?new Date(to).getTime()-new Date(from).getTime():null;
 const diagnostics=jobs.find(j=>j.timing?.client)?.timing.client;
 console.log(JSON.stringify({attempt:a,clientObservations:diagnostics??null,clientObservationsTrusted:false,captureToReceivedMs:delta(a.claimedCapturedAt,a.receivedAt),ingestionReservationToReceivedMs:delta(a.createdAt,a.receivedAt),processingMs:delta(a.receivedAt,jobs.at(-1)?.finishedAt),jobs:jobs.map(j=>({...j,createdToFinishedMs:delta(j.createdAt,j.finishedAt)})),limitations:['Legacy jobs do not have claim/stage timestamps.','finishedAt is recorded inside the publication transaction; POLICY_COMMITTED logs identify observed commit.','T12 resultShownAt is device queue telemetry and cannot be inferred from server timestamps.']},null,2));
}finally{await db.end();}
