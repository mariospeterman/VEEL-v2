import { PGlite } from './node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from './node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';
import fs from 'node:fs';
const db=new PGlite({extensions:{pgcrypto}});
const result={runtime:'PGlite PostgreSQL WASM0.5.15, pgcrypto extension; auth.uid/auth.jwt stubbed from JWT setting; empty Supabase realtime publication; no hosted Supabase services',applied:[],errors:[]};
await db.exec(`create extension if not exists pgcrypto; create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create publication supabase_realtime;
`);
const dir='/workspace/scratch/0635fbdaf32f/wevid-audit/packages/database/migrations/';
for (const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&!f.endsWith('.down.sql')).sort()) {
 try{ await db.exec(fs.readFileSync(dir+f,'utf8')); result.applied.push(f); }
 catch(e){result.errors.push({file:f,code:e.code,message:e.message}); break;}
}
result.catalog=(await db.query(`select tablename,rowsecurity from pg_tables where schemaname='public' order by tablename`)).rows;
fs.writeFileSync('/workspace/scratch/0635fbdaf32f/db-migration-proof.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({applied:result.applied.length,last:result.applied.at(-1),errors:result.errors,tables:result.catalog.length},null,2));
if(!result.errors.length){
 const policy=(await db.query(`select schemaname,tablename,policyname,qual from pg_policies where schemaname='public' order by tablename,policyname`)).rows;
 const funcs=(await db.query(`select n.nspname,p.proname,p.prosecdef,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by n.nspname,p.proname`)).rows;
 fs.writeFileSync('/workspace/scratch/0635fbdaf32f/db-effective-catalog.json',JSON.stringify({policy,funcs},null,2));
}
result.rolledBack=[];
for(const f of [...result.applied].reverse()){
 const down=f.replace(/\.sql$/,'.down.sql');
 try{await db.exec('begin;'+(down==='0039_realtime_projection_publication.down.sql'?fs.readFileSync(dir+down,'utf8').replaceAll('drop table if exists','drop table'):fs.readFileSync(dir+down,'utf8'))+';commit;');result.rolledBack.push(down);}
 catch(e){try{await db.exec('rollback');}catch{}result.rollbackError={file:down,code:e.code,message:e.message,detail:e.detail,hint:e.hint};break;}
}
fs.writeFileSync('/workspace/scratch/0635fbdaf32f/db-rollback-followup-proof.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({rolledBack:result.rolledBack.length,last:result.rolledBack.at(-1),rollbackError:result.rollbackError},null,2));
await db.close();
