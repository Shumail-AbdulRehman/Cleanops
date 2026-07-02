import 'dotenv/config';
import pg from 'pg';
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,query_timeout:30000});
await client.connect();
try {
 await client.query('BEGIN READ ONLY');
 const migration=await client.query('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at');
 const companies=await client.query('SELECT id,name,"isActive" FROM "Company" ORDER BY id');
 const templates=await client.query(`SELECT t.id,t.title,t."locationId",l."companyId",t."isActive",t."verificationVersion",t."areaId",t."setupStatus",coalesce(json_agg(r.name) FILTER (WHERE r.id IS NOT NULL),'[]') AS "referenceNames" FROM "TaskTemplate" t JOIN "Location" l ON l.id=t."locationId" LEFT JOIN "TaskTemplateReferenceImage" r ON r."templateId"=t.id GROUP BY t.id,l."companyId" ORDER BY t.id`);
 const instances=await client.query(`SELECT t.id,t."templateId",t.status,t."verificationVersion",t."areaId",l."companyId" FROM "TaskInstance" t JOIN "Location" l ON l.id=t."locationId" WHERE t."isActive" AND t.status IN ('PENDING','IN_PROGRESS','NOT_COMPLETED_INTIME') ORDER BY t.id`);
 console.log(JSON.stringify({mode:'read-only-dry-run',migrations:migration.rows,companies:companies.rows,templates:templates.rows,activeInstances:instances.rows,clientCapabilities:'Native workflow 2/minimum 2.0.0 contract implemented; deployed client readiness requires separate release evidence',missingMappings:templates.rows.filter(t=>t.isActive&&!t.areaId).map(t=>t.id)},null,2));
 await client.query('COMMIT');
} finally {await client.end();}
