import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {migrate,canonical} from '../../scripts/migrate-growdesk-local-state.mjs';
const record={id:'test_legacy_session',userId:'test_history_user',babyId:'test_history_baby',title:'test_title',contextType:'general',createdAt:'2026-09-01T00:00:00Z',messages:[]};
async function setup(t:TestContext) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'test_history_cli_'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'growdesk-ai-sessions.json');await fs.writeFile(file,JSON.stringify([record]));return {dir,file};
}
test('history dry run is read-only and reports explicit owners',async t=>{
  const {dir,file}=await setup(t);const before=await fs.readFile(file);
  const result=await migrate(['--source-dir',dir,'--user-id',record.userId],{NODE_ENV:"test"});
  assert.equal(result.mode,'check-only');assert.equal(result.archiveVerified,false);assert.equal(result.productionCutoverApproved,false);
  assert.deepEqual(await fs.readFile(file),before);
});
test('history import rejects ownership-free records before any API call',async t=>{
  const {dir,file}=await setup(t);await fs.writeFile(file,JSON.stringify([{id:'test_no_owner'}]));
  await assert.rejects(migrate(['--source-dir',dir,'--user-id',record.userId],{NODE_ENV:"test"}),/ownership/);
});
test('history apply requires explicit configuration and never overwrites a source or report',async t=>{
  const {dir,file}=await setup(t);
  await assert.rejects(migrate(['--source-dir',dir,'--user-id',record.userId,'--apply'],{NODE_ENV:"test"}),/Apply requires/);
  await assert.rejects(migrate(['--source-dir',dir,'--user-id',record.userId,'--apply','--api-url','https://test.invalid','--report',file],{NODE_ENV:'test',GROWDESK_MIGRATION_ACCESS_TOKEN:'test_token'}),/replace/);
});
test('full-field export reconciliation verifies real HTTP responses and preserves the snapshot',async t=>{
  const {dir,file}=await setup(t);const before=await fs.readFile(file);let imports=0;
  const payloadHash=crypto.createHash('sha256').update(canonical(record)).digest('hex');
  const server=http.createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,'Bearer test_token');res.setHeader('content-type','application/json');
    let data:unknown;
    if(req.url==='/api/v1/me')data={user:{id:record.userId}};
    else if(req.method==='POST') {let body='';for await(const chunk of req)body+=chunk;assert.deepEqual(JSON.parse(body).record,record);imports++;data={sourceId:record.id,targetId:'test_target',payloadHash,alreadyImported:false};}
    else data={record,payloadHash,targetId:'test_target'};
    res.end(JSON.stringify({data}));
  });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address();assert.ok(address&&typeof address==='object');const report=path.join(dir,'verified.json');
  const result=await migrate(['--source-dir',dir,'--user-id',record.userId,'--apply','--api-url',`http://127.0.0.1:${address.port}`,'--report',report],{NODE_ENV:'test',GROWDESK_MIGRATION_ACCESS_TOKEN:'test_token'});
  assert.equal(imports,1);assert.equal(result.archiveVerified,true);assert.equal(result.productionCutoverApproved,false);assert.deepEqual(await fs.readFile(file),before);
  assert.equal((await fs.stat(report)).mode&0o077,0);
});
