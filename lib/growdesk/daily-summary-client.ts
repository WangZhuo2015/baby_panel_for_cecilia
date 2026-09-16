import { pollJobResult } from './job-poll';
import type { AiDailySummaryResult } from '@/types/daily-summary';
/** A page reload only reads existing work. Paid generation requires an explicit action. */
export async function loadDailySummaryFromBackend(input:{babyId:string;userId:string;date?:string;generate?:boolean}):Promise<AiDailySummaryResult> {
  const key=`growdesk-summary-job:${input.userId}:${input.babyId}:${input.date??'today'}`;
  let pending=sessionStorage.getItem(key);
  if(input.generate) {
    const response=await fetch('/api/ai/daily-summary',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({babyId:input.babyId,date:input.date,clientRequestId:crypto.randomUUID(),force:true})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||`日报请求失败 (${response.status})`);
    // Legacy mode retains its synchronous result.
    if(response.status!==202&&data.summary)return data.summary;
    if(typeof data.jobId!=='string')throw new Error('后台任务未确认创建');
    pending=data.jobId;sessionStorage.setItem(key,pending!);
  }
  if(pending) {
    await pollJobResult(pending,input.babyId);
    if(sessionStorage.getItem(key)===pending)sessionStorage.removeItem(key);
  }
  const query=new URLSearchParams({babyId:input.babyId});if(input.date)query.set('date',input.date);
  const response=await fetch(`/api/ai/daily-summary?${query}`,{cache:'no-store'});
  const data=await response.json();if(!response.ok||!data.summary)throw new Error(data.error||'日报读取失败');
  if(data.summary.babyId!==input.babyId)throw new Error('日报宝宝归属不一致');
  return data.summary;
}
