/** Browser-safe read-only polling. Reconnection never creates or retries a paid job. */
export class PendingJobError extends Error {
  constructor(readonly jobId: string) { super('任务仍在后台处理。结果会保留，可稍后重新查看。'); this.name='PendingJobError'; }
}
export async function pollJobResult<T extends Record<string, unknown>>(
  jobId: string, babyId: string, options: { signal?: AbortSignal; fetchApi?: typeof fetch; timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(jobId)||!babyId)throw new Error('缺少任务或宝宝标识');
  const fetchApi=options.fetchApi??fetch,deadline=Date.now()+(options.timeoutMs??180_000);
  do {
    options.signal?.throwIfAborted();
    const response=await fetchApi(`/api/ai/jobs/${encodeURIComponent(jobId)}?babyId=${encodeURIComponent(babyId)}`,{cache:'no-store',signal:options.signal});
    if(!response.ok)throw new Error(`任务读取失败（${response.status}），未创建或重试任务`);
    const job=await response.json();
    if(job.id!==jobId||job.babyId!==babyId)throw new Error('任务归属不一致，未填入表单');
    if(job.status==='done') {
      if(!job.result||typeof job.result!=='object'||Array.isArray(job.result))throw new Error('任务返回了无效结果');
      return job.result as T;
    }
    if(job.status==='failed'||job.status==='cancelled')throw new Error(job.errorMessage||'任务失败或已取消，请检查后显式重试');
    if(job.status!=='processing')throw new Error('任务状态无效');
    if(Date.now()>=deadline)break;
    await new Promise<void>((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);reject(options.signal?.reason??new Error('已停止读取'));};
      const timer=setTimeout(()=>{options.signal?.removeEventListener('abort',abort);resolve();},options.intervalMs??1500);
      options.signal?.addEventListener('abort',abort,{once:true});
    });
  } while(Date.now()<deadline);
  throw new PendingJobError(jobId);
}
