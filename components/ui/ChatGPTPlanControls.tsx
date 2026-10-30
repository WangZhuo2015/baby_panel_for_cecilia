"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LlmFeaturePreferences } from "@/components/ui/LlmFeaturePreferences";
import { useBabyStore } from "@/stores/useBabyStore";
import {
  cacheLlmPreferenceSelection,
  clearChatGPTModelCatalog,
  installLlmPreferenceLogoutCleanup,
  normalizeChatGPTModelCatalog,
  normalizeChatGPTProfileMetadata,
  normalizeLlmPreferenceSnapshot,
  readChatGPTModelCatalog,
  readChatGPTProfileMetadata,
  readLlmPreferenceSnapshot,
  writeChatGPTModelCatalog,
  writeChatGPTProfileMetadata,
  writeLlmPreferenceSnapshot,
  type ChatGPTModelMetadata,
  type ChatGPTProfileMetadata,
  type LlmPreferenceSelection,
  type LlmPreferenceSnapshot,
  type LlmProfileMetadata,
} from "@/lib/llm-preference-client-cache";

export interface ChatGPTSelection { profileId: string; modelId: string }
export interface ChatControlReadiness { ready: boolean; message?: string }
type Profile = ChatGPTProfileMetadata;
interface Status { profiles: Profile[]; pending: { id: string; status: string; message?: string }[] }
interface Attempt { id: string; profile_id: string; authorization_url: string; callback_port: number; expires_at: number }
type ApiProfile = LlmProfileMetadata;
type ChatGPTModel = ChatGPTModelMetadata;
type ModelCatalogState = { ownerId: string; profileId: string; models: ChatGPTModel[]; loading: boolean; error: string };
type SavedSelection = LlmPreferenceSelection;
interface PreferencesResponse { data: LlmPreferenceSnapshot }

function initialModelCatalogs(userId: string | null): Record<string, ModelCatalogState> {
  if (!userId) return {};
  const snapshot = readLlmPreferenceSnapshot(userId);
  const profileIds = new Set<string>([
    ...(readChatGPTProfileMetadata(userId) || []).map(profile => profile.id),
    ...(snapshot?.preferences.filter(item => item.source === "chatgpt").map(item => item.profileId) || []),
  ]);
  const catalogs: Record<string, ModelCatalogState> = {};
  for (const profileId of profileIds) {
    const models = readChatGPTModelCatalog(userId, profileId);
    if (models) catalogs[profileId] = { ownerId: userId, profileId, models, loading: false, error: "" };
  }
  return catalogs;
}

function sameSelection(left: SavedSelection | undefined, right: SavedSelection | undefined): boolean {
  return Boolean(left && right && left.feature === right.feature && left.source === right.source
    && left.profileId === right.profileId && left.modelId === right.modelId);
}

function readChatSelection(snapshot: LlmPreferenceSnapshot): SavedSelection | undefined {
  return snapshot.preferences.find(item => item.feature === "chat");
}

async function api<T>(path = "", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/ai/chatgpt" + path, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || value.error || "ChatGPT 连接暂不可用");
  return value;
}

type ChatGPTPlanControlsProps = {
  disabled: boolean;
  presentation?: "settings" | "compact";
  onReadinessChange?: (state: ChatControlReadiness) => void;
  onClose?: () => void;
};

export function ChatGPTPlanControls({ presentation = "settings", ...props }: ChatGPTPlanControlsProps) {
  const userId = useBabyStore(state => typeof state.user?.id === "string" ? state.user.id : null);
  useEffect(() => { installLlmPreferenceLogoutCleanup(useBabyStore); }, []);
  const identityKey = userId === null ? "anonymous-user" : `authenticated-user:${userId}`;
  return <ChatGPTPlanControlsForUser key={identityKey} {...props} presentation={presentation} userId={userId} />;
}

function ChatGPTPlanControlsForUser({ disabled, onReadinessChange, onClose, presentation, userId }: ChatGPTPlanControlsProps & { presentation: "settings" | "compact"; userId: string | null }) {
  const initialSnapshot = userId ? readLlmPreferenceSnapshot(userId) : null;
  const initialChatGPTProfiles = userId ? readChatGPTProfileMetadata(userId) : null;
  const [profiles, setProfiles] = useState<Profile[]>(initialChatGPTProfiles || []);
  const [chatStatusLoaded, setChatStatusLoaded] = useState(Boolean(initialChatGPTProfiles));
  const [chatStatusError, setChatStatusError] = useState("");
  const [profileId, setProfileId] = useState("");
  const [modelCatalogs, setModelCatalogs] = useState<Record<string, ModelCatalogState>>(() => initialModelCatalogs(userId));
  const modelCatalogsRef = useRef(modelCatalogs);
  const pendingModelRequests = useRef(new Map<string, Promise<ChatGPTModel[]>>());
  const completedModelRequests = useRef(new Set<string>());
  const currentCatalog = modelCatalogs[profileId]?.ownerId === userId ? modelCatalogs[profileId] : undefined;
  const models = currentCatalog?.models || [];
  const loadingModels = Boolean(currentCatalog?.loading);
  const [modelId, setModelId] = useState("");
  const modelIdRef = useRef(modelId); modelIdRef.current = modelId;
  const [attempt, setAttempt] = useState<Attempt>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [apiProfiles, setApiProfiles] = useState<ApiProfile[]>(initialSnapshot?.profiles || []);
  const [apiProfileId, setApiProfileId] = useState(initialSnapshot?.activeProfileId || initialSnapshot?.defaultModelInfo?.profileId || "");
  const [defaultApiProfileId, setDefaultApiProfileId] = useState(initialSnapshot?.activeProfileId || initialSnapshot?.defaultModelInfo?.profileId || "");
  const [defaultApiModel, setDefaultApiModel] = useState(initialSnapshot?.defaultModelInfo?.model || "");
  const [selectedSource, setSelectedSource] = useState<"api" | "chatgpt">("api");
  const [preferenceLoaded, setPreferenceLoaded] = useState(Boolean(initialSnapshot));
  const [preferenceSnapshot, setPreferenceSnapshot] = useState<LlmPreferenceSnapshot | null>(initialSnapshot);
  const [preferenceSelection, setPreferenceSelection] = useState<SavedSelection>();
  const [preferenceError, setPreferenceError] = useState("");
  const [savingPreference, setSavingPreference] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const [preferenceLoadError, setPreferenceLoadError] = useState("");
  const [usingCachedPreferences, setUsingCachedPreferences] = useState(Boolean(initialSnapshot));
  const preferenceGeneration = useRef(0);
  const preferenceQueue = useRef<{ running: boolean; pending?: SavedSelection }>({ running: false });
  const selectionRevision = useRef(0);
  const persistedRevision = useRef(0);
  const chatSelectionPending = useRef(false);
  const changeRef = useRef(onReadinessChange); changeRef.current = onReadinessChange;
  const lifecycle = useRef<AbortController | null>(null);
  const selectedSourceRef = useRef(selectedSource); selectedSourceRef.current = selectedSource;
  const profileIdRef = useRef(profileId); profileIdRef.current = profileId;

  const updateModelCatalog = useCallback((nextProfileId: string, value: ModelCatalogState) => {
    const next = { ...modelCatalogsRef.current, [nextProfileId]: value };
    modelCatalogsRef.current = next;
    setModelCatalogs(next);
  }, []);

  const requestChatGPTModels = useCallback((requestedProfileId: string, force = false): Promise<ChatGPTModel[]> => {
    if (!userId || !requestedProfileId) return Promise.resolve([]);
    const pending = pendingModelRequests.current.get(requestedProfileId);
    if (pending) return pending;
    const existing = modelCatalogsRef.current[requestedProfileId];
    const cached = readChatGPTModelCatalog(userId, requestedProfileId);
    const cachedModels = existing?.ownerId === userId ? existing.models : cached || [];
    if (!force && completedModelRequests.current.has(requestedProfileId)) return Promise.resolve(cachedModels);
    if (cached && (!existing || existing.ownerId !== userId || !existing.models.length)) {
      updateModelCatalog(requestedProfileId, { ownerId: userId, profileId: requestedProfileId, models: cached, loading: false, error: "" });
    }
    if (force) completedModelRequests.current.delete(requestedProfileId);
    const previous = modelCatalogsRef.current[requestedProfileId];
    updateModelCatalog(requestedProfileId, {
      ownerId: userId, profileId: requestedProfileId,
      models: previous?.ownerId === userId ? previous.models : cachedModels,
      loading: true, error: "",
    });
    const ownerId = userId;
    const request = api<{ models: unknown }>("?profile_id=" + encodeURIComponent(requestedProfileId), undefined, lifecycle.current?.signal)
      .then(data => {
        const freshModels = normalizeChatGPTModelCatalog(data.models);
        if (!freshModels) throw new Error("ChatGPT 模型列表格式无效");
        if (ownerId === useBabyStore.getState().user?.id) {
          writeChatGPTModelCatalog(ownerId, requestedProfileId, freshModels);
          completedModelRequests.current.add(requestedProfileId);
          updateModelCatalog(requestedProfileId, { ownerId, profileId: requestedProfileId, models: freshModels, loading: false, error: "" });
        }
        return freshModels;
      })
      .catch(error => {
        if (ownerId === useBabyStore.getState().user?.id) {
          const current = modelCatalogsRef.current[requestedProfileId];
          updateModelCatalog(requestedProfileId, {
            ownerId, profileId: requestedProfileId,
            models: current?.ownerId === ownerId ? current.models : cachedModels,
            loading: false, error: error instanceof Error ? error.message : "ChatGPT 模型读取失败",
          });
        }
        throw error;
      })
      .finally(() => {
        if (ownerId === useBabyStore.getState().user?.id) {
          const current = modelCatalogsRef.current[requestedProfileId];
          if (current?.ownerId === ownerId) updateModelCatalog(requestedProfileId, { ...current, loading: false });
        }
        pendingModelRequests.current.delete(requestedProfileId);
      });
    pendingModelRequests.current.set(requestedProfileId, request);
    return request;
  }, [userId, updateModelCatalog]);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    const generation = ++preferenceGeneration.current;
    if (!userId) {
      setPreferenceLoaded(false);
      setChatStatusLoaded(false);
      setChatStatusError("");
      setProfiles([]);
      setApiProfiles([]);
      setPreferenceSnapshot(null);
      setPreferenceLoadError("请登录后配置模型");
      return () => controller.abort();
    }

    const cached = readLlmPreferenceSnapshot(userId);
    const cachedProfiles = readChatGPTProfileMetadata(userId);
    const selectionRevisionAtStart = selectionRevision.current;
    const persistedRevisionAtStart = persistedRevision.current;
    const applySnapshot = (prefs: LlmPreferenceSnapshot, applySelection: boolean) => {
      setPreferenceSnapshot(prefs);
      setApiProfiles(prefs.profiles || []);
      const saved = readChatSelection(prefs);
      const defaultProfileId = prefs.activeProfileId || prefs.defaultModelInfo?.profileId || "";
      setDefaultApiProfileId(defaultProfileId);
      setDefaultApiModel(prefs.defaultModelInfo?.model || "");
      if (!applySelection) return;
      setPreferenceSelection(saved);
      if (saved?.source === "chatgpt") {
        setSelectedSource("chatgpt"); selectedSourceRef.current = "chatgpt";
        setProfileId(saved.profileId); profileIdRef.current = saved.profileId;
        setModelId(saved.modelId); modelIdRef.current = saved.modelId;
      } else {
        setSelectedSource("api"); selectedSourceRef.current = "api";
        setApiProfileId(saved?.profileId || defaultProfileId);
        const nextModelId = saved?.modelId || prefs.defaultModelInfo?.model || "";
        setModelId(nextModelId); modelIdRef.current = nextModelId;
      }
    };

    if (cached) {
      applySnapshot(cached, true);
      setPreferenceLoaded(true);
      setPreferenceLoadError("");
      setUsingCachedPreferences(true);
    } else {
      setPreferenceLoaded(false);
      setUsingCachedPreferences(false);
    }

    void api<Status>("", undefined, controller.signal)
      .then(data => {
        if (controller.signal.aborted || generation !== preferenceGeneration.current || userId !== useBabyStore.getState().user?.id) return;
        const freshProfiles = normalizeChatGPTProfileMetadata(data.profiles);
        if (!freshProfiles) throw new Error("ChatGPT 账号列表格式无效");
        setProfiles(freshProfiles);
        writeChatGPTProfileMetadata(userId, freshProfiles);
        setChatStatusError("");
        if (!profileIdRef.current) {
          const connected = freshProfiles.find(item => item.connected && item.sharing) || freshProfiles[0];
          if (connected) { setProfileId(connected.id); profileIdRef.current = connected.id; }
        }
      })
      .catch(error => {
        if (!controller.signal.aborted && generation === preferenceGeneration.current && userId === useBabyStore.getState().user?.id) {
          const message = error instanceof Error ? error.message : "ChatGPT 账号读取失败";
          setChatStatusError(message);
          if (!cachedProfiles) setMessage(message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && generation === preferenceGeneration.current && userId === useBabyStore.getState().user?.id) setChatStatusLoaded(true);
      });

    void fetch("/api/ai/preferences", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || "模型配置加载失败");
        const snapshot = normalizeLlmPreferenceSnapshot(value.data);
        if (!snapshot) throw new Error("模型配置响应格式无效");
        return snapshot;
      })
      .then(snapshot => {
        if (controller.signal.aborted || generation !== preferenceGeneration.current || userId !== useBabyStore.getState().user?.id) return;
        const canApplySelection = selectionRevision.current === selectionRevisionAtStart
          && persistedRevision.current === persistedRevisionAtStart;
        applySnapshot(snapshot, canApplySelection);
        if (canApplySelection) writeLlmPreferenceSnapshot(userId, snapshot);
        setPreferenceLoadError("");
        setPreferenceLoaded(true);
        setUsingCachedPreferences(false);
      })
      .catch(error => {
        if (!controller.signal.aborted && generation === preferenceGeneration.current && userId === useBabyStore.getState().user?.id) {
          setPreferenceLoadError(error instanceof Error ? error.message : "模型配置加载失败");
          setPreferenceLoaded(true);
        }
      });
    return () => {
      controller.abort();
      if (generation === preferenceGeneration.current) preferenceGeneration.current += 1;
    };
  }, [userId]);

  useEffect(() => {
    if (selectedSource !== "chatgpt" || !profileId) return;
    const selectionRevisionAtStart = selectionRevision.current;
    const modelIdAtStart = modelIdRef.current;
    void requestChatGPTModels(profileId, true)
      .then(freshModels => {
        if (userId === useBabyStore.getState().user?.id
          && selectedSourceRef.current === "chatgpt" && profileIdRef.current === profileId) {
          const selectionChangedDuringFetch = selectionRevision.current !== selectionRevisionAtStart
            || modelIdRef.current !== modelIdAtStart;
          const nextModelId = selectionChangedDuringFetch
            ? modelIdRef.current
            : freshModels.some(model => model.id === modelIdAtStart) ? modelIdAtStart : (freshModels[0]?.id || "");
          if (!selectionChangedDuringFetch) { setModelId(nextModelId); modelIdRef.current = nextModelId; }
          setMessage("使用 ChatGPT 套餐额度，与其他应用共享用量上限。");
          if (!selectionChangedDuringFetch && chatSelectionPending.current && nextModelId) {
            chatSelectionPending.current = false;
            void persistSelection({ feature: "chat", source: "chatgpt", profileId, modelId: nextModelId });
          }
        }
      })
      .catch(error => {
        if (userId === useBabyStore.getState().user?.id && selectedSourceRef.current === "chatgpt" && profileIdRef.current === profileId)
          setMessage(error instanceof Error ? error.message : "ChatGPT 模型读取失败");
      });
  }, [selectedSource, profileId, catalogVersion, userId, requestChatGPTModels]);

  async function persistSelection(next: SavedSelection): Promise<void> {
    if (!userId) return;
    const queue = preferenceQueue.current;
    if (queue.running) {
      queue.pending = next;
      setSavingPreference(true);
      setPreferenceError("");
      setPreferenceMessage("最新模型选择将继续保存…");
      return;
    }

    queue.running = true;
    setSavingPreference(true);
    setPreferenceError("");
    setPreferenceMessage("正在保存模型配置…");
    let requested: SavedSelection | undefined = next;
    try {
      while (requested && userId === useBabyStore.getState().user?.id && !lifecycle.current?.signal.aborted) {
        const current = requested;
        queue.pending = undefined;
        try {
          const response = await fetch("/api/ai/preferences", {
            method: "PUT", credentials: "same-origin", cache: "no-store",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify(current),
            signal: lifecycle.current?.signal,
          });
          const value = await response.json();
          if (!response.ok) throw new Error(value.error || "模型配置保存失败");
          const snapshot = normalizeLlmPreferenceSnapshot({ preferences: [value.data], profiles: [], activeProfileId: "" });
          const savedSelection = snapshot?.preferences[0];
          if (!savedSelection || savedSelection.feature !== "chat") throw new Error("保存响应格式无效");
          if (userId !== useBabyStore.getState().user?.id || lifecycle.current?.signal.aborted) break;
          persistedRevision.current += 1;
          setPreferenceSelection(savedSelection);
          cacheLlmPreferenceSelection(userId, savedSelection);
          const pending = queue.pending;
          if (pending && !sameSelection(pending, savedSelection)) {
            requested = pending;
            queue.pending = undefined;
            setPreferenceMessage("继续保存最新模型选择…");
          } else {
            requested = undefined;
            setPreferenceMessage("模型配置已保存。");
          }
        } catch (error) {
          if (userId !== useBabyStore.getState().user?.id || lifecycle.current?.signal.aborted) break;
          const pending = queue.pending;
          if (pending && !sameSelection(pending, current)) {
            requested = pending;
            queue.pending = undefined;
            setPreferenceMessage("继续保存最新模型选择…");
            continue;
          }
          const message = error instanceof Error ? error.message : "模型配置保存失败";
          setPreferenceError(message);
          setPreferenceMessage(`保存失败：${message}`);
          requested = undefined;
        }
      }
    } finally {
      queue.running = false;
      queue.pending = undefined;
      if (userId === useBabyStore.getState().user?.id && !lifecycle.current?.signal.aborted) setSavingPreference(false);
    }
  }

  useEffect(() => {
    if (!preferenceLoaded) {
      changeRef.current?.({ ready: false, message: "正在加载模型配置…" });
      return;
    }
    if (preferenceError) {
      changeRef.current?.({ ready: false, message: `模型配置不可用：${preferenceError}` });
      return;
    }
    if (savingPreference) {
      changeRef.current?.({ ready: false, message: "正在保存模型配置…" });
      return;
    }
    if (selectedSource === "api") {
      const profile = apiProfiles.find(item => item.id === apiProfileId);
      const availableModels = profile ? [...new Set([profile.textModel, profile.visionModel].filter(Boolean))] : [];
      const isUntouchedDefault = !preferenceSelection && apiProfileId === defaultApiProfileId && modelId === defaultApiModel;
      const matchesSaved = preferenceSelection?.source === "api" && preferenceSelection.profileId === apiProfileId && preferenceSelection.modelId === modelId;
      if (!profile?.available || !availableModels.includes(modelId) || !(isUntouchedDefault || matchesSaved)) {
        changeRef.current?.({ ready: false, message: profile ? "请保存一个可用的 API 配置和模型" : "没有可用的 API 配置" });
        return;
      }
      changeRef.current?.({ ready: true });
      return;
    }
    const chatProfile = profiles.find(item => item.id === profileId);
    const matchesSaved = preferenceSelection?.source === "chatgpt" && preferenceSelection.profileId === profileId && preferenceSelection.modelId === modelId;
    if (!chatStatusLoaded || !chatProfile?.connected || !chatProfile.sharing || !modelId || !matchesSaved) {
      changeRef.current?.({ ready: false, message: "请连接 ChatGPT 并保存可用模型" });
      return;
    }
    changeRef.current?.({ ready: true });
  }, [preferenceLoaded, preferenceError, savingPreference, selectedSource, apiProfiles, apiProfileId, modelId, preferenceSelection, defaultApiProfileId, defaultApiModel, profiles, profileId, chatStatusLoaded, loadingModels, models]);

  useEffect(() => {
    if (!attempt) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (controller.signal.aborted) return;
      if (Date.now() >= attempt.expires_at) { setMessage("授权已超时，请重新连接。"); setAttempt(undefined); return; }
      try {
        const data = await api<Status>("", undefined, controller.signal);
        const freshProfiles = normalizeChatGPTProfileMetadata(data.profiles);
        if (!freshProfiles) throw new Error("ChatGPT 账号列表格式无效");
        setProfiles(freshProfiles);
        writeChatGPTProfileMetadata(userId, freshProfiles);
        setChatStatusLoaded(true);
        setChatStatusError("");
        const current = data.pending.find(p => p.id === attempt.id);
        if (current?.status === "connected") { setProfileId(attempt.profile_id); profileIdRef.current = attempt.profile_id; setCatalogVersion(version => version + 1); setMessage(freshProfiles.find(profile => profile.id === attempt.profile_id)?.sharing ? "ChatGPT 已连接，后续请求将使用你的套餐额度。" : "ChatGPT 账号已连接，但尚未允许套餐使用，请重新授权。"); setAttempt(undefined); return; }
        if (current?.status === "error") { setMessage(current.message || "授权未完成，请重试。"); setAttempt(undefined); return; }
      } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "连接暂不可用"); }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 2500);
    };
    timer = setTimeout(() => { void poll(); }, 1500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [attempt]);

  async function connect(existing = false) {
    setBusy(true);
    try {
      const next = await api<Attempt>("", { action: "connect", ...(existing ? { profile_id: profileId } : {}) }, lifecycle.current?.signal);
      if (new URL(next.authorization_url).origin !== "https://auth.openai.com") throw new Error("授权地址无效");
      setAttempt(next); setMessage("等待 ChatGPT 授权完成。");
    } catch (error) { if (!lifecycle.current?.signal.aborted) setMessage(error instanceof Error ? error.message : "授权未完成"); }
    finally { if (!lifecycle.current?.signal.aborted) setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    try {
      const disconnectedProfileId = profileId;
      const result = await api<{ revoked: boolean }>("", { action: "disconnect", profile_id: disconnectedProfileId }, lifecycle.current?.signal);
      clearChatGPTModelCatalog(userId, disconnectedProfileId);
      const disconnectedProfiles = profiles.map(profile => profile.id === disconnectedProfileId
        ? { ...profile, connected: false, sharing: false, reauthorize: true }
        : profile);
      setProfiles(disconnectedProfiles);
      writeChatGPTProfileMetadata(userId, disconnectedProfiles);
      const nextCatalogs = { ...modelCatalogsRef.current };
      delete nextCatalogs[disconnectedProfileId];
      modelCatalogsRef.current = nextCatalogs;
      setModelCatalogs(nextCatalogs);
      if (selectedSourceRef.current === "chatgpt" && profileIdRef.current === disconnectedProfileId) {
        setModelId(""); modelIdRef.current = "";
      }
      setMessage(result.revoked ? "已断开 ChatGPT 连接。可重新授权或选择现有 API 配置。" : "本应用已断开；远端撤销尚未确认，请在 ChatGPT 设置中断开此应用。");
      const data = await api<Status>("", undefined, lifecycle.current?.signal);
      const freshProfiles = normalizeChatGPTProfileMetadata(data.profiles);
      if (!freshProfiles) throw new Error("ChatGPT 账号列表格式无效");
      setProfiles(freshProfiles); writeChatGPTProfileMetadata(userId, freshProfiles); setChatStatusError(""); setChatStatusLoaded(true);
    } catch (error) { if (!lifecycle.current?.signal.aborted) setMessage(error instanceof Error ? error.message : "断开连接未完成"); }
    finally { if (!lifecycle.current?.signal.aborted) setBusy(false); }
  }

  function chooseSource(nextSource: "api" | "chatgpt") {
    selectionRevision.current += 1;
    selectedSourceRef.current = nextSource;
    setSelectedSource(nextSource);
    setPreferenceError("");
    if (nextSource === "api") {
      chatSelectionPending.current = false;
      const profile = apiProfiles.find(item => item.id === apiProfileId) || apiProfiles.find(item => item.id === defaultApiProfileId);
      if (!profile) return;
      const next = { feature: "chat" as const, source: "api" as const, profileId: profile.id, modelId: profile.visionModel || profile.textModel };
      setApiProfileId(profile.id); setModelId(next.modelId); modelIdRef.current = next.modelId;
      void persistSelection(next);
      return;
    }
    chatSelectionPending.current = true;
    if (!profileId) {
      const connected = profiles.find(item => item.connected && item.sharing) || profiles[0];
      if (connected) { setProfileId(connected.id); profileIdRef.current = connected.id; }
    }
    setModelId(""); modelIdRef.current = "";
  }

  function chooseApiProfile(nextProfileId: string) {
    selectionRevision.current += 1;
    chatSelectionPending.current = false;
    const profile = apiProfiles.find(item => item.id === nextProfileId);
    selectedSourceRef.current = "api";
    setApiProfileId(nextProfileId);
    setSelectedSource("api");
    setPreferenceError("");
    if (!profile) { setModelId(""); modelIdRef.current = ""; return; }
    const nextModelId = profile.visionModel || profile.textModel;
    setModelId(nextModelId); modelIdRef.current = nextModelId;
    void persistSelection({ feature: "chat", source: "api", profileId: profile.id, modelId: nextModelId });
  }

  function chooseModel(nextModelId: string) {
    selectionRevision.current += 1;
    modelIdRef.current = nextModelId;
    chatSelectionPending.current = false;
    setModelId(nextModelId);
    setPreferenceError("");
    if (selectedSource === "api" && apiProfileId) {
      void persistSelection({ feature: "chat", source: "api", profileId: apiProfileId, modelId: nextModelId });
    } else if (selectedSource === "chatgpt" && profileId) {
      void persistSelection({ feature: "chat", source: "chatgpt", profileId, modelId: nextModelId });
    }
  }

  const selectedApiProfile = apiProfiles.find(item => item.id === apiProfileId);
  const selectedChatProfile = profiles.find(item => item.id === profileId);
  const currentModelSource = selectedSource === "chatgpt"
    ? `ChatGPT 套餐${selectedChatProfile ? ` · ${selectedChatProfile.email || selectedChatProfile.name}` : ""}`
    : selectedApiProfile?.name || "API 配置";

  if (presentation === "compact") {
    return <div aria-label="聊天模型状态与设置" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/15 px-2.5 py-2 text-xs">
      <p role="status" aria-label="当前聊天模型" className="min-w-0 truncate text-text-secondary">
        当前模型：{currentModelSource} · {modelId || (preferenceLoaded ? "未选择模型" : "正在读取模型…")}
      </p>
      <a href="/settings#ai-models" onClick={() => onClose?.()} className="shrink-0 font-medium text-primary underline underline-offset-2">模型设置</a>
    </div>;
  }

  return <div className="flex flex-col gap-3">
    <section className="rounded-xl border border-primary/15 p-3 text-xs" aria-label="ChatGPT 订阅与模型">
      <div className="mb-2">
        <h3 className="font-semibold text-sm">聊天模型</h3>
        <p className="text-text-muted">选择对话使用的模型来源与模型。</p>
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">模型来源
          <select aria-label="聊天模型来源" className="min-w-0 flex-1 rounded border p-1 bg-card" disabled={disabled || !preferenceLoaded} value={selectedSource} onChange={event => chooseSource(event.target.value as "api" | "chatgpt")}>
            <option value="api">API 配置</option>
            <option value="chatgpt">ChatGPT 套餐</option>
          </select>
        </label>
        {selectedSource === "api" ? <>
          <label className="flex items-center gap-2">API 配置
            <select aria-label="API 配置" className="min-w-0 flex-1 rounded border p-1 bg-card" disabled={disabled || !preferenceLoaded} value={apiProfileId} onChange={event => chooseApiProfile(event.target.value)}>
              <option value="">请选择配置</option>
              {apiProfiles.map(profile => <option key={profile.id} value={profile.id} disabled={!profile.available}>{profile.name} · {profile.provider}{profile.available ? "" : "（不可用）"}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">模型
            <select aria-label="API 模型" className="min-w-0 flex-1 rounded border p-1 bg-card" disabled={disabled || !apiProfiles.some(item => item.id === apiProfileId)} value={modelId} onChange={event => chooseModel(event.target.value)}>
              {apiProfiles.filter(item => item.id === apiProfileId).flatMap(profile => {
                return [...new Set([profile.textModel, profile.visionModel].filter(Boolean))]
                  .map(id => <option key={id} value={id}>{id} · {id === profile.visionModel ? "文本与图片" : "文本"}</option>);
              })}
            </select>
          </label>
          {apiProfiles.some(item => item.id === apiProfileId && item.textModel !== item.visionModel && modelId === item.textModel) &&
            <p role="status" className="text-amber-700">当前使用文本模型；提问图片前，请切换为此配置的视觉模型。</p>}
        </> : <label className="flex items-center gap-2">ChatGPT 模型
          <select aria-label="ChatGPT 模型" className="min-w-0 flex-1 rounded border p-1 bg-card" disabled={disabled || (!models.length && !modelId)} value={modelId} onChange={event => chooseModel(event.target.value)}>
            {modelId && !models.some(model => model.id === modelId) && <option value={modelId}>{modelId}{loadingModels ? " · 后台读取中" : " · 已保存模型"}</option>}
            {!models.length && !modelId && <option value="">{loadingModels ? "读取可用模型…" : "请连接账号或刷新授权"}</option>}
            {models.map(model => <option key={model.id} value={model.id}>{model.name}{model.input?.includes("image") ? " · 支持图片" : " · 仅文本"}</option>)}
          </select>
        </label>}
      </div>
      {usingCachedPreferences && <p role="status" className="mt-2">已恢复本机缓存选择，正在后台刷新。</p>}
      {userId && preferenceLoadError && <p role={usingCachedPreferences ? "status" : "alert"} className="mt-2">模型配置刷新失败：{preferenceLoadError}</p>}
      {preferenceMessage && <p role={preferenceError ? "alert" : "status"} className="mt-2">{preferenceMessage}</p>}
      {message && <p role="status" className="mt-2">{message}</p>}
    </section>

    <section className="rounded-xl border border-primary/15 p-3 text-xs" aria-label="ChatGPT 账号与套餐">
      <div className="mb-2">
        <h3 className="font-semibold text-sm">ChatGPT 账号与套餐</h3>
        <p className="text-text-muted">连接或管理账号，也可查看套餐用量。</p>
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">ChatGPT 账号
          <select aria-label="ChatGPT 账号" className="min-w-0 flex-1 rounded border p-1 bg-card" disabled={disabled || busy} value={profileId} onChange={event => {
            selectionRevision.current += 1;
            chatSelectionPending.current = selectedSource === "chatgpt";
            profileIdRef.current = event.target.value;
            setProfileId(event.target.value);
            if (selectedSource === "chatgpt") { setModelId(""); modelIdRef.current = ""; }
          }}>
            <option value="">请选择账号</option>
            {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.email || profile.name}{profile.connected && profile.sharing ? "" : "（需授权）"}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="rounded border px-2 py-1" disabled={disabled || busy} onClick={() => { void connect(); }}>连接 ChatGPT</button>
          {profileId && <><button type="button" disabled={disabled || busy} onClick={() => { void connect(true); }}>重新授权</button><button type="button" disabled={disabled || busy} onClick={() => { void disconnect(); }}>断开连接</button></>}
          <a className="underline" href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noopener noreferrer">管理 ChatGPT 用量</a>
        </div>
        {attempt && <div>
          <p>远程访问时，先在自己的电脑上通过 SSH 转发授权端口 <code>{attempt.callback_port}</code>，再打开授权。具体方法见项目的 ChatGPT 接入文档。</p>
          <a className="underline" href={attempt.authorization_url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">打开 ChatGPT 授权</a>
        </div>}
        {selectedSource === "chatgpt" && profileId && <p>相关宝宝资料会发送至 OpenAI，使用你授权的 ChatGPT 套餐额度。</p>}
      </div>
    </section>
    <LlmFeaturePreferences
      disabled={disabled}
      userId={userId}
      snapshot={preferenceSnapshot}
      preferenceLoading={!preferenceLoaded}
      preferenceError={preferenceLoadError}
      chatGPTProfiles={profiles}
      chatGPTStatusLoaded={chatStatusLoaded}
      chatGPTStatusError={chatStatusError}
      chatGPTModelCatalogs={modelCatalogs}
      onLoadChatGPTModels={requestChatGPTModels}
    />
  </div>;
}
