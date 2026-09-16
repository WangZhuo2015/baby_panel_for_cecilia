import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {createAiSessionClient,type BffAiSession} from '../../lib/growdesk/ai-session-client';
import {createBackgroundClient} from '../../lib/growdesk/background-client';
import {createNotificationClient} from '../../lib/growdesk/notifications';
import {BridgeError,type BridgeFetch,type BridgeResult} from '../../lib/growdesk/bridge-protocol';
const time='2026-09-16T00:00:00.000Z';const userId='test_user';const token='test_bearer';
const session:BffAiSession={id:'test_session',userId,babyId:'test_baby',title:'test_title',contextType:'food',createdAt:time,updatedAt:time,messages:[],messageCount:0,lastMessage:null};
const job={id:'test_job',userId,babyId:'test_baby',familyId:'test_family',type:'medical_ocr',status:'pending',claimed:false,attempt:0,maxAttempts:1,createdAt:time,startedAt:null,finishedAt:null,resultJson:null,errorMessage:null,imageUrl:null};
const log={id:'test_log',userId,babyId:'test_baby',prompt:'test_prompt',reply:'test_reply',isAsync:true,isFastPath:false,acknowledged:false,createdAt:time};
function fake(run:(path:string,options:Parameters<BridgeFetch>[1])=>BridgeResult<unknown>):BridgeFetch {
  return async<T>(path:string,options?:Parameters<BridgeFetch>[1])=>run(path,options) as BridgeResult<T>;
}
const ok=(data:unknown):BridgeResult<unknown>=>({ok:true,status:200,data});
const failure=(status:number):BridgeResult<unknown>=>({ok:false,status,error:{code:`TEST_${status}`,message:'test_error'}});
export async function remoteAiStateCases(t:TestContext) {
  await t.test('remote session CRUD preserves payload, context, ordering and explicit identity',async()=>{
    let body:unknown;let requested='';
    const api=fake((path,options)=>{assert.equal(options?.accessToken,token);requested=path;body=options?.body;return ok(path.endsWith('/messages')?{id:'test_message',sessionId:session.id,role:'user',content:'test',createdAt:time,image:null,toolsJson:null}:options?.method==='DELETE'?{deleted:true}:session);});
    const client=createAiSessionClient(api);
    assert.equal((await client.createSession({userId,babyId:'test_baby',title:'test_title',contextType:'food',accessToken:token})).id,session.id);
    assert.deepEqual(body,{babyId:'test_baby',title:'test_title',contextType:'food'});
    assert.equal((await client.getSession(session.id,userId,{accessToken:token,babyId:'test_baby',contextType:'food'}))!.title,'test_title');
    await assert.rejects(client.getSession(session.id,userId,{accessToken:token,babyId:'test_other'}),{code:'AI_SESSION_CONTEXT_MISMATCH'});
    assert.equal((await client.updateSessionTitle(session.id,userId,'test_new',token))!.id,session.id);assert.deepEqual(body,{title:'test_new'});
    assert.equal((await client.addMessage(session.id,userId,{id:'test_message',role:'user',content:'test'},token))!.id,'test_message');assert.equal(Reflect.get(body as object,"id"),'test_message');
    assert.ok(requested.endsWith('/messages'));assert.equal(await client.deleteSession(session.id,userId,token),true);
  });
  await t.test('session list and fresh adapter read backend changes rather than local cache',async()=>{
    let title='test_first';const api=fake((path)=>ok(path.includes('?')?{total:1,sessions:[{...session,title}]}:{...session,title}));
    const a=createAiSessionClient(api);assert.equal((await a.getSession(session.id,userId,token))!.title,title);
    title='test_second';assert.equal((await createAiSessionClient(api).getSession(session.id,userId,token))!.title,title);
    assert.equal((await a.listSessions(userId,{accessToken:token,babyId:'test_baby',contextType:'food',limit:20,offset:0})).sessions[0].title,title);
    await assert.rejects(a.getSession(session.id,'test_other',token),{code:'UPSTREAM_INVALID_AI_SESSION'});
  });
  await t.test('job creation, claim, cancellation and retry only acknowledge remote state',async()=>{
    const paths:string[]=[];const bodies:unknown[]=[];
    const api=fake((path,options)=>{assert.equal(options?.accessToken,token);paths.push(path);bodies.push(options?.body);return ok(path.includes('?')?{jobs:[job],total:1,pendingClaim:0}:path.endsWith('/claim')?{...job,status:'succeeded',claimed:true}:path.endsWith('/cancel')?{...job,status:'cancelled'}:job);});
    const client=createBackgroundClient(api);const input={userId,babyId:'test_baby',type:'medical_ocr',attachmentId:'test_attachment',clientRequestId:'test_stable_request',accessToken:token};
    await client.createJob(input);await client.createJob(input);assert.deepEqual(bodies[0],bodies[1]);assert.equal(Object.hasOwn(bodies[0] as object,'userId'),false);
    assert.equal((await client.listJobs(userId,{accessToken:token})).pendingClaim,0);
    assert.equal(await client.claimJob(job.id,userId,token),true);
    assert.equal((await client.cancelJob(job.id,userId,token))!.status,'cancelled');
    await client.retryJob(job.id,userId,'test_retry_command',token);assert.deepEqual(bodies.at(-1),{commandId:'test_retry_command'});assert.ok(paths.at(-1)!.endsWith('/retry'));
    assert.equal('updateJob' in client,false); // Clients cannot forge completion or mutate watchdog state.
  });
  await t.test('job reads never invent a timeout or transition a task locally',async()=>{
    const api=fake(()=>ok({...job,status:'running',createdAt:'2000-01-01T00:00:00Z'}));
    const client=createBackgroundClient(api);assert.equal((await client.getJob(job.id,userId,token))!.status,'running');
    assert.equal((await createBackgroundClient(api).getJob(job.id,userId,token))!.status,'running');
  });
  await t.test('voice interactions persist through the remote service and acknowledge exactly',async()=>{
    const api=fake((path,options)=>{assert.equal(options?.accessToken,token);return ok(path.includes('?')?{logs:[log],unreadLog:log}:path.endsWith('acknowledge')?{acknowledged:(options?.body as {acknowledged:boolean}).acknowledged}:log);});
    const client=createBackgroundClient(api);assert.equal((await client.createLog({...log,accessToken:token})).id,log.id);
    assert.equal((await client.listLogs(userId,{accessToken:token,unreadAsyncOnly:true})).unreadLog!.id,log.id);
    assert.equal((await client.getLog(log.id,userId,token))!.reply,log.reply);
    assert.equal(await client.acknowledgeLog(log.id,userId,true,token),true);assert.equal(await client.acknowledgeLog(log.id,userId,false,token),true);
    await assert.rejects(client.getLog(log.id,'test_other',token),{code:'UPSTREAM_INVALID_VOICE_LOG'});
  });
  for(const status of [401,403,409,429,500,503]) await t.test(`remote ${status} remains an error; no session/job/log fallback`,async()=>{
    const api=fake(()=>failure(status));const sessions=createAiSessionClient(api),background=createBackgroundClient(api);
    const check=(err:unknown)=>err instanceof BridgeError&&err.status===status;
    await assert.rejects(sessions.createSession({userId,accessToken:token}),check);
    await assert.rejects(sessions.getSession(session.id,userId,token),check);
    await assert.rejects(background.getJob(job.id,userId,token),check);
    await assert.rejects(background.listLogs(userId,{accessToken:token}),check);
  });
  await t.test('only an upstream 404 becomes a not-found result; absent tokens never call upstream',async()=>{
    const sessions=createAiSessionClient(fake(()=>failure(404)));assert.equal(await sessions.getSession(session.id,userId,token),null);
    const background=createBackgroundClient(fake(()=>failure(404)));assert.equal(await background.getJob(job.id,userId,token),null);
    let calls=0;const never=fake(()=>{calls++;return ok(session);});await assert.rejects(createAiSessionClient(never).getSession(session.id,userId),{code:'BFF_SESSION_REQUIRED'});assert.equal(calls,0);
  });
  await t.test('malformed successful bodies do not become blank history or successful writes',async()=>{
    for(const value of [null,[],{}, {...session,userId:'test_other'}, {...session,messages:[null]}]) await assert.rejects(createAiSessionClient(fake(()=>ok(value))).getSession(session.id,userId,token));
    await assert.rejects(createBackgroundClient(fake(()=>ok({...job,resultJson:'{'}))).getJob(job.id,userId,token));
  });
}
export async function remoteNotificationCases(t:TestContext) {
  const row={id:'test_notification',userId,eventKey:'ai.test',title:'test_title',body:'test_body',readAt:null,createdAt:time};
  await t.test('notifications read/mark/delete only through authenticated remote operations',async()=>{
    const api=fake((_path,options)=>{assert.equal(options?.accessToken,token);return ok(options?.method?{success:true}:[row]);});
    const client=createNotificationClient(api);assert.equal((await client.listNotifications(userId,{accessToken:token})).data[0].id,row.id);
    assert.equal(await client.markAsRead(userId,row.id,token),true);assert.equal(await client.deleteNotification(userId,row.id,token),true);
    await assert.rejects(client.listNotifications('test_other',{accessToken:token}),{code:'UPSTREAM_INVALID_NOTIFICATION'});
    assert.equal('createNotification' in client,false);
  });
  await t.test('duplicate rows, failed status and unconfirmed writes never report success',async()=>{
    await assert.rejects(createNotificationClient(fake(()=>ok([row,row]))).listNotifications(userId,{accessToken:token}),{code:'UPSTREAM_INVALID_NOTIFICATION'});
    for(const status of [401,403,429,500,503]) await assert.rejects(createNotificationClient(fake(()=>failure(status))).deleteNotification(userId,row.id,token),error=>error instanceof BridgeError&&error.status===status);
    assert.equal(await createNotificationClient(fake(()=>failure(404))).markAsRead(userId,row.id,token),false);
    await assert.rejects(createNotificationClient(fake(()=>ok({}))).markAsRead(userId,row.id,token),{code:'UPSTREAM_INVALID_NOTIFICATION'});
  });
}
