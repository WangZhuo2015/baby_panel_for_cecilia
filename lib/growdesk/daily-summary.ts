import { BridgeError, calendarDate, pathId, type BridgeFetch } from './bridge-protocol';
import { loadWebBaby } from './bridge-identity';
import { familyTimeZone } from './record-list';
import { fetchScopedPages } from './page-list';
import { createBackgroundClient } from './background-client';
import { fetchDailyComprehensiveMetrics, generateCuratedDailySummary } from '@/lib/ai-daily-summary';
import type { AiDailySummaryResult, AiDailySummarySections } from '@/types/daily-summary';
interface SummaryRow {id:string;babyId:string;targetDate:string;content:string;createdAt:string}
export async function readWebDailySummary(fetchApi:BridgeFetch,token:string,userId:string,requestedBaby:unknown,dateValue:unknown) {
  const baby=await loadWebBaby(fetchApi,token,requestedBaby);
  if(!baby)throw new BridgeError(404,'BABY_NOT_FOUND','请先选择宝宝');
  let date:string;
  if(dateValue!==undefined&&dateValue!==null&&dateValue!=='')date=calendarDate(dateValue);
  else {
    const timeZone=await familyTimeZone(fetchApi,token,baby.id);
    date=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  }
  const rows=await fetchScopedPages<SummaryRow>(fetchApi,token,`/api/v1/babies/${pathId(baby.id)}/daily-summaries`,baby.id);
  const stored=rows.find(row=>row.targetDate===date);
  const metrics=await fetchDailyComprehensiveMetrics({userId,babyId:baby.id,baby,familyId:baby.familyId,accessToken:token},date);
  // Reuse existing age/avatar formatting, not its rule-based health evaluation.
  const metadata=generateCuratedDailySummary(baby,metrics);
  const base:AiDailySummaryResult={...metadata,overallScore:'记录汇总（不作健康评分）',overallRating:0,statusLevel:'good',
    headline: '当日记录汇总；AI 解读需要显式点击生成',highlights:[],suggestedQuestions:[],isAiGenerated:false,
    sections:{feeding:`已记录 ${metrics.feedingCount} 次喂养。`,sleep:`已记录 ${metrics.sleepCount} 段睡眠。`,diaper:`已记录 ${metrics.diaperCount} 次尿布。`,growthAndCare:`已记录 ${metrics.supplementsCount} 次补剂和 ${metrics.medicalReportsCount} 份报告。`,tomorrowTips:'缺失记录不代表未发生。请按实际情况补充和核对。'},
    disclaimer:'这是记录汇总，不是健康评分、诊断或治疗建议。',generatedAt:new Date().toISOString()};
  if(!stored)return {summary:base,needsGeneration:true};
  let parsed:Record<string,unknown>;
  try { parsed=JSON.parse(stored.content); }
  catch {
    // Historical canonical summaries were Markdown, not the new structured format.
    if(stored.content.trim().startsWith('{'))throw new BridgeError(502,'INVALID_SUMMARY','已保存的日报 JSON 无效，未用空数据替代');
    return {summary:{...base,headline:'已保存的历史日报',sections:{...base.sections,growthAndCare:stored.content},isAiGenerated:true,generatedAt:stored.createdAt},needsGeneration:false};
  }
  if(!parsed||typeof parsed!=='object'||typeof parsed.headline!=='string'||!parsed.sections||typeof parsed.sections!=='object'||Array.isArray(parsed.sections))throw new BridgeError(502,'INVALID_SUMMARY','已保存的日报结构无效');
  const sections=parsed.sections as Record<string,unknown>;
  for(const key of ['feeding','sleep','diaper','growthAndCare','tomorrowTips'])if(typeof sections[key]!=='string')throw new BridgeError(502,'INVALID_SUMMARY','日报分节缺失');
  if(parsed.babyId!==undefined&&parsed.babyId!==baby.id)throw new BridgeError(502,'INVALID_SUMMARY_SCOPE','日报宝宝归属不一致');
  return {summary:{...base,headline:parsed.headline,sections:sections as unknown as AiDailySummarySections,
    highlights:Array.isArray(parsed.highlights)?parsed.highlights.filter((x):x is string=>typeof x==='string'):[],
    suggestedQuestions:Array.isArray(parsed.suggestedQuestions)?parsed.suggestedQuestions.filter((x):x is string=>typeof x==='string'):[],
    isAiGenerated:true,generatedAt:stored.createdAt},needsGeneration:false};
}
export async function enqueueWebDailySummary(fetchApi:BridgeFetch,token:string,userId:string,body:Record<string,unknown>) {
  const baby=await loadWebBaby(fetchApi,token,body.babyId);
  if(!baby)throw new BridgeError(404,'BABY_NOT_FOUND','请先选择宝宝');
  const date=calendarDate(body.date);
  return createBackgroundClient(fetchApi).createJob({userId,babyId:baby.id,type:'daily_summary_synthesis',targetDate:date,
    clientRequestId:typeof body.clientRequestId==='string'?body.clientRequestId:'',accessToken:token});
}
