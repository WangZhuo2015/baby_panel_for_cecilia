import { randomUUID } from "node:crypto";
import { type BridgeFetch, BridgeError, pathId, requireData } from "./bridge-protocol";
import { requireAccessToken } from "./ai-session-client";
export interface BffAiJob {
  id:string;userId:string;familyId:string;babyId:string;type:string;
  status:"pending"|"running"|"succeeded"|"failed"|"cancelled";
  resultJson:string|null;errorMessage:string|null;imageUrl:string|null;claimed:boolean;
  attempt:number;maxAttempts:number;createdAt:string;startedAt:string|null;finishedAt:string|null;
}
export interface BffVoiceLog {
  id:string;userId:string;babyId:string;prompt:string;reply:string;isAsync:boolean;isFastPath:boolean;
  acknowledged:boolean;createdAt:string;baby?:{id:string;nickname:string;gender?:string}|null;
}
function object(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value)) throw new BridgeError(502,"UPSTREAM_INVALID_STATE","GrowDesk 返回了无效的持久状态");
  return value as Record<string,unknown>;
}
function job(value:unknown,userId:string,id?:string):BffAiJob {
  const row=object(value);
  if(typeof row.id!=="string"||(id&&row.id!==id)||row.userId!==userId||typeof row.babyId!=="string"||typeof row.familyId!=="string"||typeof row.type!=="string"||
    !["pending","running","succeeded","failed","cancelled"].includes(String(row.status))||typeof row.claimed!=="boolean"||!Number.isInteger(row.attempt)||!Number.isInteger(row.maxAttempts)||
    ![row.createdAt].every(v=>typeof v==="string"&&Number.isFinite(Date.parse(v)))||
    (row.resultJson!==null&&typeof row.resultJson!=="string")||(row.errorMessage!==null&&typeof row.errorMessage!=="string")) {
    throw new BridgeError(502,"UPSTREAM_INVALID_JOB","GrowDesk 任务数据缺失或归属不符");
  }
  if(row.resultJson!==null) try{object(JSON.parse(row.resultJson as string));}catch{throw new BridgeError(502,"UPSTREAM_INVALID_JOB","GrowDesk 返回了无效的任务结果");}
  return row as unknown as BffAiJob;
}
function voice(value:unknown,userId:string,id?:string):BffVoiceLog {
  const row=object(value);
  if(typeof row.id!=="string"||(id&&row.id!==id)||row.userId!==userId||typeof row.babyId!=="string"||typeof row.prompt!=="string"||typeof row.reply!=="string"||
    typeof row.isAsync!=="boolean"||typeof row.isFastPath!=="boolean"||typeof row.acknowledged!=="boolean"||typeof row.createdAt!=="string"||!Number.isFinite(Date.parse(row.createdAt))) throw new BridgeError(502,"UPSTREAM_INVALID_VOICE_LOG","GrowDesk 语音记录缺失或归属不符");
  return row as unknown as BffVoiceLog;
}
export function createBackgroundClient(fetchApi:BridgeFetch) {
  const base="/api/v1/web/ai/jobs";
  async function action(id:string,userId:string,action:string,token?:string,commandId?:string) {
    const result=await fetchApi<unknown>(`${base}/${pathId(id)}/${action}`,{method:"POST",accessToken:requireAccessToken(token),...(commandId?{body:{commandId}}:{})});
    if(!result.ok&&result.status===404)return null;
    return job(requireData(result),userId,id);
  }
  return {
    async createJob(input:{userId:string;babyId:string;type:string;attachmentId?:string;targetDate?:string;clientRequestId:string;accessToken:string}) {
      return job(requireData(await fetchApi<unknown>(base,{method:"POST",accessToken:requireAccessToken(input.accessToken),body:{type:input.type,babyId:input.babyId,attachmentId:input.attachmentId,targetDate:input.targetDate,clientRequestId:input.clientRequestId}})),input.userId);
    },
    async getJob(id:string,userId:string,token?:string) {
      const result=await fetchApi<unknown>(`${base}/${pathId(id)}`,{accessToken:requireAccessToken(token)});
      return !result.ok&&result.status===404?null:job(requireData(result),userId,id);
    },
    async listJobs(userId:string,options:{type?:string;babyId?:string;limit?:number;offset?:number;accessToken?:string}={}) {
      const query=new URLSearchParams();for(const key of ["type","babyId","limit","offset"] as const)if(options[key]!==undefined)query.set(key,String(options[key]));
      const row=object(requireData(await fetchApi<unknown>(`${base}?${query}`,{accessToken:requireAccessToken(options.accessToken)})));
      if(!Array.isArray(row.jobs)||!Number.isSafeInteger(row.total)||!Number.isSafeInteger(row.pendingClaim)) throw new BridgeError(502,"UPSTREAM_INVALID_JOB_LIST","GrowDesk 返回了无效的任务列表");
      return {total:Number(row.total),pendingClaim:Number(row.pendingClaim),jobs:row.jobs.map(j=>job(j,userId))};
    },
    async claimJob(id:string,userId:string,token?:string){return (await action(id,userId,"claim",token))?.claimed??false;},
    async cancelJob(id:string,userId:string,token?:string){return action(id,userId,"cancel",token);},
    async retryJob(id:string,userId:string,commandId:string,token?:string){return action(id,userId,"retry",token,commandId);},
    async createLog(input:Omit<BffVoiceLog,"id"|"createdAt">&{id?:string;accessToken?:string}) {
      const {id=randomUUID(),babyId,prompt,reply,isAsync,isFastPath,acknowledged}=input;
      return voice(requireData(await fetchApi<unknown>("/api/v1/web/voice/logs",{method:"POST",accessToken:requireAccessToken(input.accessToken),body:{id,babyId,prompt,reply,isAsync,isFastPath,acknowledged}})),input.userId,id);
    },
    async listLogs(userId:string,options:{limit?:number;unreadAsyncOnly?:boolean;accessToken?:string}={}) {
      const query=new URLSearchParams();if(options.limit!==undefined)query.set("limit",String(options.limit));if(options.unreadAsyncOnly!==undefined)query.set("unreadAsyncOnly",String(options.unreadAsyncOnly));
      const data=object(requireData(await fetchApi<unknown>(`/api/v1/web/voice/logs?${query}`,{accessToken:requireAccessToken(options.accessToken)})));
      if(!Array.isArray(data.logs))throw new BridgeError(502,"UPSTREAM_INVALID_VOICE_LOG","GrowDesk 返回了无效的语音记录列表");
      return {logs:data.logs.map(row=>voice(row,userId)),unreadLog:data.unreadLog===null?null:voice(data.unreadLog,userId)};
    },
    async getLog(id:string,userId:string,token?:string) {
      const res=await fetchApi<unknown>(`/api/v1/web/voice/logs/${pathId(id)}`,{accessToken:requireAccessToken(token)});
      return !res.ok&&res.status===404?null:voice(requireData(res),userId,id);
    },
    async acknowledgeLog(id:string,_userId:string,acknowledged=true,token?:string) {
      const res=await fetchApi<unknown>(`/api/v1/web/voice/logs/${pathId(id)}/acknowledge`,{method:"POST",accessToken:requireAccessToken(token),body:{acknowledged}});
      if(!res.ok&&res.status===404)return false;
      if(object(requireData(res)).acknowledged!==acknowledged)throw new BridgeError(502,"UPSTREAM_INVALID_VOICE_LOG","语音已读状态未确认");
      return true;
    },
  };
}
