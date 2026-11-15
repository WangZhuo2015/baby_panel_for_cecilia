"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { getLocalDateStr } from "@/lib/date";
import {
  matchVaccineProduct,
  parseVaccineRecordInput,
  type VaccineCatalogIdentity,
  type VaccineLedgerRecord,
  type VaccineRecordInput,
  type VaccineRecordStatus,
} from "@/lib/vaccine-records";

export interface VaccineProductOption extends VaccineCatalogIdentity {
  vaccineId: string;
  productManufacturer?: string | null;
}

interface Props {
  record?: VaccineLedgerRecord;
  initialStatus: VaccineRecordStatus;
  initialName?: string;
  initialProductId?: string | null;
  initialDoseNumber?: number;
  birthDate?: string;
  products: VaccineProductOption[];
  records: VaccineLedgerRecord[];
  onSave: (input: VaccineRecordInput, keepOpen: boolean) => Promise<void>;
  onClose: () => void;
}

const inputClass = "w-full min-w-0 min-h-11 rounded-2xl border border-primary-soft bg-card px-3 py-2.5 text-base text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40";
const labels: Record<VaccineRecordStatus, string> = { completed: "已接种", planned: "预约", needs_review: "待核对" };

export function VaccineRecordForm({ record, initialStatus, initialName, initialProductId, initialDoseNumber, birthDate, products, records, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const prefix = useId();
  const [status, setStatus] = useState<VaccineRecordStatus>(record?.recordStatus ?? initialStatus);
  const [name, setName] = useState(record?.name ?? initialName ?? "");
  const [productId, setProductId] = useState(record?.vaccineId ?? initialProductId ?? "");
  const [dose, setDose] = useState(record?.doseNumber?.toString() ?? initialDoseNumber?.toString() ?? "");
  const [writtenDose, setWrittenDose] = useState(record?.dose ?? "");
  const [actualDate, setActualDate] = useState(record?.completedDate ?? record?.administeredDate ?? "");
  const [scheduledDate, setScheduledDate] = useState(record?.scheduledDate ?? "");
  const [metadata, setMetadata] = useState({
    manufacturer: record?.manufacturer ?? "", clinic: record?.clinic ?? "",
    batchNumber: record?.batchNumber ?? "", traceCode: record?.traceCode ?? "",
    administrationRoute: record?.administrationRoute ?? "", injectionSite: record?.injectionSite ?? "",
    sourceText: record?.sourceText ?? "", notes: record?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const keepOpen = useRef(false);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const duplicate = useMemo(() => status === "completed" && records.some(item => {
    if (item.id === record?.id || item.recordStatus !== "completed") return false;
    const sameProduct = productId && item.vaccineId ? item.vaccineId === productId : item.name.trim() === name.trim();
    return sameProduct && (dose ? item.doseNumber === Number(dose) : (actualDate && item.completedDate === actualDate));
  }), [records, record?.id, status, productId, name, dose, actualDate]);

  useEffect(() => setDuplicateConfirmed(false), [productId, name, dose, actualDate, status]);

  const editName = (value: string) => {
    setName(value);
    const match = matchVaccineProduct(value, products);
    setProductId(match?.vaccineId ?? "");
  };

  const changeStatus = (next: VaccineRecordStatus) => {
    setStatus(next);
    // A planned visit is never evidence that a vaccination happened.
    if (next === "planned") setActualDate("");
    setError(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setError(null);
    try {
      const input = parseVaccineRecordInput({
        name, vaccineId: productId || null, doseNumber: dose ? Number(dose) : null,
        dose: writtenDose || null, recordStatus: status,
        administeredDate: status === "planned" ? null : actualDate || null,
        scheduledDate: scheduledDate || null, ...metadata,
      });
      if (status === "completed" && birthDate && actualDate < birthDate) {
        throw new Error("实际接种日期早于宝宝生日，请核对日期或保存为待核对。");
      }
      if (duplicate && !duplicateConfirmed) throw new Error("已有相同产品和剂次的记录，请先核对下方重复提示。");
      setSaving(true);
      await onSave(input, keepOpen.current && !record);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，输入内容已保留，请重试。");
    } finally {
      setSaving(false);
      keepOpen.current = false;
    }
  };

  const title = record ? "编辑接种记录" : status === "completed" ? "补录已接种" : status === "planned" ? "记录预约" : "保存待核对内容";
  const field = (key: "manufacturer" | "clinic" | "batchNumber" | "traceCode" | "injectionSite", label: string, maxLength: number) => (
    <label className="block space-y-1.5 text-sm text-text-secondary" htmlFor={`${prefix}-${key}`}>
      <span>{label}</span>
      <input id={`${prefix}-${key}`} className={inputClass} value={metadata[key]} maxLength={maxLength}
        onChange={event => setMetadata(previous => ({ ...previous, [key]: event.target.value }))} />
    </label>
  );

  return (
    <dialog ref={dialog} aria-labelledby={`${prefix}-title`} aria-describedby={`${prefix}-help`}
      onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}
      className="m-auto max-h-[92dvh] w-[calc(100%_-_1.5rem)] max-w-2xl overflow-y-auto rounded-3xl bg-bg p-0 text-text-primary shadow-xl backdrop:bg-black/40">
      <form ref={form} onSubmit={submit} className="flex flex-col" aria-busy={saving}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-primary-soft bg-bg px-5 py-4">
          <h2 id={`${prefix}-title`} className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label="关闭录入表单" className="flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-primary-light disabled:opacity-50"><X size={20} /></button>
        </div>
        <fieldset disabled={saving} className="min-w-0 space-y-5 px-5 py-5 disabled:opacity-70">
          <p id={`${prefix}-help`} className="text-sm leading-relaxed text-text-secondary">照着疫苗本补录。日期与剂次不清楚时可以先保存为待核对。</p>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">这是什么记录？</legend>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(labels) as VaccineRecordStatus[]).map(value => (
                <label key={value} className={`flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-2xl border px-2 text-sm ${status === value ? "border-primary bg-primary-light text-primary font-bold" : "border-primary-soft bg-card text-text-secondary"}`}>
                  <input type="radio" name={`${prefix}-status`} value={value} checked={status === value} onChange={() => changeStatus(value)} className="accent-pink-600" />
                  {labels[value]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-1.5 text-sm text-text-secondary" htmlFor={`${prefix}-name`}>
            <span>疫苗本名称 <span className="text-rose-600">*</span></span>
            <input id={`${prefix}-name`} autoFocus autoComplete="off" className={inputClass} value={name} required maxLength={200}
              placeholder="例如：五联、13价肺炎、五价轮状" list={`${prefix}-products`} onChange={event => editName(event.target.value)} />
            <datalist id={`${prefix}-products`}>{products.map(product => <option key={product.vaccineId} value={product.name}>{product.shortName}</option>)}</datalist>
          </label>
          <label className="block space-y-1.5 text-sm text-text-secondary" htmlFor={`${prefix}-product`}>
            <span>对应的具体产品（可选）</span>
            <select id={`${prefix}-product`} className={inputClass} value={productId} onChange={event => {
              setProductId(event.target.value);
              if (!name.trim()) setName(products.find(product => product.vaccineId === event.target.value)?.name ?? "");
            }}>
              <option value="">产品暂不确定，保留疫苗本原名</option>
              {productId && !products.some(product => product.vaccineId === productId) && <option value={productId}>已有产品：{productId}</option>}
              {products.map(product => <option key={product.vaccineId} value={product.vaccineId}>{product.name}</option>)}
            </select>
            <span className="block text-xs leading-relaxed">五联只记一次。13价肺炎、轮状和流脑请核对具体制剂；未确定产品也能保存。</span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm text-text-secondary" htmlFor={`${prefix}-dose`}>
              <span>第几剂</span>
              <select id={`${prefix}-dose`} className={inputClass} value={dose} onChange={event => {
                setDose(event.target.value);
                setWrittenDose(event.target.value ? `第${event.target.value}剂` : "");
              }}>
                <option value="">不确定，留待核对</option>
                {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>第{index + 1}剂</option>)}
              </select>
            </label>
            {status === "planned" ? (
              <label className="block space-y-1.5 text-sm text-text-secondary" htmlFor={`${prefix}-scheduled`}>
                <span>预约日期 <span className="text-rose-600">*</span></span>
                <input id={`${prefix}-scheduled`} type="date" required className={inputClass} value={scheduledDate} onChange={event => setScheduledDate(event.target.value)} />
              </label>
            ) : (
              <label className="block space-y-1.5 text-sm text-text-secondary" htmlFor={`${prefix}-actual`}>
                <span>{status === "needs_review" ? "本子上的日期（待核对，可留空）" : "实际接种日期"} {status === "completed" && <span className="text-rose-600">*</span>}</span>
                <input id={`${prefix}-actual`} type="date" required={status === "completed"} max={status === "completed" ? getLocalDateStr() : undefined}
                  min={status === "completed" ? birthDate : undefined} className={inputClass} value={actualDate} onChange={event => setActualDate(event.target.value)} />
              </label>
            )}
          </div>
          {status === "needs_review" && <p className="rounded-2xl bg-amber-50 px-3 py-3 text-sm text-amber-900">这条内容不会计为已接种，也不会生成预约提醒。残缺日期、有效期或手写备忘可放在下方原文中。</p>}
          {duplicate && <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="flex items-start gap-2"><AlertTriangle size={18} className="shrink-0" />已有相同产品、剂次或日期的记录。修正原记录时，请返回列表点“编辑”。</p>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={duplicateConfirmed} onChange={event => setDuplicateConfirmed(event.target.checked)} />我已核对，仍需新增这条记录</label>
          </div>}
          <details open={Boolean(record && Object.values(metadata).some(Boolean))} className="rounded-2xl border border-primary-soft bg-card p-4">
            <summary className="min-h-7 cursor-pointer text-sm font-semibold">接种单位、厂家与追溯信息（可选）</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {field("clinic", "接种单位", 200)}
              {field("manufacturer", "生产企业", 200)}
              {field("batchNumber", "批号", 100)}
              {field("traceCode", "电子追溯码", 200)}
              <label className="block space-y-1.5 text-sm text-text-secondary" htmlFor={`${prefix}-route`}>
                <span>接种途径</span>
                <input id={`${prefix}-route`} className={inputClass} value={metadata.administrationRoute} maxLength={50} list={`${prefix}-routes`}
                  onChange={event => setMetadata(previous => ({ ...previous, administrationRoute: event.target.value }))} />
                <datalist id={`${prefix}-routes`}><option value="口服" /><option value="肌内注射" /><option value="皮下注射" /><option value="皮内注射" /></datalist>
              </label>
              {field("injectionSite", "接种部位", 100)}
              <label className="block space-y-1.5 text-sm text-text-secondary" htmlFor={`${prefix}-written-dose`}>
                <span>疫苗本剂次原文</span>
                <input id={`${prefix}-written-dose`} className={inputClass} value={writtenDose} maxLength={50} onChange={event => setWrittenDose(event.target.value)} />
              </label>
              {status !== "planned" && <label className="block space-y-1.5 text-sm text-text-secondary" htmlFor={`${prefix}-original-appointment`}>
                <span>原预约日期（有记载时填写）</span>
                <input id={`${prefix}-original-appointment`} type="date" className={inputClass} value={scheduledDate} onChange={event => setScheduledDate(event.target.value)} />
              </label>}
            </div>
          </details>
          <label className="block space-y-1.5 text-sm text-text-secondary" htmlFor={`${prefix}-source`}>
            <span>疫苗本原文 / 待核对内容</span>
            <textarea id={`${prefix}-source`} rows={2} maxLength={4000} className={inputClass} value={metadata.sourceText}
              placeholder="保留手写内容或说明哪处日期、剂次看不清" onChange={event => setMetadata(previous => ({ ...previous, sourceText: event.target.value }))} />
          </label>
          <label className="block space-y-1.5 text-sm text-text-secondary" htmlFor={`${prefix}-notes`}>
            <span>备注</span>
            <textarea id={`${prefix}-notes`} rows={2} maxLength={4000} className={inputClass} value={metadata.notes}
              onChange={event => setMetadata(previous => ({ ...previous, notes: event.target.value }))} />
          </label>
        </fieldset>
        {error && <p role="alert" className="mx-5 mb-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-primary-soft bg-bg px-5 py-4">
          {!record && <button type="submit" disabled={saving} onClick={() => { keepOpen.current = true; }} className="min-h-11 rounded-full border border-primary px-4 text-sm font-semibold text-primary disabled:opacity-50">保存并继续补录</button>}
          <button type="submit" disabled={saving} onClick={() => { keepOpen.current = false; }} className="flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50"><Check size={16} />{saving ? "保存中…" : "保存记录"}</button>
        </div>
      </form>
    </dialog>
  );
}
