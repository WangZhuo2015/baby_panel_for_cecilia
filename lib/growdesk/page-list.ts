import { BridgeError, requireData, type BridgeFetch } from './bridge-protocol';
/** Complete authorized list, with a hard failure rather than a misleading truncated result. */
export async function fetchScopedPages<T extends {id:string;babyId:string}>(fetchApi:BridgeFetch,token:string,endpoint:string,babyId:string):Promise<T[]> {
  const records:T[]=[],ids=new Set<string>(),cursors=new Set<string>();let cursor:string|null=null;
  for(let count=0;count<200;count++) {
    const query=new URLSearchParams({limit:'100'});if(cursor)query.set('cursor',cursor);
    const response=await fetchApi<T[]>(`${endpoint}?${query}`,{accessToken:token});const data=requireData(response);
    if(!Array.isArray(data)||data.length>100||!response.page||!(response.page.nextCursor===null||typeof response.page.nextCursor==='string'))throw new BridgeError(502,'UPSTREAM_INVALID_PAGE','上游分页数据不完整');
    for(const record of data) {
      if(!record||record.babyId!==babyId||typeof record.id!=='string'||ids.has(record.id))throw new BridgeError(502,'UPSTREAM_SCOPE_MISMATCH','记录归属或分页标识不一致');
      ids.add(record.id);records.push(record);
    }
    cursor=response.page.nextCursor;if(cursor===null)return records;
    if(!cursor||cursors.has(cursor))throw new BridgeError(502,'UPSTREAM_CURSOR_LOOP','上游分页游标重复');cursors.add(cursor);
  }
  throw new BridgeError(503,'HISTORY_SCAN_LIMIT','数据超过完整读取上限，未返回截断结果');
}
