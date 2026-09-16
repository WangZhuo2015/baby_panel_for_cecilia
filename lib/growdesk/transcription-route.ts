import {randomUUID} from 'node:crypto';
import {growdeskRouteBoundary} from './route-boundary';
import {resolveBffSession} from './session';
import {BridgeError,pathId} from './bridge-protocol';
import {uploadPrivateBytes} from './private-upload';
import {bffAiJobStore} from './ai-jobs';
import {checkRateLimit} from '@/lib/rate-limit';
export function transcribeThroughBackend(request:Request){return growdeskRouteBoundary(request,async()=>{
  const session=await resolveBffSession(request);if(!session)throw new BridgeError(401,'UNAUTHORIZED','请重新登录');
  if(!checkRateLimit(`transcribe:${session.user.id}`,20,60000).success)throw new BridgeError(429,'RATE_LIMITED','请求过于频繁');
  const form=await request.formData();const audio=form.get('audio');const babyId=pathId(form.get('babyId'));if(!(audio instanceof File)||!audio.size||audio.size>25000000)throw new BridgeError(400,'INVALID_AUDIO','录音为空或超过 25MB');
  const mime=audio.type.split(';')[0]!.trim();if(!['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-wav'].includes(mime))throw new BridgeError(400,'INVALID_AUDIO','录音格式不支持');
  const id=await uploadPrivateBytes(session.accessToken,babyId,new Uint8Array(await audio.arrayBuffer()),mime,'voice_note');
  const job=await bffAiJobStore.createJob({userId:session.user.id,babyId,type:'voice_transcription',attachmentId:id,clientRequestId:String(form.get('clientRequestId')||randomUUID()),accessToken:session.accessToken});
  return Response.json({jobId:job.id,babyId,status:'processing'},{status:202,headers:{'cache-control':'no-store'}});
});}
