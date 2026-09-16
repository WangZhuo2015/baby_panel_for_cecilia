import {GROWDESK_CONFIG} from "@/lib/config";
import {durableChatAction} from "@/lib/growdesk/durable-chat";
export async function POST(request:Request){
 if(!GROWDESK_CONFIG.enabled)return Response.json({error:"此操作需要 GrowDesk 后端"},{status:501});
 return durableChatAction(request,"confirm");
}
