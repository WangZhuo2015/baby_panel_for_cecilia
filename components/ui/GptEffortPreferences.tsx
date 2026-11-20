"use client";

import { useEffect, useRef, useState } from "react";
import {
  normalizeLlmPreferenceSnapshot,
  type LlmPreferenceSelection,
  type LlmPreferenceSnapshot,
} from "@/lib/llm-preference-client-cache";
import {
  defaultLlmFeatureProfileId,
  matchesLlmSelection,
  OPENAI_OFFICIAL_PROFILE_ID,
  usesVisionModel,
} from "@/lib/llm-feature-model";

const FEATURES = [
  ["chat", "AI 聊天"], ["daily_summary", "每日日报"], ["tips", "育儿建议"],
  ["record_parse", "记录解析"], ["nutrition_parse", "营养解析"],
  ["growth_ocr", "成长记录识别"], ["medical_ocr", "医疗报告识别"], ["voice", "语音助手"],
] as const;
type Feature = (typeof FEATURES)[number][0];
type Effort = NonNullable<LlmPreferenceSelection["reasoningEffort"]>;
export type EffortModelChoices = Partial<Record<Feature, LlmPreferenceSelection>>;

async function readSnapshot(signal: AbortSignal): Promise<LlmPreferenceSnapshot> {
  const response = await fetch("/api/ai/preferences", { credentials: "same-origin", cache: "no-store", signal });
  if (!response.ok) throw new Error();
  const result = await response.json();
  const snapshot = normalizeLlmPreferenceSnapshot(result.data);
  if (!snapshot) throw new Error();
  return snapshot;
}

function savedSelection(snapshot: LlmPreferenceSnapshot, feature: Feature): LlmPreferenceSelection {
  const saved = snapshot.preferences.find(item => item.feature === feature);
  if (saved) return saved;
  const profileId = defaultLlmFeatureProfileId(feature);
  const profile = snapshot.profiles.find(item => item.id === profileId);
  const modelId = (usesVisionModel(feature) ? profile?.visionModel : profile?.textModel) || "";
  return { feature, source: "api", profileId, modelId };
}

function unavailableReason(snapshot: LlmPreferenceSnapshot, selected: LlmPreferenceSelection, saved: LlmPreferenceSelection): string {
  if (selected.source === "chatgpt") return "ChatGPT 套餐的推理设置由所选模型决定。";
  if (selected.profileId !== OPENAI_OFFICIAL_PROFILE_ID) return "此 API 配置不支持这里的推理强度设置。";
  const profile = snapshot.profiles.find(item => item.id === selected.profileId);
  const models = selected.feature === "chat" ? [profile?.textModel, profile?.visionModel]
    : [usesVisionModel(selected.feature) ? profile?.visionModel : profile?.textModel];
  if (!profile?.available || !selected.modelId || !models.includes(selected.modelId)) return "所选官方 API 模型不可用。";
  if (!matchesLlmSelection(selected, saved)) return "请先保存当前模型。";
  return "";
}

export function GptEffortPreferences({ userId, disabled, snapshot, loading, loadError, choices, onConfirmed }: {
  userId: string | null; disabled?: boolean; snapshot: LlmPreferenceSnapshot | null; loading: boolean; loadError: string;
  choices?: EffortModelChoices;
  onConfirmed: (snapshot: LlmPreferenceSnapshot, feature: Feature) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const choicesRef = useRef(choices);
  choicesRef.current = choices;

  useEffect(() => () => requestRef.current?.abort(), [userId]);

  async function save(feature: Feature, expected: LlmPreferenceSelection, value: Effort | null) {
    if (requestRef.current) return;
    const request = new AbortController();
    requestRef.current = request;
    const { signal } = request;
    setSaving(true);
    setMessage("");
    try {
      const current = await readSnapshot(signal);
      const active = savedSelection(current, feature);
      if (signal.aborted) return;
      const choice = choicesRef.current?.[feature] || active;
      if (!matchesLlmSelection(active, expected) || unavailableReason(current, choice, active)) {
        onConfirmed(current, feature);
        setMessage("模型配置已变更，请确认当前模型后重试。");
        return;
      }
      const response = await fetch("/api/ai/preferences", {
        method: "PUT", credentials: "same-origin", cache: "no-store", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...active, reasoningEffort: value }),
      });
      if (!response.ok && response.status !== 409) throw new Error();
      const refreshed = await readSnapshot(signal);
      if (signal.aborted) return;
      const saved = savedSelection(refreshed, feature);
      onConfirmed(refreshed, feature);
      if (response.status === 409 || !matchesLlmSelection(saved, expected) ||
          !matchesLlmSelection(choicesRef.current?.[feature] || saved, expected)) {
        setMessage("模型配置已变更，请确认当前模型后重试。");
      } else if ((saved.reasoningEffort ?? null) === value) {
        setMessage("推理强度已保存。");
      } else {
        setMessage("推理强度未能保存，请重试。");
      }
    } catch {
      if (!signal.aborted) setMessage("保存失败，请重试。");
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        setSaving(false);
      }
    }
  }

  return <section className="rounded-xl border border-primary/15 p-3 text-xs" aria-label="GPT API 推理强度">
    <h3 className="text-sm font-semibold">GPT API 推理强度</h3>
    <p className="my-2 text-text-muted">每项单独保存。所选 OpenAI 官方 API 模型可调整推理强度，较高的强度通常耗时更久。</p>
    <div className="grid gap-2 sm:grid-cols-2">
      {FEATURES.map(([feature, label]) => {
        const saved = snapshot && savedSelection(snapshot, feature);
        const choice = choices?.[feature] || saved;
        const reason = snapshot && choice && saved ? unavailableReason(snapshot, choice, saved) : "";
        return <label key={feature} className="flex items-center justify-between gap-2">
          <span>
            <span className="block font-medium">{label}</span>
            {choice && <span className="block break-all text-text-muted">{choice.source === "chatgpt" ? "ChatGPT 套餐" : "API"} · {choice.modelId || "未选择模型"}</span>}
            {reason && <span className="block text-text-muted">{reason}</span>}
          </span>
          <select
            aria-label={`${label}推理强度`}
            className="rounded border bg-card p-1"
            value={!reason && saved ? saved.reasoningEffort || "" : ""}
            disabled={disabled || !userId || !snapshot || !choice || loading || saving || Boolean(loadError || reason)}
            onChange={event => { if (choice) void save(feature, choice, (event.target.value || null) as Effort | null); }}
          >
            <option value="">默认{feature === "chat" ? "（极高）" : feature === "voice" ? "（低）" : "（模型默认）"}</option>
            <option value="low">低 · 更快</option>
            <option value="medium">中</option>
            <option value="high">高</option>
            <option value="xhigh">极高</option>
            {(feature === "chat" || feature === "voice") && <option value="max">最高</option>}
          </select>
        </label>;
      })}
    </div>
    {loading && <p role="status" className="mt-2">正在读取设置…</p>}
    {loadError && <p role="alert" className="mt-2">推理强度读取失败，请刷新后重试。</p>}
    {message && <p role="status" className="mt-2">{message}</p>}
  </section>;
}
