'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, BookOpen, CalendarDays, CheckCircle2, ClipboardList, Pencil, Plus, Search, Shield, Syringe, Trash2 } from 'lucide-react'
import { AppHeader, CuteCard, SegmentControl } from '@/components/ui'
import DataVersionBadge from '@/components/ui/DataVersionBadge'
import { VaccineRecordForm, type VaccineProductOption } from '@/components/health/VaccineRecordForm'
import { useBabyStore } from '@/stores/useBabyStore'
import { useRecordIdentityReady } from '@/lib/hooks/useRecordIdentityReady'
import { getLocalDateStr } from '@/lib/date'
import { showVaccineReference, vaccineRecordDate, type VaccineLedgerRecord, type VaccineRecordInput, type VaccineRecordStatus } from '@/lib/vaccine-records'

interface Vaccine extends VaccineProductOption {
  id: string
  programType: string
  diseases?: string[]
  manualReviewRequired?: boolean | null
  productBrandName?: string | null
  sexRestriction?: string | null
  routineHealthyChildOption?: boolean | null
  doses?: { doseNumber: number; doseLabel?: string; recommendedAgeMonths?: number | null; route?: string | null }[]
  notes?: string | null
}

interface Catalog {
  products: Vaccine[]
  dataRelease?: { asOf?: string | null; sources?: { organization?: string }[] } | null
}

interface EditorState {
  key: string
  babyId: string
  status: VaccineRecordStatus
  record?: VaccineLedgerRecord
  name?: string
  productId?: string | null
  doseNumber?: number
}

const STATUS_LABELS: Record<VaccineRecordStatus, string> = { completed: '已接种', planned: '预约', needs_review: '待核对' }
const STATUS_STYLES: Record<VaccineRecordStatus, string> = {
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  planned: 'border-sky-200 bg-sky-50 text-sky-800',
  needs_review: 'border-amber-200 bg-amber-50 text-amber-900',
}
const PROGRAM_LABELS: Record<string, string> = {
  national_immunization_program: '国家免疫规划',
  provincial_immunization_program: '地方免疫规划',
  non_program: '非免疫规划',
}

function ageLabel(months: number) {
  return months === 0 ? '出生时' : months < 12 ? `${months}月龄` : months % 12 === 0 ? `${months / 12}岁` : `${Math.floor(months / 12)}岁${months % 12}个月`
}

async function readResponse(response: Response) {
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : '请求未成功，请重试。')
  return data
}

export default function VaccinesPage() {
  const baby = useBabyStore(state => state.baby)
  const identityReady = useRecordIdentityReady()
  const babyId = baby?.id
  const currentBaby = useRef(babyId)
  currentBaby.current = babyId
  const recordRequest = useRef(0)
  const [catalog, setCatalog] = useState<Catalog>({ products: [] })
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [recordState, setRecordState] = useState<{ babyId: string; records: VaccineLedgerRecord[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [view, setView] = useState('records')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const records = useMemo(() => recordState && recordState.babyId === babyId ? recordState.records : [], [recordState, babyId])

  const loadCatalog = useCallback(async (signal?: AbortSignal) => {
    setCatalogLoading(true)
    try {
      const data = await readResponse(await fetch('/api/vaccines', { headers: { 'x-growdesk-representation': 'extended' }, signal }))
      const products = [...(data.national ?? []), ...(data.provincial ?? []), ...(data.nonProgram ?? [])]
      if (!signal?.aborted) {
        setCatalog({ products, dataRelease: data.dataRelease })
        setCatalogError(null)
      }
    } catch (cause) {
      if (!signal?.aborted) setCatalogError(cause instanceof Error ? cause.message : '疫苗资料加载失败')
    } finally {
      if (!signal?.aborted) setCatalogLoading(false)
    }
  }, [])

  const loadRecords = useCallback(async (signal?: AbortSignal) => {
    if (!babyId || !identityReady) return
    const request = ++recordRequest.current
    const isCurrent = () => !signal?.aborted && currentBaby.current === babyId && request === recordRequest.current
    setLoading(true)
    try {
      const query = new URLSearchParams({ view: 'records', babyId })
      const data = await readResponse(await fetch(`/api/vaccines?${query}`, { cache: 'no-store', signal }))
      if (!Array.isArray(data.records) || data.records.some((record: VaccineLedgerRecord) => record.babyId !== babyId)) {
        throw new Error('接种记录的宝宝信息不一致，请刷新后重试。')
      }
      if (isCurrent()) {
        setRecordState({ babyId, records: data.records })
        setError(null)
      }
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : '接种记录加载失败')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [babyId, identityReady])

  useEffect(() => {
    const controller = new AbortController()
    void loadCatalog(controller.signal)
    return () => controller.abort()
  }, [loadCatalog])

  useEffect(() => {
    const controller = new AbortController()
    setRecordState(null)
    setEditor(null)
    setDeleteId(null)
    setError(null)
    setMessage(null)
    void loadRecords(controller.signal)
    return () => controller.abort()
  }, [loadRecords])

  const openEditor = (status: VaccineRecordStatus, record?: VaccineLedgerRecord, product?: Vaccine) => {
    if (!babyId || !identityReady) return
    setMessage(null)
    setEditor({ key: crypto.randomUUID(), babyId, status, record, name: product?.shortName ?? product?.name, productId: product?.vaccineId })
  }

  const saveRecord = async (input: VaccineRecordInput, keepOpen: boolean) => {
    if (!editor || !babyId || editor.babyId !== babyId || useBabyStore.getState().baby?.id !== babyId) {
      throw new Error('当前宝宝已切换，请关闭后为当前宝宝重新录入。')
    }
    const data = await readResponse(await fetch('/api/vaccines', {
      method: editor.record ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, babyId, ...(editor.record ? { id: editor.record.id, baseVersion: editor.record.version } : { clientId: editor.key }) }),
    }))
    if (!data.record || data.record.babyId !== babyId) throw new Error('服务器未返回完整记录，请刷新列表核对。')
    if (currentBaby.current !== babyId) return
    recordRequest.current += 1
    setLoading(false)
    setRecordState(previous => ({ babyId, records: [data.record, ...(previous?.babyId === babyId ? previous.records : []).filter(item => item.id !== data.record.id)] }))
    setMessage(`${STATUS_LABELS[input.recordStatus]}记录已保存。`)
    setView('records')
    setFilter(input.recordStatus)
    setSearch('')
    setEditor(keepOpen ? { key: crypto.randomUUID(), babyId, status: input.recordStatus, name: input.name, productId: input.vaccineId } : null)
  }

  const deleteRecord = async (record: VaccineLedgerRecord) => {
    if (deleting || !babyId || record.babyId !== babyId || useBabyStore.getState().baby?.id !== babyId) return
    setDeleting(true)
    setError(null)
    try {
      const query = new URLSearchParams({ id: record.id, babyId, baseVersion: record.version })
      await readResponse(await fetch(`/api/vaccines?${query}`, { method: 'DELETE' }))
      if (currentBaby.current === babyId) {
        recordRequest.current += 1
        setLoading(false)
        setRecordState(previous => previous?.babyId === babyId ? { babyId, records: previous.records.filter(item => item.id !== record.id) } : previous)
        setDeleteId(null)
        setMessage('这条记录已删除。')
      }
    } catch (cause) {
      if (currentBaby.current === babyId) setError(cause instanceof Error ? cause.message : '删除失败，请重试。')
    } finally { setDeleting(false) }
  }

  const counts = useMemo(() => ({
    completed: records.filter(record => record.recordStatus === 'completed').length,
    planned: records.filter(record => record.recordStatus === 'planned').length,
    needs_review: records.filter(record => record.recordStatus === 'needs_review').length,
  }), [records])
  const visibleRecords = useMemo(() => records
    .filter(record => filter === 'all' || record.recordStatus === filter)
    .filter(record => !search.trim() || [record.name, record.manufacturer, record.clinic, record.batchNumber, record.dose].some(value => value?.toLowerCase().includes(search.trim().toLowerCase())))
    .sort((left, right) => {
      const a = vaccineRecordDate(left) ?? ''
      const b = vaccineRecordDate(right) ?? ''
      return filter === 'planned' ? a.localeCompare(b) : b.localeCompare(a)
    }), [records, filter, search])
  const nextAppointment = records.filter(record => record.recordStatus === 'planned' && record.scheduledDate && record.scheduledDate >= getLocalDateStr())
    .sort((a, b) => a.scheduledDate!.localeCompare(b.scheduledDate!))[0]
  const products = useMemo(() => catalog.products.filter(product => showVaccineReference(product, baby?.gender))
    .filter(product => !search.trim() || [product.name, product.shortName, product.englishName, product.productManufacturer, product.productBrandName]
      .some(value => value?.toLowerCase().includes(search.trim().toLowerCase()))), [catalog.products, baby?.gender, search])

  return (
    <div className="mx-auto min-h-screen max-w-5xl bg-bg pb-36 workbench:pb-12">
      <AppHeader title="疫苗接种本" onRefresh={async () => { await Promise.allSettled([loadCatalog(), loadRecords()]) }} refreshing={loading} />
      <div className="space-y-4 px-4 pt-3">
        <div className="flex items-center justify-between gap-3 text-sm text-text-secondary">
          <p className="min-w-0 truncate font-semibold">{baby?.nickname ?? '宝宝'}的接种记录</p>
          <Link href="/health/medical" className="shrink-0 py-3 text-primary">化验与体检</Link>
        </div>
        <CuteCard variant="gradient" className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="rounded-2xl bg-card p-3 text-primary"><ClipboardList size={24} /></span>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-text-primary">把疫苗本上的每一针记清楚</h2>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">按真实接种日期补录，也可以单独记预约或暂存看不清的内容。</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(STATUS_LABELS) as VaccineRecordStatus[]).map(status => <button key={status} type="button"
              onClick={() => { setView('records'); setFilter(status); setSearch('') }}
              className="min-h-16 rounded-2xl bg-card/80 px-2 py-2 text-center focus-visible:outline-2 focus-visible:outline-primary">
              <span className="block text-xl font-bold text-text-primary">{counts[status]}</span><span className="text-xs text-text-secondary">{STATUS_LABELS[status]}{status === 'completed' ? '记录' : ''}</span>
            </button>)}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!identityReady} onClick={() => openEditor('completed')} className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-white shadow-button disabled:opacity-50"><Plus size={18} />补录已接种</button>
            <button type="button" disabled={!identityReady} onClick={() => openEditor('planned')} className="flex min-h-11 items-center gap-2 rounded-full border border-primary/30 bg-card px-4 py-3 text-sm font-semibold text-primary disabled:opacity-50"><CalendarDays size={17} />记录预约</button>
            <button type="button" disabled={!identityReady} onClick={() => openEditor('needs_review')} className="min-h-11 rounded-full px-3 py-3 text-sm font-medium text-text-secondary disabled:opacity-50">先存待核对</button>
          </div>
        </CuteCard>
        {!identityReady && !babyId && <CuteCard><p className="text-sm text-text-secondary">请先选择宝宝，再查看或补录接种记录。</p><Link href="/onboarding" className="mt-2 inline-flex min-h-11 items-center font-semibold text-primary">设置宝宝资料</Link></CuteCard>}
        {nextAppointment && <button type="button" onClick={() => { setView('records'); setFilter('planned'); setSearch('') }} className="flex w-full items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-left text-sky-900">
          <CalendarDays size={20} className="shrink-0" /><span className="min-w-0 text-sm"><span className="font-bold">下次已记预约 · {nextAppointment.scheduledDate}</span><span className="mt-1 block break-words">{nextAppointment.name} · {nextAppointment.doseNumber ? `第${nextAppointment.doseNumber}剂` : '剂次待核对'}</span></span>
        </button>}
        <SegmentControl options={[{ value: 'records', label: '我的接种本' }, { value: 'reference', label: '疫苗资料' }]} value={view} onChange={value => { setView(value); setSearch('') }} />
        {message && <p role="status" className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
        {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><p>{error}</p><button type="button" onClick={() => void loadRecords()} className="mt-1 min-h-11 font-semibold underline">重新加载接种记录</button></div>}
        <label className="flex items-center gap-2 rounded-2xl border border-primary-soft bg-card px-3 text-text-secondary">
          <Search size={18} className="shrink-0" />
          <input type="search" aria-label={view === 'records' ? '搜索接种记录' : '搜索疫苗资料'} placeholder={view === 'records' ? '搜索疫苗名称、厂家或接种单位' : '搜索疫苗名称或产品'} value={search} onChange={event => setSearch(event.target.value)} className="min-h-12 w-full min-w-0 bg-transparent text-base text-text-primary outline-none" />
        </label>
        {view === 'records' ? <>
          <SegmentControl value={filter} onChange={setFilter} options={[{ value: 'all', label: '全部' }, { value: 'completed', label: '已接种' }, { value: 'planned', label: '预约' }, { value: 'needs_review', label: '待核对' }]} />
          {loading && <p role="status" className="py-3 text-center text-sm text-text-secondary">正在加载接种记录…</p>}
          {!loading && !error && visibleRecords.length === 0 && <CuteCard className="py-8 text-center">
            <BookOpen size={32} className="mx-auto mb-3 text-primary/60" />
            <h3 className="font-semibold text-text-primary">{search ? '没有找到匹配的记录' : records.length ? '这里还没有记录' : '从疫苗本上的一条记录开始'}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-secondary">{search ? '试试疫苗原名或接种单位。' : '选择疫苗、填写实际日期即可保存。厂家、批号等信息可以以后补充；不确定的内容先放入待核对。'}</p>
          </CuteCard>}
          <div className="space-y-3">{visibleRecords.map(record => {
            const date = vaccineRecordDate(record)
            const doseLabel = record.doseNumber ? `第${record.doseNumber}剂` : '剂次待核对'
            const product = catalog.products.find(item => item.vaccineId === record.vaccineId)
            const metadata = [['生产企业', record.manufacturer], ['批号', record.batchNumber], ['电子追溯码', record.traceCode], ['接种途径', record.administrationRoute], ['接种部位', record.injectionSite], ['原预约日期', record.recordStatus === 'completed' ? record.scheduledDate : null]]
            return <CuteCard key={record.id} className="border border-primary/10">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[record.recordStatus]}`}>{STATUS_LABELS[record.recordStatus]}</span><span className="text-sm font-semibold text-text-secondary">{date ?? '日期 / 用途待核对'}</span></div>
                  <h3 className="break-words text-base font-bold text-text-primary">{record.name}</h3>
                  <p className="mt-1 text-sm text-text-secondary">{doseLabel}{record.clinic ? ` · ${record.clinic}` : ''}</p>
                  {product && product.name !== record.name && <p className="mt-1 break-words text-xs text-text-secondary">对应产品：{product.name}</p>}
                  {!product && !record.vaccineId && <p className="mt-1 text-xs text-text-secondary">按原文保存 · 具体产品待确认</p>}
                  {record.recordStatus === 'planned' && date && date < getLocalDateStr() && <p className="mt-2 text-xs text-amber-800">已过预约日期，请核对是否接种或调整预约。</p>}
                </div>
                <button type="button" onClick={() => openEditor(record.recordStatus, record)} aria-label={`编辑 ${record.name} ${doseLabel}`} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full bg-primary-light px-3 text-sm font-semibold text-primary"><Pencil size={15} /><span className="hidden sm:inline">编辑</span></button>
              </div>
              {(metadata.some(([, value]) => value) || record.notes || record.sourceText) && <details className="mt-3 border-t border-primary/10 pt-2">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-text-secondary">查看接种与追溯详情</summary>
                <dl className="grid gap-x-4 gap-y-3 py-2 text-sm sm:grid-cols-2">{metadata.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="mt-1 break-all text-text-primary">{value}</dd></div>)}</dl>
                {record.sourceText && <div className="mt-2 rounded-2xl bg-primary-light/40 p-3 text-sm"><p className="mb-1 font-semibold">疫苗本原文 / 待核对内容</p><p className="whitespace-pre-wrap break-words text-text-secondary">{record.sourceText}</p></div>}
                {record.notes && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-text-secondary">备注：{record.notes}</p>}
              </details>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-primary/10 pt-2">
                {record.recordStatus !== 'completed' ? <button type="button" onClick={() => {
                  openEditor('completed', { ...record, recordStatus: 'completed', isCompleted: true, administeredDate: null, completedDate: null })
                }} className="flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary"><CheckCircle2 size={16} />核对并填写接种日期</button> : <span className="py-2 text-xs text-text-secondary">一条记录对应一次实际接种</span>}
                <button type="button" onClick={() => setDeleteId(record.id)} aria-label={`删除 ${record.name} ${doseLabel}`} className="flex min-h-11 items-center gap-1.5 px-2 text-sm text-text-secondary"><Trash2 size={14} />删除</button>
              </div>
              {deleteId === record.id && <div role="alert" className="mt-2 rounded-2xl bg-rose-50 p-3 text-sm text-rose-900"><p>确认删除这条“{record.name} {doseLabel}”记录？</p><div className="mt-2 flex gap-3"><button type="button" disabled={deleting} onClick={() => void deleteRecord(record)} className="min-h-11 rounded-full bg-rose-700 px-4 font-semibold text-white disabled:opacity-50">{deleting ? '删除中…' : '确认删除'}</button><button type="button" disabled={deleting} onClick={() => setDeleteId(null)} className="min-h-11 px-4">保留记录</button></div></div>}
            </CuteCard>
          })}</div>
          <p className="px-1 text-xs leading-relaxed text-text-secondary">“待核对”不会计入已接种或预约提醒。五联等联合疫苗按实际产品记录一次；这里的记录条数不代表免疫程序已完成。</p>
        </> : <>
          <CuteCard><p className="flex items-start gap-2 text-sm leading-relaxed text-text-secondary"><Shield size={18} className="mt-0.5 shrink-0 text-primary" />以下是产品与参考程序，实际预约以接种门诊确认为准。不同产品的剂次不自动合并；请先补齐真实记录，再核对后续安排。</p></CuteCard>
          {catalogError && <p role="alert" className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">疫苗资料暂未加载：{catalogError}。仍可按疫苗本原名补录。<button type="button" onClick={() => void loadCatalog()} className="ml-2 min-h-11 font-semibold underline">重试</button></p>}
          {catalogLoading && <p role="status" className="py-4 text-center text-sm text-text-secondary">正在加载疫苗资料…</p>}
          <div className="space-y-3">{products.map(product => {
            const productRecords = records.filter(record => record.recordStatus === 'completed' && record.vaccineId === product.vaccineId)
            return <CuteCard key={product.vaccineId}>
              <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-primary-light px-2.5 py-1 text-xs text-primary">{PROGRAM_LABELS[product.programType] ?? product.programType}</span>{productRecords.length > 0 && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800">已有 {productRecords.length} 条接种记录</span>}</div>
              <h3 className="mt-2 break-words font-bold text-text-primary">{product.name}</h3>
              {product.shortName && <p className="mt-1 text-sm text-text-secondary">{product.shortName}</p>}
              {product.diseases?.length ? <p className="mt-2 text-sm text-text-secondary">预防：{product.diseases.join('、')}</p> : null}
              {product.doses?.length ? <details className="mt-2"><summary className="flex min-h-11 cursor-pointer items-center text-sm text-primary">查看参考剂次</summary><ul className="space-y-1 text-sm text-text-secondary">{product.doses.map(dose => <li key={dose.doseNumber}>{dose.doseLabel ?? `第${dose.doseNumber}剂`}{dose.recommendedAgeMonths != null ? ` · 参考${ageLabel(dose.recommendedAgeMonths)}` : ''}{dose.route ? ` · ${dose.route}` : ''}</li>)}</ul></details> : null}
              {product.manualReviewRequired && <p className="mt-2 flex items-center gap-1 text-xs text-amber-800"><AlertTriangle size={13} />方案需接种门诊确认</p>}
              <button type="button" disabled={!identityReady} onClick={() => openEditor('completed', undefined, product)} className="mt-3 flex min-h-11 items-center gap-2 rounded-full bg-primary-light px-4 text-sm font-semibold text-primary disabled:opacity-50"><Syringe size={15} />补录该产品</button>
            </CuteCard>
          })}</div>
          {!catalogLoading && !catalogError && products.length === 0 && <p className="py-6 text-center text-sm text-text-secondary">未找到对应产品，可按疫苗本原名保存接种记录。</p>}
          <DataVersionBadge organization={catalog.dataRelease?.sources?.[0]?.organization ?? '资料库'} asOf={catalog.dataRelease?.asOf ?? '未知'} />
        </>}
      </div>
      {editor && editor.babyId === babyId && <VaccineRecordForm key={editor.key} record={editor.record} initialStatus={editor.status}
        initialName={editor.name} initialProductId={editor.productId} initialDoseNumber={editor.doseNumber}
        birthDate={baby?.birthDate} products={catalog.products} records={records} onSave={saveRecord} onClose={() => setEditor(null)} />}
    </div>
  )
}
