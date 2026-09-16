import {randomUUID} from "node:crypto";
import {growdeskRouteBoundary} from "./route-boundary";
import {BridgeError,pathId,requireData} from "./bridge-protocol";
import {resolveBffSession} from "./session";
import {growdeskFetch} from "./client";
import {loadWebBaby} from "./bridge-identity";
import {tryVoiceFastPath} from "@/lib/agent/voice-fast-path";
import {bffVoiceLogStore} from "./voice-logs";
import {checkRateLimit} from "@/lib/rate-limit";
import type {DurableChatRun} from "./durable-chat";

export function durableVoiceRequest(request:Request):Promise<Response>{
  return growdeskRouteBoundary(request,async()=>{
    const session=await resolveBffSession(request);
    if(!session)throw new BridgeError(401,"UNAUTHORIZED","请先登录");
    if(!checkRateLimit(`voice:${session.user.id}`,30,60000).success)throw new BridgeError(429,"RATE_LIMITED","语音请求过于频繁");
    let body:Record<string,unknown>;
    try {const raw=await request.json();body=typeof raw==="string"?{text:raw}:raw;
      if(!body||Array.isArray(body)||typeof body!=="object")throw new Error();
    }catch{throw new BridgeError(400,"INVALID_JSON","请求正文无效");}
    const rawText=[body.text,body.message,body.prompt,body.query,body.content].find(x=>typeof x==="string") as string|undefined;
    const text=rawText?.trim();
    if(!text||text.length>4000)throw new BridgeError(400,"INVALID_MESSAGE","语音问题必须为 1–4000 字符");
    const baby=await loadWebBaby(growdeskFetch,session.accessToken,body.babyId);
    if(!baby)throw new BridgeError(404,"BABY_NOT_FOUND","请先创建宝宝资料");
    const clientMessageId=typeof body.clientRequestId==="string"?body.clientRequestId:randomUUID();pathId(clientMessageId);
    const fast=await tryVoiceFastPath({text,baby,userId:session.user.id,accessToken:session.accessToken});
    if(fast){
      const logged=await bffVoiceLogStore.createLog({id:clientMessageId,userId:session.user.id,babyId:baby.id,prompt:text,reply:fast,isAsync:false,isFastPath:true,acknowledged:true,accessToken:session.accessToken});
      return Response.json({success:true,async:false,fastPath:true,reply:fast,logId:logged.id});
    }
    const conversation=requireData(await growdeskFetch<{id:string}>("/api/v1/web/ai/sessions",{
      method:"POST",accessToken:session.accessToken,body:{babyId:baby.id,contextType:"voice",title:text.slice(0,24),clientRequestId:clientMessageId}
    }));
    let run=requireData(await growdeskFetch<DurableChatRun>(`/api/v1/ai/sessions/${pathId(conversation.id)}/runs`,{
      method:"POST",accessToken:session.accessToken,body:{message:text,clientMessageId}
    }));
    const timeout=Math.min(Math.max(typeof body.timeoutMs==="number"?body.timeoutMs:10000,0),12000);
    const deadline=Date.now()+timeout;
    while(!["succeeded","failed","cancelled","awaiting_confirmation"].includes(run.status)&&Date.now()<deadline&&!request.signal.aborted){
      await new Promise(resolve=>setTimeout(resolve,400));
      run=requireData(await growdeskFetch<DurableChatRun>(`/api/v1/ai/runs/${pathId(run.id)}`,{accessToken:session.accessToken}));
    }
    if(run.userId!==session.user.id||run.babyId!==baby.id)throw new BridgeError(502,"RUN_SCOPE_MISMATCH","后端语音任务归属不符");
    if(run.status==="failed"||run.status==="cancelled")throw new BridgeError(502,"VOICE_RUN_FAILED",run.errorMessage||"语音处理失败");
    const needsConfirmation=run.status==="awaiting_confirmation";
    return Response.json({success:true,async:!["succeeded","awaiting_confirmation"].includes(run.status),fastPath:false,sessionId:conversation.id,runId:run.id,needsConfirmation,
      reply:run.resultSummary||(needsConfirmation?"请在网页中核对并确认拟写入的记录。":"任务已保存，稍后可在语音记录和会话中读取。"),plan:run.proposedPlan??null});
  });
}
