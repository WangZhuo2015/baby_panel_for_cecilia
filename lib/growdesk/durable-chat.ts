import {randomUUID} from 'node:crypto';
import {growdeskFetch} from './client';
import {BridgeError,pathId,requireData} from './bridge-protocol';
import {resolveBffSession,type ActiveBffSession} from './session';
import {bffAiSessionStore} from './ai-sessions';
import {growdeskRouteBoundary} from './route-boundary';
import {readJsonObject} from './record-route-helpers';
import {uploadPrivateBytes} from './private-upload';
import {checkRateLimit} from '@/lib/rate-limit';
export interface ChatPlan {planHash:string;expiresAt:string;actions:Array<{actionId:string;entityType:string;operation:string;summary:string;payload:Record<string,unknown>}>}
export interface DurableChatRun {id:string;sessionId:string;userId:string;babyId:string|null;status:string;resultSummary:string|null;proposedPlan:ChatPlan|null;errorMessage:string|null;lastEventSeq:string}
function runValue(value:unknown,userId:string):DurableChatRun {
  if(!value||typeof value!=='object')throw new BridgeError(502,'INVALID_CHAT_RUN','后端聊天任务响应无效');const r=value as DurableChatRun;
  if(typeof r.id!=='string'||typeof r.sessionId!=='string'||r.userId!==userId||!['queued','running','awaiting_confirmation','succeeded','failed','cancelling','cancelled'].includes(r.status))throw new BridgeError(502,'INVALID_CHAT_RUN','后端聊天任务归属或状态无效');return r;
}
export async function latestChatRun(sessionId:string,session:ActiveBffSession){const raw=requireData(await growdeskFetch<DurableChatRun|null>(`/api/v1/web/ai/sessions/${pathId(sessionId)}/run`,{accessToken:session.accessToken}));return raw===null?null:runValue(raw,session.user.id);}
async function ownedSession(sid:string,session:ActiveBffSession,babyId?:unknown,context?:unknown){const s=await bffAiSessionStore.getSession(sid,session.user.id,session.accessToken);if(!s)throw new BridgeError(404,'SESSION_NOT_FOUND','会话不存在或已撤权');if((babyId&&s.babyId!==babyId)||(context&&s.contextType!==context))throw new BridgeError(409,'SESSION_SCOPE_MISMATCH','会话与当前宝宝或领域不匹配');return s;}
function streamRun(initial:DurableChatRun,session:ActiveBffSession,request:Request,meta?:{id:string;title:string;contextType:string}){
  const encoder=new TextEncoder();let stopped=false;
  return new Response(new ReadableStream<Uint8Array>({
    async start(controller){const send=(x:unknown)=>{if(!stopped)controller.enqueue(encoder.encode(`data: ${JSON.stringify(x)}\n\n`));};
      const abort=()=>{stopped=true;};request.signal.addEventListener('abort',abort,{once:true});
      try{if(meta)send({session:meta});let run=initial;let lastText='';const deadline=Date.now()+180000;
        while(!stopped){
          if(run.resultSummary&&run.resultSummary!==lastText){send({text:run.resultSummary,replay:true});lastText=run.resultSummary;}
          if(run.status==='awaiting_confirmation'){send({plan:run.proposedPlan,runId:run.id});break;}
          if(run.status==='succeeded')break;
          if(run.status==='failed'||run.status==='cancelled'){send({error:run.errorMessage||(run.status==='cancelled'?'任务已取消':'处理失败'),runId:run.id});break;}
          if(Date.now()>=deadline){send({pending:true,runId:run.id,message:'任务仍在后端处理中，重新打开会话可继续读取。'});break;}
          await new Promise(resolve=>setTimeout(resolve,800));if(stopped)break;
          run=runValue(requireData(await growdeskFetch(`/api/v1/ai/runs/${pathId(run.id)}`,{accessToken:session.accessToken})),session.user.id);
          if(run.sessionId!==initial.sessionId||run.babyId!==initial.babyId)throw new BridgeError(502,'RUN_SCOPE_MISMATCH','任务归属不一致');
        }
      }catch(e){if(!stopped)send({error:e instanceof Error?e.message:'读取任务失败'});}finally{request.signal.removeEventListener('abort',abort);if(!stopped){controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();}stopped=true;}
    },cancel(){stopped=true;},
  }),{headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store, no-transform','x-accel-buffering':'no'}});
}
export function durableChatRequest(request:Request){return growdeskRouteBoundary(request,async()=>{
  const session=await resolveBffSession(request);if(!session)throw new BridgeError(401,'UNAUTHORIZED','请重新登录');const url=new URL(request.url);
  if(request.method==='GET'){
    const sid=url.searchParams.get('sessionId');if(!sid)throw new BridgeError(400,'SESSION_REQUIRED','缺少会话 ID');await ownedSession(sid,session,url.searchParams.get('babyId'),url.searchParams.get('contextType'));
    const run=await latestChatRun(sid,session);if((url.searchParams.get('stream')==='true'||request.headers.get('accept')?.includes('text/event-stream'))&&run)return streamRun(run,session,request);
    return Response.json({active:!!run&&['queued','running','cancelling'].includes(run.status),status:run?.status??'idle',text:run?.resultSummary??'',tools:[],runId:run?.id,plan:run?.proposedPlan??null},{headers:{'cache-control':'no-store'}});
  }
  const rate=checkRateLimit(`durable_chat:${session.user.id}`,20,60000);if(!rate.success)throw new BridgeError(429,'RATE_LIMITED','提问过于频繁，请稍后重试');
  const body=await readJsonObject(request);const messages=body.messages;if(!Array.isArray(messages)||messages.length>50)throw new BridgeError(400,'INVALID_MESSAGES','消息列表无效');
  const last=[...messages].reverse().find(m=>m&&typeof m==='object'&&m.role==='user');const text=typeof last?.content==='string'?last.content.trim():'';if(!text||text.length>8000)throw new BridgeError(400,'INVALID_MESSAGE','问题必须为 1–8000 字符');
  const babyId=pathId(body.babyId);const contextType=typeof body.contextType==='string'?body.contextType:'general';const clientMessageId=typeof body.clientMessageId==='string'?body.clientMessageId:randomUUID();pathId(clientMessageId);
  const images=body.images??(body.image?[body.image]:[]);if(!Array.isArray(images)||images.length>5)throw new BridgeError(400,'INVALID_IMAGES','最多支持 5 张图片');const attachmentIds:string[]=[];
  for(const image of images){if(typeof image!=='string')throw new BridgeError(400,'INVALID_IMAGE','图片格式无效');const reference=/^\/api\/attachments\/([0-9a-f-]{36})$/i.exec(image);if(reference){attachmentIds.push(reference[1]!);continue;}const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image);if(!match)throw new BridgeError(400,'INVALID_IMAGE','请上传图片字节或使用私有附件');const bytes=Buffer.from(match[2]!,'base64');if(!bytes.length||bytes.length>10000000)throw new BridgeError(413,'INVALID_IMAGE_SIZE','每张图片不得超过 10MB');attachmentIds.push(await uploadPrivateBytes(session.accessToken,babyId,bytes,match[1]!,'medical_report'));}
  const conversation=typeof body.sessionId==='string'?await ownedSession(body.sessionId,session,babyId,contextType):requireData(await growdeskFetch<{id:string;title:string;contextType:string}>('/api/v1/web/ai/sessions',{method:'POST',accessToken:session.accessToken,body:{babyId,title:text.replace(/[\r\n\t]+/g,' ').slice(0,24),contextType,clientRequestId:clientMessageId}}));
  const run=runValue(requireData(await growdeskFetch(`/api/v1/ai/sessions/${pathId(conversation.id)}/runs`,{method:'POST',accessToken:session.accessToken,body:{message:text,clientMessageId,attachmentIds}})),session.user.id);
  return streamRun(run,session,request,{id:conversation.id,title:conversation.title,contextType:conversation.contextType});
});}
export function durableChatAction(request:Request,action:'cancel'|'retry'|'confirm'){return growdeskRouteBoundary(request,async()=>{
  const session=await resolveBffSession(request);if(!session)throw new BridgeError(401,'UNAUTHORIZED','请重新登录');const body=await readJsonObject(request);let run:DurableChatRun|null;
  if(typeof body.runId==='string')run=runValue(requireData(await growdeskFetch(`/api/v1/ai/runs/${pathId(body.runId)}`,{accessToken:session.accessToken})),session.user.id);
  else if(typeof body.sessionId==='string')run=await latestChatRun(body.sessionId,session);else throw new BridgeError(400,'RUN_REQUIRED','缺少任务或会话 ID');
  if(!run)return Response.json({success:true,cancelled:false});if(body.babyId&&run.babyId!==body.babyId)throw new BridgeError(409,'RUN_SCOPE_MISMATCH','任务不属于当前宝宝');
  const payload=action==='retry'?{commandId:body.commandId}:action==='confirm'?{planHash:body.planHash,actionIds:body.actionIds}:undefined;
  const result=requireData(await growdeskFetch<Record<string,unknown>>(`/api/v1/ai/runs/${pathId(run.id)}/${action}`,{method:'POST',accessToken:session.accessToken,body:payload}));return Response.json({success:true,cancelled:action==='cancel',...result as object},{headers:{'cache-control':'no-store'}});
});}
