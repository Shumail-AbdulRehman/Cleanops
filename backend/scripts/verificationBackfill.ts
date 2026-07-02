import 'dotenv/config';
import pg from 'pg';
// Default report only. Actual backfill changes only NULL historical v1 outcomes;
// no schedule mapping, evidence changes, deletes or version promotion.
const apply=process.argv.includes('--apply');
if(apply&&!process.argv.includes('--confirm-additive-backfill'))throw new Error('Use --confirm-additive-backfill after reviewing the report and taking a snapshot backup');
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,query_timeout:30000});await client.connect();
try{
 await client.query(apply?'BEGIN':'BEGIN READ ONLY');
 const result=await client.query(`SELECT count(*)::int AS candidates FROM "TaskInstance" WHERE "verificationVersion"=1 AND status='COMPLETED' AND "completionOutcome" IS NULL`);
 console.log(JSON.stringify({mode:apply?'apply-additive':'dry-run',...result.rows[0]}));
 if(apply){const updated=await client.query(`UPDATE "TaskInstance" SET "completionOutcome"='LEGACY_RECORDED' WHERE "verificationVersion"=1 AND status='COMPLETED' AND "completionOutcome" IS NULL`);console.log(JSON.stringify({updated:updated.rowCount}));}
 await client.query('COMMIT');
}finally{await client.end();}
