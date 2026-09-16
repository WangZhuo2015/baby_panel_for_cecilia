import test from 'node:test';
import assert from 'node:assert/strict';
import {pollJobResult,PendingJobError} from '../../lib/growdesk/job-poll';
import {isBridgedMethod} from '../../lib/growdesk/bridge-policy';
const id='00000000-0000-4000-a000-000000000001',babyId='test_baby_poll';
function fixture(body:unknown,status=200):typeof fetch{return (async()=>Response.json(body,{status})) as typeof fetch;}
test('job poll reads an existing task and returns only an owned completed result',async()=>{
  let calls=0;
  const result=await pollJobResult(id,babyId,{intervalMs:1,fetchApi:(async(url,options)=>{
    assert.match(String(url),/babyId=test_baby_poll/);assert.notEqual(options?.method,'POST');calls++;
    return Response.json({id,babyId,status:calls===1?'processing':'done',result:{weightKg:5.2}});
  }) as typeof fetch});
  assert.equal(result.weightKg,5.2);assert.equal(calls,2);
});
test('job poll preserves a pending handle rather than creating or retrying work',async()=>{
  await assert.rejects(pollJobResult(id,babyId,{timeoutMs:0,fetchApi:fixture({id,babyId,status:'processing'})}),error=>error instanceof PendingJobError&&error.jobId===id);
});
for(const status of [401,403,404,409,429,500,503]) test(`job poll does not hide HTTP ${status}`,async()=>{
  await assert.rejects(pollJobResult(id,babyId,{fetchApi:fixture({},status)}),new RegExp(String(status)));
});
test('foreign baby, malformed result and cancellation never fill a form',async()=>{
  await assert.rejects(pollJobResult(id,babyId,{fetchApi:fixture({id,babyId:'test_foreign',status:'done',result:{}})}),/归属/);
  await assert.rejects(pollJobResult(id,babyId,{fetchApi:fixture({id,babyId,status:'done',result:null})}),/无效/);
  await assert.rejects(pollJobResult(id,babyId,{fetchApi:fixture({id,babyId,status:'cancelled'})}),/取消/);
});
test('routing fence exposes implemented state handlers but not arbitrary operations',()=>{
  for(const [route,methods] of [[`/api/ai/jobs/${id}`,['GET','PATCH']],[`/api/ai/jobs/${id}/retry`,['POST']],[`/api/ai/jobs/${id}/cancel`,['POST']],[`/api/ai/sessions/${id}`,['GET','PATCH','DELETE']],[`/api/agent/voice/logs/${id}`,['GET','PATCH']],[`/api/notifications/${id}`,['POST','PATCH','DELETE']],['/api/ai/daily-summary',['GET','POST']]] as const)for(const method of methods)assert.equal(isBridgedMethod(route,method),true,`${method} ${route}`);
  assert.equal(isBridgedMethod(`/api/ai/jobs/${id}/force-success`,'POST'),false);
});
