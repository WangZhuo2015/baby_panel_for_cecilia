import { randomUUID } from "node:crypto";
import { growdeskRouteBoundary } from "./route-boundary";
import { BridgeError,pathId,requireData } from "./bridge-protocol";
import { resolveBffSession } from "./session";
import { growdeskFetch } from "./client";
import { readJsonObject } from "./record-route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
export function durableParseRecord(request:Request){
  return growdeskRouteBoundary(request,async()=>{
    const session=await resolveBffSession(request);if(!session)throw new BridgeError(401,"UNAUTHORIZED","请先登录");
    if(!checkRateLimit(`parse_record:${session.user.id}`,20,60000).success)throw new BridgeError(429,"RATE_LIMITED","整理请求过于频繁");
    const body=await readJsonObject(request);const text=typeof body.text==="string"?body.text.trim():"";
    if(!text||text.length>2000)throw new BridgeError(400,"INVALID_MESSAGE","请输入 1–2000 字符");
    const babyId=pathId(body.babyId),clientMessageId=typeof body.clientMessageId==="string"?body.clientMessageId:randomUUID();
    const contextType=typeof body.contextType==="string"?body.contextType:"general";
    const conversation=requireData(await growdeskFetch<{id:string}>("/api/v1/web/ai/sessions",{method:"POST",accessToken:session.accessToken,body:{babyId,contextType,title:text.slice(0,24),clientRequestId:clientMessageId}}));
    const run=requireData(await growdeskFetch<{id:string}>(`/api/v1/ai/sessions/${pathId(conversation.id)}/runs`,{method:"POST",accessToken:session.accessToken,body:{clientMessageId,message:"请把以下口述整理为待人工确认的记录；不确定的时间或必要字段先询问，不要假装已保存。\n"+text}}));
    return Response.json({sessionId:conversation.id,runId:run.id,transcript:text},{status:202});
  });
}
