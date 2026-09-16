import { growdeskRouteBoundary } from "@/lib/growdesk/route-boundary";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { bffAiJobStore } from "@/lib/growdesk/ai-jobs";
export async function POST(request: Request, context: { params: Promise<{id:string}> }) {
  return growdeskRouteBoundary(request, async () => {
    if (!GROWDESK_CONFIG.enabled) return Response.json({error:"该接口需要 GrowDesk"}, {status:501});
    const session=await resolveBffSession(request);
    if (!session) return Response.json({error:"会话已过期"}, {status:401});
    const {id}=await context.params;
    
    const job=await bffAiJobStore.cancelJob(id,session.user.id,session.accessToken);
    return job?Response.json({job}):Response.json({error:"任务不存在"}, {status:404});
  });
}
