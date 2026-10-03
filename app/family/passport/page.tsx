"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  Mic,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { AppHeader } from "@/components/ui/AppHeader";
import { CuteButton } from "@/components/ui/CuteButton";
import { CuteCard } from "@/components/ui/CuteCard";
import { CuteInput } from "@/components/ui/CuteInput";
import { useBabyStore } from "@/stores/useBabyStore";

type PassportDevice = {
  id: string;
  babyId: string;
  familyId: string;
  deviceLabel: string;
  hardwareVersion: string | null;
  firmwareVersion: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PassportPage = {
  data: PassportDevice[];
  nextCursor: string | null;
};

type SessionStatus = "checking" | "signed-in" | "signed-out" | "unavailable";
type DeviceListStatus = "idle" | "loading" | "ready" | "error";

const PAIR_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

class PassportHttpError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown) {
    super(`Passport request failed (${status})`);
    this.name = "PassportHttpError";
    this.status = status;
    this.payload = payload;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readErrorDetails(payload: unknown): { code: string; message: string } {
  if (!isRecord(payload)) return { code: "", message: "" };
  const nested = isRecord(payload.error) ? payload.error : payload;
  const code = typeof nested.code === "string" ? nested.code : "";
  const message = typeof nested.message === "string"
    ? nested.message
    : typeof payload.message === "string"
      ? payload.message
      : typeof payload.error === "string"
        ? payload.error
        : "";
  return { code, message };
}

function explainRequestError(error: unknown, operation: "claim" | "devices" | "revoke"): string {
  if (!(error instanceof PassportHttpError)) {
    return error instanceof Error && error.message
      ? `网络请求未完成：${error.message}`
      : "网络请求未完成，请检查连接后重试。";
  }

  const { code, message } = readErrorDetails(error.payload);
  const searchable = `${code} ${message}`;
  if (error.status === 401) return "登录状态已失效，请重新登录后再操作。";
  if (/UPSTREAM_NOT_ENABLED|PASSPORT_NOT_ENABLED|FEATURE_DISABLED|UPSTREAM_DISABLED|UPSTREAM.*NOT_CONFIGURED|not enabled|feature disabled|upstream.*not configured/i.test(searchable)
      || error.status === 501) {
    return "Passport 上游尚未启用或暂时不可用，当前无法完成此操作。请稍后再试或联系管理员。";
  }
  if (operation === "claim" && (code === "PAIRING_EXPIRED" || error.status === 410 || /pairing code has expired/i.test(message))) {
    return "设备码已过期，请在 Passport 上重新生成配对码后再试。";
  }
  if (operation === "claim" && (code === "PAIRING_ALREADY_CLAIMED" || error.status === 409)) {
    return "此设备码已使用，请在 Passport 上重新生成配对码后再试。";
  }
  if (operation === "claim" && error.status === 404 && code === "PAIRING_NOT_FOUND") {
    return "没有找到此设备码。请核对设备上显示的 8 位配对码，或重新生成后再试。";
  }
  if (operation === "claim" && error.status === 404) {
    return "宝宝授权或资料可能已发生变化，请刷新页面后重试。";
  }
  if (error.status === 403) return "当前账号没有所选宝宝的设备绑定权限。";
  if (error.status >= 500) return "Passport 服务暂时不可用，请稍后重试。";
  if (message) return `操作失败：${message}`;
  return `操作失败（${code || error.status}），请稍后重试。`;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseDevicePage(value: unknown): PassportPage | null {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.page)) return null;
  const nextCursor = value.page.nextCursor;
  if (!(nextCursor === null || typeof nextCursor === "string")) return null;

  const data: PassportDevice[] = [];
  for (const item of value.data) {
    if (!isRecord(item)
        || typeof item.id !== "string"
        || typeof item.babyId !== "string"
        || typeof item.familyId !== "string"
        || typeof item.deviceLabel !== "string"
        || !nullableString(item.hardwareVersion)
        || !nullableString(item.firmwareVersion)
        || !nullableString(item.lastSeenAt)
        || !nullableString(item.revokedAt)
        || typeof item.createdAt !== "string"
        || typeof item.updatedAt !== "string") {
      return null;
    }

    // Copy only the documented, non-secret management fields into UI state.
    data.push({
      id: item.id,
      babyId: item.babyId,
      familyId: item.familyId,
      deviceLabel: item.deviceLabel,
      hardwareVersion: item.hardwareVersion,
      firmwareVersion: item.firmwareVersion,
      lastSeenAt: item.lastSeenAt,
      revokedAt: item.revokedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }

  return { data, nextCursor };
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function formatServerDate(value: string | null): string {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间格式无效";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function PassportDevicesPage() {
  const {
    user,
    babies,
    families,
    baby,
    selectedBabyId,
    fetchUser,
  } = useBabyStore();

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("checking");
  const [sessionRetry, setSessionRetry] = useState(0);
  const [claimBabyId, setClaimBabyId] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [claimNotice, setClaimNotice] = useState("");
  const [devices, setDevices] = useState<PassportDevice[]>([]);
  const [listStatus, setListStatus] = useState<DeviceListStatus>("idle");
  const [listError, setListError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [managementNotice, setManagementNotice] = useState("");
  const [managementError, setManagementError] = useState("");
  const [focusRefreshAfterRevoke, setFocusRefreshAfterRevoke] = useState(false);

  const devicesAbortRef = useRef<AbortController | null>(null);
  const visitedCursorsRef = useRef<Set<string>>(new Set());
  const focusRevokeTriggerRef = useRef<string | null>(null);
  const focusLoginAfterRevokeRef = useRef(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setSessionStatus("checking");

    void fetchUser()
      .then(async (result) => {
        if (!active) return;
        if (result) {
          setSessionStatus("signed-in");
          return;
        }
        if (result !== null) {
          setSessionStatus("unavailable");
          return;
        }

        try {
          const response = await fetch("/api/auth/me", {
            cache: "no-store",
            headers: { "x-growdesk-representation": "extended" },
            signal: controller.signal,
          });
          if (!active) return;
          if (response.status === 401) {
            setSessionStatus("signed-out");
            return;
          }
          if (!response.ok) {
            setSessionStatus("unavailable");
            return;
          }

          const identity = await readJson(response);
          if (!active) return;
          setSessionStatus(isRecord(identity) && identity.user === null ? "signed-out" : "unavailable");
        } catch {
          if (active && !controller.signal.aborted) setSessionStatus("unavailable");
        }
      })
      .catch(() => {
        if (active) setSessionStatus("unavailable");
      });

    return () => {
      active = false;
      controller.abort();
      devicesAbortRef.current?.abort();
      devicesAbortRef.current = null;
    };
  }, [fetchUser, sessionRetry]);

  const authorizedBabyIds = useMemo(() => new Set(babies.map((item) => item.id)), [babies]);
  const currentAuthorizedBabyId = selectedBabyId && authorizedBabyIds.has(selectedBabyId)
    ? selectedBabyId
    : baby?.id && authorizedBabyIds.has(baby.id)
      ? baby.id
      : "";

  useEffect(() => {
    setClaimBabyId((current) => {
      if (current && authorizedBabyIds.has(current)) return current;
      if (current) return "";
      return currentAuthorizedBabyId;
    });
  }, [authorizedBabyIds, currentAuthorizedBabyId]);

  const loadDevices = useCallback(async (cursor: string | null = null, append = false): Promise<boolean | "unauthenticated"> => {
    if (append && !cursor) return false;

    devicesAbortRef.current?.abort();
    const controller = new AbortController();
    devicesAbortRef.current = controller;

    if (!append) {
      setListStatus("loading");
      setLoadingMore(false);
      if (!cursor) visitedCursorsRef.current.clear();
    } else {
      setLoadingMore(true);
    }
    setListError("");

    if (cursor && visitedCursorsRef.current.has(cursor)) {
      setListStatus("error");
      setListError("设备列表分页游标重复，尚未加载完的设备可能未显示。请刷新列表后重试。");
      setNextCursor(null);
      if (devicesAbortRef.current === controller) {
        devicesAbortRef.current = null;
        setLoadingMore(false);
      }
      return false;
    }
    try {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      const response = await fetch(`/api/passport/devices${suffix}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await readJson(response);
      if (!response.ok) throw new PassportHttpError(response.status, payload);

      const page = parseDevicePage(payload);
      if (!page) throw new Error("设备列表响应格式无效，请刷新后重试。");

      if (cursor) visitedCursorsRef.current.add(cursor);

      if (page.nextCursor && (page.nextCursor === cursor || visitedCursorsRef.current.has(page.nextCursor))) {
        setDevices((current) => append ? mergeDevices(current, page.data) : page.data);
        setNextCursor(null);
        setListStatus("error");
        setListError("设备列表分页游标未前进，尚未加载完的设备可能未显示。请刷新列表后重试。");
        return false;
      }

      setDevices((current) => append ? mergeDevices(current, page.data) : page.data);
      setNextCursor(page.nextCursor);
      setListStatus("ready");
      return true;
    } catch (error) {
      if (isAbortError(error)) return false;
      if (error instanceof PassportHttpError && error.status === 401) {
        setSessionStatus("signed-out");
        return "unauthenticated";
      }
      setListError(explainRequestError(error, "devices"));
      if (!append) setListStatus("error");
      return false;
    } finally {
      if (devicesAbortRef.current === controller) {
        devicesAbortRef.current = null;
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    if (sessionStatus !== "signed-in") return;
    void loadDevices();
    return () => {
      devicesAbortRef.current?.abort();
      devicesAbortRef.current = null;
    };
  }, [loadDevices, sessionStatus]);

  useEffect(() => {
    if (revokeTargetId) {
      document.getElementById(`passport-revoke-cancel-${revokeTargetId}`)?.focus();
      return;
    }

    const triggerId = focusRevokeTriggerRef.current;
    if (triggerId) {
      focusRevokeTriggerRef.current = null;
      document.getElementById(triggerId)?.focus();
    }
  }, [revokeTargetId]);

  useEffect(() => {
    if (sessionStatus === "signed-out" && focusLoginAfterRevokeRef.current) {
      focusLoginAfterRevokeRef.current = false;
      document.getElementById("passport-login-link")?.focus();
    }
  }, [sessionStatus]);

  useEffect(() => {
    if (!focusRefreshAfterRevoke
        || sessionStatus !== "signed-in"
        || listStatus === "loading"
        || loadingMore) {
      return;
    }
    setFocusRefreshAfterRevoke(false);
    document.getElementById("passport-device-list-refresh")?.focus();
  }, [focusRefreshAfterRevoke, listStatus, loadingMore, sessionStatus]);

  useEffect(() => {
    if (sessionStatus === "signed-in" && !user) setSessionStatus("signed-out");
  }, [sessionStatus, user]);

  const handleClaim = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setClaimError("");
    setClaimNotice("");

    const code = pairCode.trim();
    if (!PAIR_CODE_PATTERN.test(code)) {
      setClaimError("请输入设备屏幕显示的 8 位配对码。");
      return;
    }
    if (!authorizedBabyIds.has(claimBabyId)) {
      setClaimError("请选择一个当前账号已获授权的宝宝。");
      return;
    }

    setClaiming(true);
    try {
      const label = deviceLabel.trim();
      const body: { pairCode: string; babyId: string; deviceLabel?: string } = {
        pairCode: code,
        babyId: claimBabyId,
      };
      if (label) body.deviceLabel = label;

      const response = await fetch("/api/passport/pairings/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new PassportHttpError(response.status, payload);

      setPairCode("");
      setDeviceLabel("");
      setClaimNotice("绑定申请已提交，请等待设备连接后刷新列表。");
    } catch (error) {
      if (error instanceof PassportHttpError && error.status === 401) {
        setSessionStatus("signed-out");
      }
      setClaimError(explainRequestError(error, "claim"));
    } finally {
      setClaiming(false);
    }
  };

  const handleRevoke = async (deviceId: string) => {
    setManagementError("");
    setManagementNotice("");
    setRevokingDeviceId(deviceId);
    focusLoginAfterRevokeRef.current = true;
    try {
      const response = await fetch(`/api/passport/devices/${encodeURIComponent(deviceId)}`, {
        method: "DELETE",
      });
      const payload = await readJson(response);
      if (!response.ok) throw new PassportHttpError(response.status, payload);
      if (!isRecord(payload) || payload.success !== true) {
        throw new Error("服务端没有确认设备撤销结果，请刷新列表核对状态。");
      }

      setRevokeTargetId(null);
      const refreshResult = await loadDevices();
      const refreshed = refreshResult === true;
      setManagementNotice(refreshed
        ? "设备访问已撤销，状态已从服务端刷新。"
        : "服务端已确认撤销，但最新列表暂时无法读取；请刷新核对状态。");
      if (refreshResult !== "unauthenticated") {
        focusLoginAfterRevokeRef.current = false;
        setFocusRefreshAfterRevoke(true);
      }
    } catch (error) {
      if (error instanceof PassportHttpError && error.status === 401) {
        setSessionStatus("signed-out");
      } else {
        focusLoginAfterRevokeRef.current = false;
      }
      setManagementError(explainRequestError(error, "revoke"));
    } finally {
      setRevokingDeviceId(null);
    }
  };

  const selectedBaby = babies.find((item) => item.id === claimBabyId);

  return (
    <div className="min-h-screen bg-bg-canvas px-4 pt-4 pb-28 max-w-4xl mx-auto">
      <AppHeader title="Passport 语音设备" showBack />

      <main className="pt-4 space-y-4">
        <CuteCard variant="gradient" className="border border-primary/20">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-primary text-white flex items-center justify-center shadow-button shrink-0">
              <Mic size={21} />
            </div>
            <div>
              <h2 className="text-base font-bold text-text-primary">绑定 Passport 语音设备</h2>
              <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                先让 Passport 连接网络，再输入设备屏幕显示的 8 位配对码，并选择要绑定的宝宝。
              </p>
            </div>
          </div>
        </CuteCard>

        {sessionStatus === "checking" && (
          <div role="status" aria-live="polite">
            <CuteCard className="p-4">
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Loader2 size={17} className="animate-spin text-primary" />
                正在确认登录状态…
              </div>
            </CuteCard>
          </div>
        )}

        {sessionStatus === "signed-out" && (
          <div role="alert">
            <CuteCard className="p-4 border border-amber-300/60">
              <h2 className="text-sm font-bold text-text-primary">当前未登录</h2>
              <p className="mt-1 text-xs text-text-secondary">请登录后查看设备或提交绑定。</p>
              <Link id="passport-login-link" href="/login" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary underline underline-offset-4">
                前往登录 <ChevronRight size={16} />
              </Link>
            </CuteCard>
          </div>
        )}

        {sessionStatus === "unavailable" && (
          <div role="alert">
            <CuteCard className="p-4 border border-amber-300/60">
              <h2 className="text-sm font-bold text-text-primary">暂时无法确认登录状态</h2>
              <p className="mt-1 text-xs text-text-secondary">身份服务或宝宝资料暂时无法读取，请重试；如果登录已过期，请重新登录。</p>
              <CuteButton size="sm" variant="secondary" className="mt-3" onClick={() => setSessionRetry((value) => value + 1)}>
                <RefreshCw size={14} className="mr-1.5" />
                重试
              </CuteButton>
            </CuteCard>
          </div>
        )}

        {sessionStatus === "signed-in" && (
          <>
            {babies.length === 0 && (
              <div role="status">
                <CuteCard className="p-4 border border-amber-300/60">
                  <h2 className="text-sm font-bold text-text-primary">当前没有可用的宝宝档案</h2>
                  <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                    需要先创建宝宝，或由宝宝管理员授权当前账号访问。没有已授权宝宝时不能提交设备绑定。
                  </p>
                </CuteCard>
              </div>
            )}

            {babies.length > 0 && (
              <CuteCard className="p-4">
                <h2 className="text-sm font-bold text-text-primary mb-3">提交设备绑定</h2>
                <form onSubmit={handleClaim} className="space-y-3" aria-busy={claiming}>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="passport-baby" className="pl-1 text-sm font-medium text-text-secondary">绑定到宝宝</label>
                    <select
                      id="passport-baby"
                      value={claimBabyId}
                      onChange={(event) => setClaimBabyId(event.target.value)}
                      required
                      className="min-h-[48px] rounded-[18px] border border-primary-soft bg-card px-4 py-3 text-[16px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                      aria-describedby="passport-baby-help"
                      disabled={claiming}
                    >
                      <option value="">请选择一个已授权宝宝</option>
                      {babies.map((item) => {
                        const familyName = families.find((familyItem) => familyItem.id === item.familyId)?.name;
                        return (
                          <option key={item.id} value={item.id}>
                            {item.nickname}{familyName ? ` · ${familyName}` : ""}
                          </option>
                        );
                      })}
                    </select>
                    <p id="passport-baby-help" className="pl-1 text-[11px] text-text-muted">
                      默认选择当前宝宝；列表仅来自当前账号已授权的宝宝。
                    </p>
                  </div>

                  <CuteInput
                    id="passport-pair-code"
                    label="Passport 设备码"
                    value={pairCode}
                    onChange={(event) => {
                      setPairCode(event.target.value.replace(/[\s-]/g, "").toUpperCase().slice(0, 8));
                      setClaimError("");
                    }}
                    placeholder="输入 8 位设备码"
                    autoComplete="one-time-code"
                    inputMode="text"
                    maxLength={20}
                    required
                    aria-describedby="passport-code-help"
                    disabled={claiming}
                  />
                  <p id="passport-code-help" className="-mt-2 pl-1 text-[11px] text-text-muted">
                    可输入形如 XXXX-XXXX 的配对码；字符不含 0、O、1、I。过期或已使用时，请在设备上重新生成。
                  </p>

                  <div>
                    <CuteInput
                      id="passport-device-label"
                      label="设备名称（可选）"
                      value={deviceLabel}
                      onChange={(event) => {
                        setDeviceLabel(event.target.value.slice(0, 100));
                        setClaimError("");
                      }}
                      placeholder="例如：客厅 Passport"
                      maxLength={100}
                      disabled={claiming}
                      aria-describedby="passport-label-count"
                    />
                    <p id="passport-label-count" className="mt-1 text-right text-[11px] text-text-muted">
                      {deviceLabel.length}/100
                    </p>
                  </div>

                  {claimError && (
                    <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:bg-red-950/25 dark:text-red-300" role="alert">
                      <AlertCircle size={15} className="mt-0.5 shrink-0" />
                      <span>{claimError}</span>
                    </p>
                  )}
                  {claimNotice && (
                    <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 dark:bg-emerald-950/25 dark:text-emerald-200" role="status" aria-live="polite">
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                      <span>{claimNotice}</span>
                    </p>
                  )}

                  <CuteButton type="submit" fullWidth disabled={claiming || !claimBabyId || pairCode.length !== 8}>
                    {claiming ? <><Loader2 size={16} className="mr-2 animate-spin" />提交中…</> : "提交绑定"}
                  </CuteButton>
                  {selectedBaby && <p className="text-center text-[11px] text-text-muted">将绑定到 {selectedBaby.nickname}</p>}
                </form>
              </CuteCard>
            )}

            <CuteCard className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-sm font-bold text-text-primary">已登记的 Passport 设备</h2>
                  <p className="mt-0.5 text-[11px] text-text-secondary">设备完成连接后，可在这里查看最后连接时间和撤销状态。</p>
                </div>
                <CuteButton id="passport-device-list-refresh" size="sm" variant="secondary" onClick={() => void loadDevices()} disabled={listStatus === "loading" || loadingMore}>
                  {listStatus === "loading" ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <RefreshCw size={14} className="mr-1.5" />}
                  刷新列表
                </CuteButton>
              </div>

              {managementNotice && <p className="mb-3 text-xs text-emerald-700 dark:text-emerald-300" role="status">{managementNotice}</p>}
              {managementError && <p className="mb-3 text-xs text-red-700 dark:text-red-300" role="alert">{managementError}</p>}
              {listError && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/25 dark:text-amber-200" role="alert">{listError}</p>}

              {listStatus === "loading" && devices.length === 0 && (
                <p className="flex items-center gap-2 py-3 text-xs text-text-secondary" role="status">
                  <Loader2 size={15} className="animate-spin text-primary" />正在加载设备列表…
                </p>
              )}

              {listStatus === "ready" && devices.length === 0 && (
                <p className="rounded-xl bg-primary-light/40 px-3 py-3 text-xs text-text-secondary" role="status">
                  暂无设备记录。提交配对后，设备完成连接时会显示在这里。
                </p>
              )}

              {devices.length > 0 && (
                <div className="space-y-3" aria-live="polite">
                  {devices.map((device) => {
                    const deviceBaby = babies.find((item) => item.id === device.babyId);
                    const isRevoked = device.revokedAt !== null;
                    const isRevoking = revokingDeviceId === device.id;
                    return (
                      <article key={device.id} className="rounded-2xl border border-divider bg-card p-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-bold text-text-primary">
                              {device.deviceLabel || "Passport 语音设备"}
                            </h3>
                            <p className="mt-0.5 text-xs text-text-secondary">
                              宝宝：{deviceBaby?.nickname || "宝宝资料暂不可见"}
                            </p>
                          </div>
                          <span className={isRevoked
                            ? "shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                            : "shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"}
                          >
                            {isRevoked ? "已撤销" : "未撤销"}
                          </span>
                        </div>

                        <dl className="mt-3 grid grid-cols-1 gap-1.5 text-[11px] text-text-secondary sm:grid-cols-2">
                          <div className="flex items-center gap-1.5">
                            <Clock3 size={13} className="shrink-0 text-text-muted" />
                            <dt className="shrink-0">最后连接</dt>
                            <dd>{formatServerDate(device.lastSeenAt)}</dd>
                          </div>
                          <div><dt className="inline">硬件版本：</dt><dd className="inline">{device.hardwareVersion || "未提供"}</dd></div>
                          <div><dt className="inline">固件版本：</dt><dd className="inline">{device.firmwareVersion || "未提供"}</dd></div>
                          {isRevoked && (
                            <div><dt className="inline">撤销时间：</dt><dd className="inline">{formatServerDate(device.revokedAt)}</dd></div>
                          )}
                        </dl>

                        {!isRevoked && (
                          <div className="mt-3 border-t border-divider pt-3">
                            {revokeTargetId === device.id ? (
                              <div
                                className="rounded-xl bg-amber-50 p-3 dark:bg-amber-950/20"
                                role="group"
                                aria-labelledby={`passport-revoke-title-${device.id}`}
                                aria-describedby={`passport-revoke-description-${device.id}`}
                                aria-live="polite"
                              >
                                <h4 id={`passport-revoke-title-${device.id}`} className="text-xs font-semibold text-text-primary">
                                  确认撤销 {device.deviceLabel || "Passport 设备"}
                                </h4>
                                <p id={`passport-revoke-description-${device.id}`} className="mt-1 text-xs text-text-primary">
                                  撤销后，此设备将无法继续访问该账号的数据。确定继续吗？
                                </p>
                                <div className="mt-2.5 flex gap-2">
                                  <CuteButton id={`passport-revoke-cancel-${device.id}`} size="sm" variant="ghost" onClick={() => {
                                    focusRevokeTriggerRef.current = `passport-revoke-trigger-${device.id}`;
                                    setRevokeTargetId(null);
                                  }} disabled={isRevoking}>
                                    取消
                                  </CuteButton>
                                  <CuteButton size="sm" variant="secondary" onClick={() => void handleRevoke(device.id)} disabled={isRevoking}>
                                    {isRevoking ? <><Loader2 size={14} className="mr-1.5 animate-spin" />撤销中…</> : <><Trash2 size={14} className="mr-1.5" />确认撤销</>}
                                  </CuteButton>
                                </div>
                              </div>
                            ) : (
                              <CuteButton
                                id={`passport-revoke-trigger-${device.id}`}
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setManagementError("");
                                  setManagementNotice("");
                                  setRevokeTargetId(device.id);
                                }}
                                disabled={Boolean(revokingDeviceId)}
                                aria-label={`撤销 ${device.deviceLabel || "Passport 设备"}`}
                                className="text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/20"
                              >
                                <Trash2 size={14} className="mr-1.5" />撤销设备
                              </CuteButton>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}

              {nextCursor && (
                <div className="mt-3">
                  <CuteButton size="sm" variant="secondary" fullWidth onClick={() => void loadDevices(nextCursor, true)} disabled={loadingMore || listStatus === "loading"}>
                    {loadingMore ? <><Loader2 size={14} className="mr-1.5 animate-spin" />加载中…</> : "加载更多设备"}
                  </CuteButton>
                </div>
              )}
            </CuteCard>

            <CuteCard className="p-3.5 border border-primary/10">
              <div className="flex items-start gap-2.5">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" />
                <p className="text-[11px] leading-relaxed text-text-secondary">
                  语音识别生成的记录，需要先在设备上核对并确认后才会保存。
                </p>
              </div>
            </CuteCard>
          </>
        )}
      </main>
    </div>
  );
}

function mergeDevices(current: PassportDevice[], incoming: PassportDevice[]): PassportDevice[] {
  const byId = new Map(current.map((device) => [device.id, device]));
  for (const device of incoming) byId.set(device.id, device);
  return Array.from(byId.values());
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}
