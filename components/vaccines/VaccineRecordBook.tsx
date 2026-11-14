'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, CheckCircle2, ClipboardList, Loader2, Pencil, Plus, Search, Syringe, Trash2, X } from 'lucide-react'
import { CuteInput } from '@/components/ui/CuteInput'
import { getLocalDateStr } from '@/lib/date'

export interface VaccineBookRecord {
  id: string
  babyId: string
  name: string
  vaccineId?: string | null
  dose: string | null
  doseNumber: number | null
  scheduledDate: string | null
  completedDate: string | null
  isCompleted: boolean
  clinic: string | null
  manufacturer: string | null
  productName: string | null
  batchNumber: string | null
  traceabilityCode: string | null
  injectionSite: string | null
  notes: string | null
  version: string
}

interface CatalogOption { vaccineId: string; name: string }
export interface VaccineBookRequest {
  key: number
  babyId: string
  mode: 'completed' | 'planned' | 'view'
  vaccineId: string
  name: string
  doseNumber: number
  recordId?: string | null
}
type Draft = Partial<VaccineBookRecord> & { isCompleted: boolean }
const actionClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null)
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  if (!response.ok) {
    const detail = body?.error
    const message = typeof detail === 'string' ? detail : detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string' ? detail.message : null
    const conflictCode = body?.code ?? (detail && typeof detail === 'object' && 'code' in detail ? detail.code : null)
    throw new Error(response.status === 409 && (conflictCode === 'VERSION_CONFLICT' || conflictCode === 'CONCURRENCY_CONFLICT')
      ? '这条记录已被其他设备修改。请保留本次填写内容，关闭后刷新记录，再核对更正。'
      : message || '暂时无法保存，请检查连接后重试。')
  }
  if (!body || typeof body !== 'object') throw new Error('返回的记录不完整，请刷新后核对保存结果。')
  return body
}

function doseLabel(record: Pick<VaccineBookRecord, 'dose' | 'doseNumber'>): string {
  return record.dose || (record.doseNumber ? `第${record.doseNumber}剂` : '剂次待核对')
}

function knownDose(raw: string): number | null {
  const match = raw.trim().match(/^(?:第\s*)?([1-9]|1[0-2])\s*(?:剂|针)?$/)
  return match ? Number(match[1]) : null
}

export function VaccineRecordBook({ babyId, vaccines, request, refreshKey, onSaved }: {
  babyId?: string
  vaccines: CatalogOption[]
  request: VaccineBookRequest | null
  refreshKey: number
  onSaved: () => void
}) {
  const [snapshot, setSnapshot] = useState<{ babyId: string; records: VaccineBookRecord[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [tab, setTab] = useState<'completed' | 'planned'>('completed')
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<{ key: string; babyId: string; generation: number; initial: Draft } | null>(null)
  const [referenceFilter, setReferenceFilter] = useState<VaccineBookRequest | null>(null)
  const [retry, setRetry] = useState(0)
  const scope = useRef({ babyId, generation: 0 })
  if (scope.current.babyId !== babyId) scope.current = { babyId, generation: scope.current.generation + 1 }
  const activeEditor = useRef(editor)
  activeEditor.current = editor
  const consumedRequest = useRef<number | null>(null)
  const loadSequence = useRef(0)
  const records = snapshot && snapshot.babyId === babyId ? snapshot.records : []

  useEffect(() => {
    setEditor(null)
    setSearch('')
    setReferenceFilter(null)
    setNotice(null)
    setError(null)
  }, [babyId])

  useEffect(() => {
    if (!babyId) { setSnapshot(null); return }
    const controller = new AbortController()
    const sequence = ++loadSequence.current
    setLoading(true)
    setError(null)
    fetch(`/api/vaccines/records?${new URLSearchParams({ babyId })}`, { signal: controller.signal, cache: 'no-store' })
      .then(responseBody)
      .then(body => {
        if (!Array.isArray(body.records) || body.records.some((record: VaccineBookRecord) => record.babyId !== babyId)) {
          throw new Error('接种记录返回异常，请刷新重试。')
        }
        if (!controller.signal.aborted && sequence === loadSequence.current) setSnapshot({ babyId, records: body.records as VaccineBookRecord[] })
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '加载接种记录失败') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [babyId, refreshKey, retry])

  const open = useCallback((initial: Draft) => {
    if (!babyId) return
    setNotice(null)
    setEditor({ key: crypto.randomUUID(), babyId, generation: scope.current.generation, initial })
  }, [babyId])

  useEffect(() => {
    if (!request || !babyId || request.babyId !== babyId || request.key === consumedRequest.current) return
    consumedRequest.current = request.key
    if (request.mode === 'view') {
      setTab('completed')
      setSearch('')
      setReferenceFilter(request)
      return
    }
    open({ isCompleted: request.mode === 'completed', vaccineId: request.vaccineId, name: request.name, dose: `第${request.doseNumber}剂`, doseNumber: request.doseNumber })
  }, [request, babyId, open])

  const completed = records.filter(record => record.isCompleted)
  const planned = records.filter(record => !record.isCompleted)
  const needle = search.trim().toLocaleLowerCase()
  const visible = (tab === 'completed' ? completed : planned)
    .filter(record => !referenceFilter || record.id === referenceFilter.recordId || (record.vaccineId === referenceFilter.vaccineId && record.doseNumber === referenceFilter.doseNumber))
    .filter(record => !needle || [record.name, record.productName, record.manufacturer, record.clinic, record.batchNumber, record.traceabilityCode].some(value => value?.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => tab === 'completed'
      ? (b.completedDate || '').localeCompare(a.completedDate || '')
      : (a.scheduledDate || '9999').localeCompare(b.scheduledDate || '9999'))

  const saved = (record: VaccineBookRecord, sessionKey: string, generation: number, removed = false) => {
    if (record.babyId !== scope.current.babyId || generation !== scope.current.generation || activeEditor.current?.key !== sessionKey) return
    loadSequence.current += 1
    setSnapshot(previous => ({ babyId: record.babyId, records: [
      ...(removed ? [] : [record]),
      ...(previous?.babyId === record.babyId ? previous.records.filter(item => item.id !== record.id) : []),
    ] }))
    setTab(record.isCompleted ? 'completed' : 'planned')
    setSearch('')
    setReferenceFilter(null)
    setEditor(null)
    setNotice(removed ? '记录已删除。' : record.isCompleted ? '接种记录已保存。' : '预约已保存，接种后可补充实际日期。')
    onSaved()
  }

  if (!babyId) return <div className="rounded-3xl border border-primary-soft bg-white p-6 text-center text-sm text-text-secondary">请先登录并选择宝宝，再录入接种记录。</div>

  return <section aria-label="接种记录本" className="space-y-4">
    <div className="rounded-3xl border border-primary/20 bg-white p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-light text-primary"><ClipboardList size={23} /></span>
        <div>
          <h2 className="text-lg font-bold text-text-primary">把疫苗本上的记录存好</h2>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">按本上的实际日期补录。名称和剂次可以照抄，不清楚的信息留空，之后再核对。</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
        <button type="button" className={`${actionClass} bg-primary text-white hover:bg-primary-dark`} onClick={() => open({ isCompleted: true })}><Plus size={18} />补录已接种</button>
        <button type="button" className={`${actionClass} border border-primary-soft bg-primary-light text-text-primary hover:bg-primary-soft`} onClick={() => open({ isCompleted: false })}><CalendarDays size={18} />添加预约</button>
      </div>
    </div>

    {notice && <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-2 min-h-11 font-semibold underline">重新加载</button></div>}

    <div className="flex gap-2" aria-label="记录分类">
      {(['completed', 'planned'] as const).map(value => <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)} className={`${actionClass} flex-1 ${tab === value ? 'bg-text-primary text-white' : 'border border-primary-soft bg-white text-text-secondary'}`}>{value === 'completed' ? `已接种 · ${completed.length}` : `预约 · ${planned.length}`}</button>)}
    </div>
    <label className="flex items-center gap-2 rounded-2xl border border-primary-soft bg-white px-3 py-1">
      <Search size={18} aria-hidden="true" className="shrink-0 text-text-secondary" />
      <span className="sr-only">搜索接种记录</span>
      <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索疫苗、厂商、批号或接种单位" className="min-h-11 min-w-0 flex-1 bg-transparent text-base text-text-primary outline-none" />
    </label>
    {referenceFilter && <div className="flex items-center justify-between gap-2 rounded-2xl bg-primary-light px-3 py-2 text-sm"><span>正在查看：{referenceFilter.name} · 第{referenceFilter.doseNumber}剂</span><button type="button" className="min-h-11 shrink-0 px-2 font-semibold text-primary" onClick={() => setReferenceFilter(null)}>查看全部</button></div>}

    {loading && <p role="status" className="flex items-center gap-2 px-2 text-sm text-text-secondary"><Loader2 size={16} className="animate-spin" />正在加载记录…</p>}
    {!loading && !error && visible.length === 0 && <div className="rounded-3xl border border-dashed border-primary-soft bg-white/60 px-5 py-8 text-center">
      <Syringe className="mx-auto mb-3 text-primary" size={28} />
      <h3 className="font-semibold text-text-primary">{needle || referenceFilter ? '没有找到匹配的记录' : tab === 'completed' ? '还没有录入已接种记录' : '暂时没有预约'}</h3>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">{referenceFilter ? '可以选择“查看全部”，按疫苗本上的原名核对；旧记录可能尚未关联参考目录。' : needle ? '可以试试本上的名称、生产企业或批号。' : tab === 'completed' ? '从疫苗本上任选一条开始。这里尚未录入，不代表没有接种。' : '有门诊预约日期后再添加，实际接种时补录实际日期。'}</p>
      {needle && <button type="button" onClick={() => setSearch('')} className={`${actionClass} mt-3 text-primary`}>查看全部记录</button>}
    </div>}

    <div className="space-y-3">
      {visible.map(record => <article key={record.id} className="rounded-3xl border border-primary/15 bg-white p-4 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className={`mb-1 flex items-center gap-1.5 text-xs font-semibold ${record.isCompleted ? 'text-emerald-800' : 'text-sky-800'}`}>{record.isCompleted ? <CheckCircle2 size={14} /> : <CalendarDays size={14} />}{record.isCompleted ? '已接种' : '预约'} · {record.isCompleted ? record.completedDate || '实际日期待核对' : record.scheduledDate || '预约日期待核对'}</p>
            <h3 className="break-words font-bold text-text-primary">{record.name}</h3>
            <p className="mt-1 text-sm text-text-secondary">{doseLabel(record)}{record.productName ? ` · ${record.productName}` : ''}</p>
            {record.clinic && <p className="mt-1 break-words text-xs text-text-secondary">{record.clinic}</p>}
          </div>
          <button type="button" aria-label={`更正${record.name}的记录`} onClick={() => open(record)} className={`${actionClass} shrink-0 bg-primary-light px-3 text-text-primary`}><Pencil size={15} /><span>更正</span></button>
        </div>
        <details className="mt-3 border-t border-primary-light pt-2">
          <summary className="cursor-pointer py-2 text-sm font-medium text-text-secondary">查看接种详情</summary>
          <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 pb-1 pt-2 text-sm">
            {([['生产企业', record.manufacturer], ['产品 / 品牌', record.productName], ['批号', record.batchNumber], ['电子追溯码', record.traceabilityCode], ['接种单位', record.clinic], ['接种部位', record.injectionSite], [record.isCompleted ? '原预约日期' : '预约日期', record.scheduledDate], ['备注', record.notes]] as const).filter(([, value]) => value).map(([label, value]) => <div key={label} className="contents"><dt className="text-text-secondary">{label}</dt><dd className="whitespace-pre-wrap break-all text-text-primary">{value}</dd></div>)}
            {!record.manufacturer && !record.batchNumber && !record.traceabilityCode && !record.clinic && !record.injectionSite && !record.productName && !record.notes && !record.scheduledDate && <p className="col-span-2 text-text-secondary">暂未补充详细信息，可在“更正”中照本填写。</p>}
          </dl>
        </details>
        {!record.isCompleted && <button type="button" onClick={() => open({ ...record, isCompleted: true, completedDate: null })} className={`${actionClass} mt-2 w-full bg-emerald-50 text-emerald-900`}><CheckCircle2 size={17} />记录本次接种</button>}
      </article>)}
    </div>
    {editor && editor.babyId === babyId && <VaccineRecordEditor key={editor.key} initial={editor.initial} babyId={editor.babyId} clientId={editor.key} vaccines={vaccines} onClose={() => setEditor(null)} onSaved={(record, removed) => saved(record, editor.key, editor.generation, removed)} />}
  </section>
}

function VaccineRecordEditor({ initial, babyId, clientId, vaccines, onClose, onSaved }: {
  initial: Draft; babyId: string; clientId: string; vaccines: CatalogOption[]
  onClose: () => void; onSaved: (record: VaccineBookRecord, removed?: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [completed, setCompleted] = useState(initial.isCompleted)
  const [name, setName] = useState(initial.name || '')
  const [vaccineId, setVaccineId] = useState(initial.vaccineId === 'unmapped' ? '' : initial.vaccineId || '')
  const [dose, setDose] = useState(initial.dose || (initial.doseNumber ? `第${initial.doseNumber}剂` : ''))
  const [actualDate, setActualDate] = useState(initial.completedDate || '')
  const [plannedDate, setPlannedDate] = useState(initial.scheduledDate || '')
  const [clinic, setClinic] = useState(initial.clinic || '')
  const [manufacturer, setManufacturer] = useState(initial.manufacturer || '')
  const [productName, setProductName] = useState(initial.productName || '')
  const [batchNumber, setBatchNumber] = useState(initial.batchNumber || '')
  const [traceabilityCode, setTraceabilityCode] = useState(initial.traceabilityCode || '')
  const [injectionSite, setInjectionSite] = useState(initial.injectionSite || '')
  const [notes, setNotes] = useState(initial.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const mutationInFlight = useRef(false)
  const editing = Boolean(initial.id)

  useEffect(() => { dialog.current?.showModal() }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutationInFlight.current) return
    if (!name.trim() || !(completed ? actualDate : plannedDate)) { setError(completed ? '请填写疫苗名称和本上的实际接种日期。' : '请填写疫苗名称和明确的预约日期。'); return }
    if (editing && !initial.version) { setError('缺少记录版本，请关闭后刷新再更正。'); return }
    mutationInFlight.current = true
    setSaving(true); setError(null)
    try {
      const nullable = (value: string) => value.trim() || null
      const body = await responseBody(await fetch('/api/vaccines', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ babyId, clientId, ...(editing ? { id: initial.id, baseVersion: initial.version } : {}),
          name: name.trim(), vaccineId: nullable(vaccineId), dose: nullable(dose), doseNumber: dose === (initial.dose || (initial.doseNumber ? `第${initial.doseNumber}剂` : '')) ? initial.doseNumber ?? knownDose(dose) : knownDose(dose),
          isCompleted: completed, completedDate: completed ? actualDate : null, scheduledDate: nullable(plannedDate),
          clinic: nullable(clinic), manufacturer: nullable(manufacturer), productName: nullable(productName),
          batchNumber: nullable(batchNumber), traceabilityCode: nullable(traceabilityCode), injectionSite: nullable(injectionSite), notes: nullable(notes),
        }),
      }))
      const record = body.record as VaccineBookRecord | undefined
      if (!record?.id || record.babyId !== babyId) throw new Error('保存结果不完整，请关闭后刷新，核对是否已经保存。')
      onSaved(record)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，填写内容已保留。') }
    finally { mutationInFlight.current = false; setSaving(false) }
  }

  async function remove() {
    if (!initial.id || !initial.version || mutationInFlight.current) return
    mutationInFlight.current = true
    setSaving(true); setError(null)
    try {
      const response = await fetch(`/api/vaccines?${new URLSearchParams({ id: initial.id, babyId, baseVersion: initial.version })}`, { method: 'DELETE' })
      if (!response.ok) await responseBody(response)
      onSaved(initial as VaccineBookRecord, true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败，请重试。') }
    finally { mutationInFlight.current = false; setSaving(false) }
  }

  return <dialog ref={dialog} aria-labelledby="vaccine-editor-title" onCancel={event => { if (saving) event.preventDefault() }} onClose={onClose} className="m-auto max-h-[92dvh] w-[min(44rem,calc(100vw-1rem))] rounded-3xl border border-primary-soft bg-bg p-0 text-text-primary shadow-2xl backdrop:bg-black/45">
    <form onSubmit={save} className="flex max-h-[92dvh] flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-primary-soft bg-white px-5 py-4">
        <div><h2 id="vaccine-editor-title" className="text-lg font-bold">{editing ? '更正接种记录' : completed ? '补录已接种' : '添加预约'}</h2><p className="mt-1 text-xs text-text-secondary">照本填写，未知信息可以留空。</p></div>
        <button type="button" aria-label="关闭接种记录表单" disabled={saving} onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-primary-light"><X size={21} /></button>
      </div>
      <fieldset disabled={saving} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5">
        <div className="grid grid-cols-2 gap-2" aria-label="接种状态">
          <button type="button" aria-pressed={completed} onClick={() => setCompleted(true)} className={`${actionClass} ${completed ? 'bg-emerald-100 text-emerald-950' : 'border border-primary-soft bg-white text-text-secondary'}`}>已接种</button>
          <button type="button" aria-pressed={!completed} onClick={() => setCompleted(false)} className={`${actionClass} ${!completed ? 'bg-sky-100 text-sky-950' : 'border border-primary-soft bg-white text-text-secondary'}`}>预约</button>
        </div>
        <CuteInput autoFocus label="疫苗名称（按本上原文）" value={name} onChange={event => { setName(event.target.value); if (event.target.value.trim() !== name.trim()) setVaccineId('') }} maxLength={200} required placeholder="例如：五联、13价肺炎疫苗" />
        <div className="grid gap-4 sm:grid-cols-2">
          <CuteInput label="剂次（选填）" value={dose} onChange={event => setDose(event.target.value)} maxLength={100} placeholder="例如：第2剂；不清楚可留空" />
          {completed
            ? <CuteInput label="实际接种日期" type="date" value={actualDate} onChange={event => setActualDate(event.target.value)} max={getLocalDateStr()} required />
            : <CuteInput label="预约日期" type="date" value={plannedDate} onChange={event => setPlannedDate(event.target.value)} required />}
        </div>
        <div className="rounded-2xl border border-primary-soft bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold">本上详细信息 <span className="font-normal text-text-secondary">· 均为选填</span></h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <CuteInput label="生产企业" value={manufacturer} onChange={event => setManufacturer(event.target.value)} maxLength={200} />
            <CuteInput label="产品 / 品牌" value={productName} onChange={event => setProductName(event.target.value)} maxLength={200} />
            <CuteInput label="批号" value={batchNumber} onChange={event => setBatchNumber(event.target.value)} maxLength={100} autoCapitalize="off" autoCorrect="off" />
            <CuteInput label="电子追溯码" value={traceabilityCode} onChange={event => setTraceabilityCode(event.target.value)} maxLength={200} autoCapitalize="off" autoCorrect="off" />
            <CuteInput label="接种单位" value={clinic} onChange={event => setClinic(event.target.value)} maxLength={200} />
            <CuteInput label="接种部位" value={injectionSite} onChange={event => setInjectionSite(event.target.value)} maxLength={100} placeholder="例如：左大腿" />
          </div>
        </div>
        <details className="rounded-2xl border border-primary-soft bg-white p-4" open={Boolean(initial.scheduledDate && completed)}>
          <summary className="cursor-pointer text-sm font-medium">原预约日期与目录关联（选填）</summary>
          <div className="mt-4 space-y-4">
            {completed && <CuteInput label="原预约日期（选填）" type="date" value={plannedDate} onChange={event => setPlannedDate(event.target.value)} />}
            <label className="block text-sm text-text-secondary">对应参考目录（选填）
              <select value={vaccineId} onChange={event => { setVaccineId(event.target.value); if (!name.trim()) setName(vaccines.find(item => item.vaccineId === event.target.value)?.name || '') }} className="mt-2 min-h-11 w-full rounded-2xl border border-primary-soft bg-white p-3 text-text-primary">
                <option value="">暂不关联，保留本上名称</option>
                {vaccineId && !vaccines.some(item => item.vaccineId === vaccineId) && <option value={vaccineId}>保留原目录关联</option>}
                {vaccines.map(item => <option value={item.vaccineId} key={item.vaccineId}>{item.name}</option>)}
              </select>
            </label>
            <p className="text-xs leading-relaxed text-text-secondary">确定对应项目时再关联。联合疫苗只录一条实际接种记录，不需要拆成多针。</p>
          </div>
        </details>
        <label className="block text-sm font-medium text-text-secondary">备注 / 待核对内容
          <textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} rows={3} className="mt-2 w-full resize-y rounded-2xl border border-primary-soft bg-white p-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="可保留手写原文、看不清的内容或门诊说明" />
        </label>
        {editing && <div className="border-t border-primary-soft pt-3">
          {confirmDelete ? <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"><p>删除“{initial.name}”这条记录？本次填写的更改也会放弃。</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={remove} className={`${actionClass} bg-red-700 text-white`}>确认删除</button><button type="button" onClick={() => setConfirmDelete(false)} className={`${actionClass} border border-red-200 bg-white`}>保留记录</button></div></div>
            : <button type="button" onClick={() => setConfirmDelete(true)} className={`${actionClass} text-red-700`}><Trash2 size={16} />删除这条记录</button>}
        </div>}
      </fieldset>
      <div className="shrink-0 space-y-3 border-t border-primary-soft bg-white px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="flex gap-2"><button type="button" disabled={saving} onClick={onClose} className={`${actionClass} border border-primary-soft text-text-secondary`}>取消</button><button type="submit" disabled={saving || confirmDelete} className={`${actionClass} flex-1 bg-primary text-white hover:bg-primary-dark`}>{saving && <Loader2 size={17} className="animate-spin" />}{saving ? '正在保存…' : completed ? '保存接种记录' : '保存预约'}</button></div>
      </div>
    </form>
  </dialog>
}
