#!/usr/bin/env node
/** Explicit, per-user migration of immutable local history. Default mode is read-only inventory. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const SOURCES = {sessions:'growdesk-ai-sessions.json',jobs:'growdesk-ai-jobs.json',voiceLogs:'growdesk-voice-logs.json',notifications:'growdesk-notifications.json'};
export function canonical(value) {
  if(value===null || typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function options(argv) {
  const result={apply:false};
  for(let i=0;i<argv.length;i++) {
    const key=argv[i];
    if(key==='--apply'){result.apply=true;continue;}
    if(key==='--check-only')continue;
    if(!['--source-dir','--user-id','--api-url','--report'].includes(key)||!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('Invalid arguments');
    if(result[key])throw new Error('Duplicate argument');result[key]=argv[++i];
  }
  if(!result['--source-dir']||!result['--user-id'])throw new Error('--source-dir and --user-id are required');
  return result;
}
export async function migrate(argv,env=process.env) {
  const args=options(argv),directory=await fs.realpath(args['--source-dir']),userId=args['--user-id'];
  const snapshots=[],records=[],report={mode:args.apply?'apply':'check-only',userId,files:[],imported:[],otherOwners:0,archiveVerified:false,productionCutoverApproved:false};
  for(const [kind,name] of Object.entries(SOURCES)) {
    const file=path.join(directory,name);let info;
    try{info=await fs.lstat(file);}catch(error){if(error.code==='ENOENT'){report.files.push({kind,present:false});continue;}throw error;}
    if(!info.isFile()||info.isSymbolicLink()||info.size>128_000_000)throw new Error('Unsafe or oversized source file');
    const bytes=await fs.readFile(file);const list=JSON.parse(bytes.toString('utf8'));
    if(!Array.isArray(list))throw new Error('Expected source array');
    const seen=new Set();let owned=0;
    for(const record of list) {
      if(!record||typeof record!=='object'||Array.isArray(record)||typeof record.userId!=='string'||typeof record.id!=='string'||!record.id)throw new Error('Source record is missing explicit ownership or identity');
      if(seen.has(record.id))throw new Error('Duplicate source identifier');seen.add(record.id);
      if(record.userId!==userId){report.otherOwners++;continue;}
      if(Buffer.byteLength(canonical(record))>16_000_000)throw new Error('Source record exceeds import limit');
      records.push({kind,record,payloadHash:hash(canonical(record))});owned++;
    }
    snapshots.push({file,digest:hash(bytes)});report.files.push({kind,present:true,sha256:hash(bytes),ownedCount:owned,totalCount:list.length});
  }
  if(!snapshots.length)throw new Error('No source history files found');
  if(args.apply) {
    if(!args['--api-url']||!args['--report']||!env.GROWDESK_MIGRATION_ACCESS_TOKEN)throw new Error('Apply requires --api-url, --report and GROWDESK_MIGRATION_ACCESS_TOKEN');
    const base=new URL(args['--api-url']);
    if(base.username||base.password||base.search||base.hash||(base.protocol!=='https:'&&!(base.protocol==='http:'&&['127.0.0.1','[::1]'].includes(base.hostname))))throw new Error('API must use HTTPS or explicit loopback HTTP');
    const reportPath=path.resolve(args['--report']);
    if(snapshots.some(item=>item.file===reportPath))throw new Error('Report cannot replace an input file');
    // An exclusive output reservation prevents overwriting an earlier audit or following a symlink.
    const reportHandle=await fs.open(reportPath,'wx',0o600);
    let written=false;
    try {
      async function api(endpoint,body) {
        const response=await fetch(new URL(base.toString().replace(/\/$/,'')+endpoint),{method:body?'POST':'GET',
          headers:{authorization:`Bearer ${env.GROWDESK_MIGRATION_ACCESS_TOKEN}`,...(body?{'content-type':'application/json'}:{})},
          body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(60_000)});
        if(!response.ok)throw new Error(`History API failed with HTTP ${response.status}; source files were preserved`);
        const result=await response.json();if(!result||typeof result!=='object'||result.data==null)throw new Error('Invalid API envelope');return result.data;
      }
      const me=await api('/api/v1/me');
      if((me.user?.id??me.id)!==userId)throw new Error('Authenticated user does not match --user-id');
      for(const item of records) {
        // Import is idempotent by source ID + payload hash. No hidden network retry or delete.
        const receipt=await api('/api/v1/web/history/import',{kind:item.kind,record:item.record});
        if(receipt.sourceId!==item.record.id||receipt.payloadHash!==item.payloadHash)throw new Error('Import receipt mismatch');
        const query=new URLSearchParams({kind:item.kind,sourceId:item.record.id});
        const exported=await api(`/api/v1/web/history/export?${query}`);
        if(exported.targetId!==receipt.targetId||exported.payloadHash!==item.payloadHash||canonical(exported.record)!==canonical(item.record))throw new Error('Full-field history reconciliation failed');
        report.imported.push({kind:item.kind,sourceId:item.record.id,targetId:receipt.targetId,payloadHash:item.payloadHash});
      }
      for(const item of snapshots)if(hash(await fs.readFile(item.file))!==item.digest)throw new Error('Source changed during migration; capture a fresh snapshot and reconcile');
      report.archiveVerified=true;
      await reportHandle.writeFile(JSON.stringify(report,null,2)+'\n');await reportHandle.sync();written=true;
    } finally {
      if(!written){report.archiveVerified=false;report.failed=true;await reportHandle.writeFile(JSON.stringify(report,null,2)+'\n');await reportHandle.sync();}
      await reportHandle.close();
    }
  }
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  migrate(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{
    // Never echo server payloads, record contents, bearer tokens or fetch error URLs.
    console.error(error instanceof Error && !error.message.includes('Bearer') ? error.message : 'Migration failed; source preserved');process.exitCode=1;
  });
}
