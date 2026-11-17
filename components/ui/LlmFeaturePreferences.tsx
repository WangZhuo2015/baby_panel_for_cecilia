"use client";

import { useEffect, useRef, useState } from "react";
import {
  cacheLlmPreferenceSelection,
  normalizeLlmPreferenceSnapshot,
  type ChatGPTModelMetadata,
  type ChatGPTProfileMetadata,
  type LlmPreferenceFeature,
  type LlmPreferenceSelection,
  type LlmPreferenceSnapshot,
  type LlmProfileMetadata,
} from "@/lib/llm-preference-client-cache";

type Feature = Exclude<LlmPreferenceFeature, "chat" | "search">;
type Selection = LlmPreferenceSelection & { feature: Feature };
type RevisionMap = Partial<Record<Feature, number>>;
type SelectionMap = Partial<Record<Feature, Selection>>;
type SourceMap = Partial<Record<Feature, "api" | "chatgpt">>;
type ProfileMap = Partial<Record<Feature, string>>;
type SaveQueue = { running: boolean; pending?: Selection };
type ModelCatalogState = {
  ownerId: string;
  profileId: string;
  models: ChatGPTModelMetadata[];
  loading: boolean;
  error: string;
};

const FEATURE_ROWS: { id: Feature; label: string; vision: boolean }[] = [
  { id: "daily_summary", label: "每日日报", vision: false },
  { id: "tips", label: "育儿建议", vision: false },
  { id: "record_parse", label: "记录解析", vision: false },
  { id: "nutrition_parse", label: "营养识别", vision: true },
  { id: "growth_ocr", label: "生长记录 OCR", vision: true },
  { id: "medical_ocr", label: "医疗单据 OCR", vision: true },
  { id: "voice", label: "语音记录整理", vision: false },
];

function modelFor(profile: LlmProfileMetadata | undefined, vision: boolean): string {
  return vision ? profile?.visionModel || "" : profile?.textModel || "";
}

function featureSelectionMap(snapshot: LlmPreferenceSnapshot): SelectionMap {
  const selections: SelectionMap = {};
  for (const item of snapshot.preferences) {
    if (item.feature === "chat" || item.feature === "search") continue;
    selections[item.feature] = item as Selection;
  }
  return selections;
}

function defaultProfileId(feature: Feature): string {
  return feature === "daily_summary" ? "amd-v4.1-flash" : "openai-official";
}

function initialDrafts(snapshot: LlmPreferenceSnapshot): SelectionMap {
  const persisted = featureSelectionMap(snapshot);
  const fallbackProfileId = snapshot.activeProfileId || snapshot.defaultModelInfo?.profileId || "";
  const fallbackProfile = snapshot.profiles.find(item => item.id === fallbackProfileId && item.available)
    || snapshot.profiles.find(item => item.available);
  const defaults: SelectionMap = {};
  for (const row of FEATURE_ROWS) {
    if (persisted[row.id]) {
      defaults[row.id] = persisted[row.id];
      continue;
    }
    const preferredProfileId = defaultProfileId(row.id);
    const profile = snapshot.profiles.find(item => item.id === preferredProfileId)
      || snapshot.profiles.find(item => item.id === fallbackProfileId)
      || fallbackProfile;
    const modelId = modelFor(profile, row.vision);
    if (profile && modelId) defaults[row.id] = { feature: row.id, source: "api", profileId: profile.id, modelId };
  }
  return defaults;
}

function sameSelection(left: Selection | undefined, right: Selection | undefined): boolean {
  return Boolean(left && right && left.feature === right.feature && left.source === right.source
    && left.profileId === right.profileId && left.modelId === right.modelId);
}

function parseSelection(value: unknown, feature: Feature): Selection {
  const snapshot = normalizeLlmPreferenceSnapshot({ preferences: [value], profiles: [], activeProfileId: "" });
  const selection = snapshot?.preferences[0];
  if (!selection || selection.feature !== feature) throw new Error("保存响应格式无效");
  return selection as Selection;
}

function isUsableChatGPTProfile(profile: ChatGPTProfileMetadata | undefined): boolean {
  return Boolean(profile?.connected && profile.sharing && !profile.reauthorize);
}

function modelsForFeature(models: ChatGPTModelMetadata[] | undefined, vision: boolean): ChatGPTModelMetadata[] {
  return (models || []).filter(model => vision ? model.input.includes("image") : model.input.includes("text"));
}

type LlmFeaturePreferencesProps = {
  disabled: boolean;
  userId: string | null;
  snapshot: LlmPreferenceSnapshot | null;
  preferenceLoading: boolean;
  preferenceError: string;
  chatGPTProfiles: ChatGPTProfileMetadata[];
  chatGPTStatusLoaded: boolean;
  chatGPTStatusError: string;
  chatGPTModelCatalogs: Record<string, ModelCatalogState>;
  onLoadChatGPTModels: (profileId: string) => Promise<ChatGPTModelMetadata[]>;
};

export function LlmFeaturePreferences({
  disabled,
  userId,
  snapshot,
  preferenceLoading,
  preferenceError,
  chatGPTProfiles,
  chatGPTStatusLoaded,
  chatGPTStatusError,
  chatGPTModelCatalogs,
  onLoadChatGPTModels,
}: LlmFeaturePreferencesProps) {
  const [saved, setSaved] = useState<SelectionMap>({});
  const [drafts, setDrafts] = useState<SelectionMap>({});
  const [sources, setSources] = useState<SourceMap>({});
  const [profileIds, setProfileIds] = useState<ProfileMap>({});
  const [saving, setSaving] = useState<Partial<Record<Feature, boolean>>>({});
  const [messages, setMessages] = useState<Partial<Record<Feature, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<Feature, string>>>({});
  const savedRef = useRef<SelectionMap>({});
  const draftsRef = useRef<SelectionMap>({});
  const sourcesRef = useRef<SourceMap>({});
  const profileIdsRef = useRef<ProfileMap>({});
  const draftRevisionRef = useRef<RevisionMap>({});
  const saveRevisionRef = useRef<RevisionMap>({});
  const queuesRef = useRef(new Map<Feature, SaveQueue>());
  const ownerRef = useRef(userId);
  ownerRef.current = userId;
  const loadModelsRef = useRef(onLoadChatGPTModels);
  loadModelsRef.current = onLoadChatGPTModels;
  const requestedProfilesRef = useRef(new Set<string>());
  const controllerRef = useRef<AbortController | null>(null);
  const appliedSnapshotRef = useRef<{
    ownerId: string | null;
    draftRevisions: RevisionMap;
    saveRevisions: RevisionMap;
  }>({ ownerId: userId, draftRevisions: {}, saveRevisions: {} });

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    ownerRef.current = userId;
    if (!userId) {
      setSaved({}); setDrafts({}); setSources({}); setProfileIds({});
      savedRef.current = {}; draftsRef.current = {}; sourcesRef.current = {}; profileIdsRef.current = {};
      setErrors({}); setMessages({});
    }
    return () => controller.abort();
  }, [userId]);

  useEffect(() => {
    if (!snapshot || !userId || ownerRef.current !== userId) return;
    const applied = appliedSnapshotRef.current.ownerId === userId
      ? appliedSnapshotRef.current
      : { ownerId: userId, draftRevisions: {}, saveRevisions: {} };
    const incomingSaved = featureSelectionMap(snapshot);
    const defaults = initialDrafts(snapshot);
    const nextSaved = { ...savedRef.current };
    const nextDrafts = { ...draftsRef.current };
    const nextSources = { ...sourcesRef.current };
    const nextProfileIds = { ...profileIdsRef.current };

    for (const row of FEATURE_ROWS) {
      const savedUnchanged = (saveRevisionRef.current[row.id] || 0) === (applied.saveRevisions[row.id] || 0);
      const draftUnchanged = (draftRevisionRef.current[row.id] || 0) === (applied.draftRevisions[row.id] || 0);
      if (savedUnchanged) {
        if (incomingSaved[row.id]) nextSaved[row.id] = incomingSaved[row.id];
        else delete nextSaved[row.id];
      }
      if (draftUnchanged) {
        const initial = defaults[row.id];
        if (initial) {
          nextDrafts[row.id] = initial;
          nextSources[row.id] = initial.source;
          nextProfileIds[row.id] = initial.profileId;
        } else {
          delete nextDrafts[row.id];
          nextSources[row.id] = "api";
          const profile = snapshot.profiles.find(item => item.id === snapshot.activeProfileId && item.available)
            || snapshot.profiles.find(item => item.available);
          if (profile) nextProfileIds[row.id] = profile.id;
          else delete nextProfileIds[row.id];
        }
      }
    }

    savedRef.current = nextSaved; draftsRef.current = nextDrafts;
    sourcesRef.current = nextSources; profileIdsRef.current = nextProfileIds;
    setSaved(nextSaved); setDrafts(nextDrafts); setSources(nextSources); setProfileIds(nextProfileIds);
    appliedSnapshotRef.current = {
      ownerId: userId,
      draftRevisions: { ...draftRevisionRef.current },
      saveRevisions: { ...saveRevisionRef.current },
    };
  }, [userId, snapshot]);

  function updateChoice(feature: Feature, source: "api" | "chatgpt", profileId: string, selection?: Selection): void {
    const nextDrafts = { ...draftsRef.current };
    if (selection) nextDrafts[feature] = selection;
    else delete nextDrafts[feature];
    const nextSources = { ...sourcesRef.current, [feature]: source };
    const nextProfileIds = { ...profileIdsRef.current, [feature]: profileId };
    draftsRef.current = nextDrafts; sourcesRef.current = nextSources; profileIdsRef.current = nextProfileIds;
    draftRevisionRef.current[feature] = (draftRevisionRef.current[feature] || 0) + 1;
    setDrafts(nextDrafts); setSources(nextSources); setProfileIds(nextProfileIds);
    setErrors(current => ({ ...current, [feature]: "" }));
    const queue = queuesRef.current.get(feature);
    if (queue?.running) {
      queue.pending = selection;
      setMessages(current => ({ ...current, [feature]: selection ? "最新选择将继续保存…" : "请选择可用模型后保存" }));
    } else {
      setMessages(current => ({ ...current, [feature]: selection && !sameSelection(savedRef.current[feature], selection) ? "未保存" : "" }));
    }
  }

  function changeSource(feature: Feature, source: "api" | "chatgpt"): void {
    const row = FEATURE_ROWS.find(item => item.id === feature)!;
    const persisted = savedRef.current[feature];
    if (source === "api") {
      const fallbackId = defaultProfileId(feature);
      const profileId = persisted?.source === "api" ? persisted.profileId
        : snapshot?.profiles.find(item => item.id === fallbackId)?.id
          || snapshot?.profiles.find(item => item.id === snapshot?.activeProfileId && item.available)?.id
          || snapshot?.profiles.find(item => item.available)?.id || "";
      const profile = snapshot?.profiles.find(item => item.id === profileId);
      const modelId = persisted?.source === "api" && persisted.profileId === profileId
        ? persisted.modelId : modelFor(profile, row.vision);
      updateChoice(feature, "api", profileId, profile?.available && modelId
        ? { feature, source: "api", profileId, modelId } : undefined);
      return;
    }

    const currentProfileId = sourcesRef.current[feature] === "chatgpt" ? profileIdsRef.current[feature] || "" : "";
    const savedChatProfileId = persisted?.source === "chatgpt" ? persisted.profileId : "";
    const firstUsable = chatGPTProfiles.find(isUsableChatGPTProfile);
    const profileId = [savedChatProfileId, currentProfileId, firstUsable?.id || ""]
      .find(id => id && chatGPTProfiles.some(profile => profile.id === id && isUsableChatGPTProfile(profile)))
      || (savedChatProfileId && !chatGPTStatusLoaded ? savedChatProfileId : "");
    const catalog = profileId ? chatGPTModelCatalogs[profileId] : undefined;
    const models = modelsForFeature(catalog?.ownerId === userId && catalog.profileId === profileId ? catalog.models : [], row.vision);
    const savedModel = persisted?.source === "chatgpt" && persisted.profileId === profileId
      ? models.find(model => model.id === persisted.modelId) : undefined;
    const modelId = savedModel?.id || models[0]?.id || "";
    updateChoice(feature, "chatgpt", profileId, modelId ? { feature, source: "chatgpt", profileId, modelId } : undefined);
  }

  function changeProfile(feature: Feature, profileId: string): void {
    const row = FEATURE_ROWS.find(item => item.id === feature)!;
    const profile = snapshot?.profiles.find(item => item.id === profileId);
    const modelId = modelFor(profile, row.vision);
    updateChoice(feature, "api", profileId, profile?.available && modelId
      ? { feature, source: "api", profileId, modelId } : undefined);
  }

  function changeChatGPTProfile(feature: Feature, profileId: string): void {
    const row = FEATURE_ROWS.find(item => item.id === feature)!;
    const catalog = chatGPTModelCatalogs[profileId];
    const models = modelsForFeature(catalog?.ownerId === userId && catalog.profileId === profileId ? catalog.models : [], row.vision);
    const currentSaved = savedRef.current[feature];
    const savedModel = currentSaved?.source === "chatgpt" && currentSaved.profileId === profileId
      ? models.find(model => model.id === currentSaved.modelId) : undefined;
    const modelId = savedModel?.id || models[0]?.id || "";
    updateChoice(feature, "chatgpt", profileId, modelId ? { feature, source: "chatgpt", profileId, modelId } : undefined);
  }

  function chooseModel(feature: Feature, modelId: string): void {
    const rowSource = sourcesRef.current[feature] || "api";
    const profileId = profileIdsRef.current[feature] || "";
    if (!profileId || !modelId) return;
    updateChoice(feature, rowSource, profileId, { feature, source: rowSource, profileId, modelId });
  }

  useEffect(() => {
    for (const row of FEATURE_ROWS) {
      if ((sources[row.id] || drafts[row.id]?.source) !== "chatgpt") continue;
      const profileId = profileIds[row.id] || drafts[row.id]?.profileId || "";
      if (!profileId) continue;
      const account = chatGPTProfiles.find(profile => profile.id === profileId);
      if (chatGPTStatusLoaded && account && !isUsableChatGPTProfile(account)) continue;
      const requestKey = userId + ":" + profileId;
      if (requestedProfilesRef.current.has(requestKey)) continue;
      requestedProfilesRef.current.add(requestKey);
      void loadModelsRef.current(profileId).catch(() => { requestedProfilesRef.current.delete(requestKey); });
    }
  }, [userId, sources, profileIds, drafts, chatGPTProfiles, chatGPTStatusLoaded]);

  useEffect(() => {
    for (const row of FEATURE_ROWS) {
      if ((sources[row.id] || drafts[row.id]?.source) !== "chatgpt") continue;
      const profileId = profileIds[row.id] || drafts[row.id]?.profileId || "";
      const selection = draftsRef.current[row.id];
      if (!profileId || selection?.modelId) continue;
      const catalog = chatGPTModelCatalogs[profileId];
      if (catalog?.ownerId !== userId || catalog.profileId !== profileId) continue;
      const model = modelsForFeature(catalog.models, row.vision)[0];
      if (model) updateChoice(row.id, "chatgpt", profileId, { feature: row.id, source: "chatgpt", profileId, modelId: model.id });
    }
  }, [userId, sources, profileIds, drafts, chatGPTModelCatalogs]);

  async function save(feature: Feature): Promise<void> {
    const saveOwner = userId;
    const selection = draftsRef.current[feature];
    if (!selection || !saveOwner) return;
    const activeQueue = queuesRef.current.get(feature);
    if (activeQueue?.running) {
      activeQueue.pending = selection;
      setMessages(current => ({ ...current, [feature]: "最新选择将继续保存…" }));
      return;
    }

    const queue: SaveQueue = { running: true };
    queuesRef.current.set(feature, queue);
    setSaving(current => ({ ...current, [feature]: true }));
    setErrors(current => ({ ...current, [feature]: "" }));
    setMessages(current => ({ ...current, [feature]: "正在保存…" }));
    let next: Selection | undefined = selection;
    try {
      while (next && ownerRef.current === saveOwner && !controllerRef.current?.signal.aborted) {
        const requested = next;
        queue.pending = undefined;
        try {
          const response = await fetch("/api/ai/preferences", {
            method: "PUT", credentials: "same-origin", cache: "no-store",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify(requested),
            signal: controllerRef.current?.signal,
          });
          const value = await response.json();
          if (!response.ok) throw new Error(value.error || "保存失败，请重试");
          const savedSelection = parseSelection(value.data, feature);
          if (ownerRef.current !== saveOwner || controllerRef.current?.signal.aborted) break;
          saveRevisionRef.current[feature] = (saveRevisionRef.current[feature] || 0) + 1;
          const savedNext = { ...savedRef.current, [feature]: savedSelection };
          savedRef.current = savedNext; setSaved(savedNext);
          cacheLlmPreferenceSelection(saveOwner, savedSelection);
          const pending = queue.pending;
          if (pending && !sameSelection(pending, savedSelection)) {
            next = pending; queue.pending = undefined;
            setMessages(current => ({ ...current, [feature]: "继续保存最新选择…" }));
          } else {
            next = undefined;
            setMessages(current => ({ ...current, [feature]: "已保存" }));
          }
        } catch (error) {
          if (ownerRef.current !== saveOwner || controllerRef.current?.signal.aborted) break;
          const pending = queue.pending;
          if (pending && !sameSelection(pending, requested)) {
            next = pending; queue.pending = undefined;
            setMessages(current => ({ ...current, [feature]: "继续保存最新选择…" }));
            continue;
          }
          setErrors(current => ({ ...current, [feature]: error instanceof Error ? error.message : "保存失败，请重试" }));
          setMessages(current => ({ ...current, [feature]: "保存失败" }));
          next = undefined;
        }
      }
    } finally {
      queue.running = false;
      queuesRef.current.delete(feature);
      if (ownerRef.current === saveOwner && !controllerRef.current?.signal.aborted) {
        setSaving(current => ({ ...current, [feature]: false }));
      }
    }
  }

  const apiProfiles = snapshot?.profiles || [];
  const availableApiProfiles = apiProfiles.filter(profile => profile.available);
  return <section className="rounded-xl border border-primary/15 p-3 text-xs" aria-label="其他功能的模型配置">
    <div className="mb-2">
      <h3 className="font-semibold text-sm">其他 AI 功能的模型</h3>
      <p className="text-text-muted">每项功能可单独选择 API 配置或 ChatGPT 账号，并保存对应模型。</p>
    </div>
    {preferenceLoading && !snapshot && <p role="status" className="mb-2 text-text-muted">正在读取模型配置…</p>}
    {preferenceError && <p role="alert" className="mb-2 text-red-700">模型偏好读取失败：{preferenceError}</p>}
    <div className="flex flex-col gap-2">
      {FEATURE_ROWS.map(row => {
        const draft = drafts[row.id];
        const source = sources[row.id] || draft?.source || "api";
        const profileId = profileIds[row.id] || draft?.profileId || "";
        const apiProfile = apiProfiles.find(item => item.id === profileId);
        const chatGPTProfile = chatGPTProfiles.find(item => item.id === profileId);
        const catalog = chatGPTModelCatalogs[profileId]?.ownerId === userId
          && chatGPTModelCatalogs[profileId]?.profileId === profileId
          ? chatGPTModelCatalogs[profileId] : undefined;
        const chatModels = modelsForFeature(catalog?.models, row.vision);
        const modelIsSupported = source === "api"
          ? Boolean(apiProfile?.available && modelFor(apiProfile, row.vision) === draft?.modelId)
          : Boolean(isUsableChatGPTProfile(chatGPTProfile) && chatModels.some(model => model.id === draft?.modelId));
        const isSaved = sameSelection(saved[row.id], draft);
        const rowMessage = messages[row.id] || (isSaved ? "已保存" : draft ? "当前选择尚未保存" : "请选择可用模型");
        const chatProfilesForSelect = [...chatGPTProfiles];
        if (source === "chatgpt" && profileId && !chatProfilesForSelect.some(profile => profile.id === profileId)) {
          chatProfilesForSelect.push({ id: profileId, email: "", name: "已保存账号", connected: false, sharing: false, reauthorize: true });
        }

        return <section key={row.id} aria-label={row.label} className="rounded-lg border border-primary/10 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{row.label}{row.vision ? " · 视觉模型" : " · 文本模型"}</strong>
            <span className="text-text-muted">{rowMessage}</span>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex min-w-0 items-center gap-2">模型来源
              <select
                aria-label={row.label + " 模型来源"}
                className="min-w-0 flex-1 rounded border p-1 bg-card"
                disabled={disabled}
                value={source}
                onChange={event => changeSource(row.id, event.target.value as "api" | "chatgpt")}
              >
                <option value="api">API 配置</option>
                <option value="chatgpt">ChatGPT 账号</option>
              </select>
            </label>
            {source === "api" ? <>
              <label className="flex min-w-0 items-center gap-2">API 配置
                <select
                  aria-label={row.label + " API 配置"}
                  className="min-w-0 flex-1 rounded border p-1 bg-card"
                  disabled={disabled || availableApiProfiles.length === 0}
                  value={profileId}
                  onChange={event => changeProfile(row.id, event.target.value)}
                >
                  <option value="">请选择配置</option>
                  {apiProfiles.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.name} · {item.provider}{item.available ? "" : "（不可用）"}</option>)}
                </select>
              </label>
            </> : <>
              <label className="flex min-w-0 items-center gap-2">ChatGPT 账号
                <select
                  aria-label={row.label + " ChatGPT 账号"}
                  className="min-w-0 flex-1 rounded border p-1 bg-card"
                  disabled={disabled || chatProfilesForSelect.length === 0}
                  value={profileId}
                  onChange={event => changeChatGPTProfile(row.id, event.target.value)}
                >
                  <option value="">请选择账号</option>
                  {chatProfilesForSelect.map(profile => {
                    const available = isUsableChatGPTProfile(profile);
                    return <option key={profile.id} value={profile.id} disabled={!available}>{profile.email || profile.name || profile.id}{available ? "" : "（需重新授权）"}</option>;
                  })}
                </select>
              </label>
            </>}
            <label className="flex min-w-0 items-center gap-2">模型
              <select
                aria-label={row.label + " 模型"}
                className="min-w-0 flex-1 rounded border p-1 bg-card"
                disabled={disabled || (source === "api"
                  ? !apiProfile?.available || !modelFor(apiProfile, row.vision)
                  : !isUsableChatGPTProfile(chatGPTProfile) || (!chatModels.length && !draft?.modelId))}
                value={draft?.modelId || ""}
                onChange={event => chooseModel(row.id, event.target.value)}
              >
                {draft?.modelId && !(source === "api"
                  ? modelFor(apiProfile, row.vision) === draft.modelId
                  : chatModels.some(model => model.id === draft.modelId)) &&
                  <option value={draft.modelId}>{draft.modelId}{catalog?.loading ? "（后台刷新中）" : "（已保存模型）"}</option>}
                {source === "api" && apiProfile && modelFor(apiProfile, row.vision) &&
                  <option value={modelFor(apiProfile, row.vision)}>{modelFor(apiProfile, row.vision)}{row.vision ? " · 支持图片" : " · 文本"}</option>}
                {source === "api" && !modelFor(apiProfile, row.vision) && <option value="">此配置没有可用模型</option>}
                {source === "chatgpt" && !chatModels.length && !draft?.modelId &&
                  <option value="">{catalog?.loading ? "读取可用模型…" : "暂无可用模型"}</option>}
                {source === "chatgpt" && chatModels.map(model => <option key={model.id} value={model.id}>{model.name}{model.input.includes("image") ? " · 支持图片" : " · 文本"}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="self-start rounded border px-2 py-1"
              disabled={disabled || !draft || !modelIsSupported || (isSaved && !saving[row.id])}
              onClick={() => { void save(row.id); }}
            >
              {saving[row.id] ? "保存中…" : "保存"}
            </button>
          </div>
          {source === "chatgpt" && !chatGPTStatusLoaded && <p role="status" className="mt-1 text-text-muted">正在刷新 ChatGPT 账号状态；API 配置仍可直接选择。</p>}
          {source === "chatgpt" && !isUsableChatGPTProfile(chatGPTProfile) &&
            <p role={chatGPTStatusError ? "alert" : "status"} className="mt-1 text-red-700">{chatGPTStatusError || "请先在上方连接并授权一个 ChatGPT 账号。"}</p>}
          {source === "chatgpt" && catalog?.error && <p role="alert" className="mt-1 text-red-700">ChatGPT 模型读取失败：{catalog.error}</p>}
          {source === "chatgpt" && row.vision && isUsableChatGPTProfile(chatGPTProfile)
            && catalog && !catalog.loading && !catalog.error && chatModels.length === 0
            && <p role="status" className="mt-1 text-amber-700">当前账号没有支持图片的模型，请切换其他账号或选择 API 视觉配置。</p>}
          {source === "chatgpt" && !row.vision && isUsableChatGPTProfile(chatGPTProfile)
            && catalog && !catalog.loading && !catalog.error && chatModels.length === 0
            && <p role="status" className="mt-1 text-amber-700">当前账号没有可用的文本模型，请切换其他账号。</p>}
          {errors[row.id] && <p role="alert" className="mt-1 text-red-700">{errors[row.id]}</p>}
        </section>;
      })}
      <p className="rounded-lg bg-primary/5 p-2 text-text-muted">搜索当前不调用 LLM；不提供搜索模型选择。</p>
    </div>
  </section>;
}
