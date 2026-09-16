import {createHash} from 'node:crypto';
import {growdeskFetch} from './client';
import {BridgeError,requireData,pathId} from './bridge-protocol';
import {loadWebBaby} from './bridge-identity';
/** Upload only bytes supplied by this authenticated request; never fetch client image URLs. */
export async function uploadPrivateBytes(token:string,babyId:string,bytes:Uint8Array,mimeType:string,purpose:'medical_report'|'voice_note'){
  const baby=await loadWebBaby(growdeskFetch,token,babyId);if(!baby)throw new BridgeError(404,'BABY_NOT_FOUND','请先选择宝宝');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const item=requireData(await growdeskFetch<{id:string;uploadUrl:string}>('/api/v1/attachments',{method:'POST',accessToken:token,body:{purpose,mimeType,byteSize:bytes.byteLength,sha256,ownerScope:{familyId:baby.familyId,babyId}}}));
  const url=new URL(item.uploadUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new BridgeError(502,'INVALID_UPLOAD_URL','后端返回了无效上传地址');
  const response=await fetch(url,{method:'PUT',body:new Uint8Array(bytes),headers:{'content-type':mimeType},redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new BridgeError(502,'UPLOAD_FAILED','附件上传失败');
  requireData(await growdeskFetch(`/api/v1/attachments/${pathId(item.id)}/complete`,{method:'POST',accessToken:token,body:{byteSize:bytes.byteLength,sha256}}));return item.id;
}
