import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from './wevid-audit/node_modules/typescript/lib/typescript.js';
import { PGlite } from './db-proof-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { createContentMediaRepositoryMethods } from './wevid-audit/apps/api/dist/modules/content/content-media-repository.js';

const db = new PGlite();
await db.exec(`
  create table users(id text primary key,supabase_user_id text);
  create table content_items(id text primary key,creator_user_id text,media_type text,caption text,nsfw_label text,state text);
  insert into users values('actor','actor');
  insert into content_items values('carousel','actor','carousel','test','none','processing');
`);
const sql = async (strings,...values) => {
  let query = strings[0];
  for (let i=0;i<values.length;i++) query += `$${i+1}${strings[i+1]}`;
  return (await db.query(query,values)).rows;
};
const repository = createContentMediaRepositoryMethods(sql);
const before = await repository.findOwnedContentForUpload({supabaseUserId:'actor',contentId:'carousel'});
assert.equal(before.id,'carousel');
await db.exec(`update content_items set state='ready' where id='carousel'`);
const after = await repository.findOwnedContentForUpload({supabaseUserId:'actor',contentId:'carousel'});
assert.equal(after,null);

const source = fs.readFileSync('./wevid-complete/apps/web/app/messages/message-composer.tsx','utf8');
const identitySource = source.slice(source.indexOf('function idempotencyKeyForRequest('),source.indexOf('function optimisticMessage('));
const queueSource = source.slice(source.indexOf('function readQueue():'));
const helperJs = ts.transpileModule(identitySource+'\n'+queueSource,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const storage = new Map();
let generated=0;
const context = vm.createContext({
  createMutationIdempotencyKey:()=>`operation-${++generated}`,
  offlineQueueKey:'wevid:message-offline-queue:v1',
  window:{localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}},
});
vm.runInContext(helperJs,context);
const sameRequest = {body:'Hello',replyToMessageId:null,sharedContentItemId:null,attachmentContentItemIds:[]};
context.attempt={current:null};
context.request=sameRequest;
const firstKey=vm.runInContext('idempotencyKeyForRequest(attempt,request)',context);
context.first={conversationId:'thread',optimisticId:'first',idempotencyKey:firstKey,request:sameRequest,createdAt:'2026-11-04T10:00:00Z'};
vm.runInContext('enqueue(first)',context);
// The component clears its input after queuing but leaves messageAttempt unchanged.
const secondKey=vm.runInContext('idempotencyKeyForRequest(attempt,request)',context);
context.second={...context.first,optimisticId:'second',idempotencyKey:secondKey};
vm.runInContext('enqueue(second)',context);
const queue=JSON.parse(storage.get('wevid:message-offline-queue:v1'));
assert.equal(firstKey,secondKey);
assert.equal(queue.length,1);

const result={
  sourceSha:'71ceabcfaa8a5258e1b935a391ff4e6e7330c682',
  carouselLookup:{engine:'actual compiled repository method on reduced PGlite schema; state transition supplied by fixture, not full sync route',processingFound:Boolean(before),readyFound:Boolean(after)},
  offlineLogicalIdentity:{engine:'actual source helper functions TypeScript-transpiled in VM; UI state transition traced statically, no browser',newIdenticalCompositions:2,generatedKeys:generated,persistedQueueEntries:queue.length,firstKey,secondKey},
};
console.log(JSON.stringify(result,null,2));
await db.close();
