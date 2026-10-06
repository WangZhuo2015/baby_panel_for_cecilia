const PUSH_WAIT_MS = 8_000;
const PUSH_REQUEST_MS = 10_000;

export class PushClientError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "PushClientError";
  }
}

export function pushErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "NotAllowedError") return "通知权限未开启，请在浏览器设置中允许通知";
    if (error.name === "TimeoutError" || error.name === "AbortError") return "推送请求超时，请检查网络后重试";
    return error.message;
  }
  return "推送操作失败，请检查网络后重试";
}

async function bounded<T>(operation: Promise<T>, message: string, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PushClientError(message)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** ready alone never settles if this origin has no active registration. */
export async function getPushRegistration(
  workers: Pick<ServiceWorkerContainer, "getRegistration" | "register" | "ready">,
  create = false,
  timeoutMs = PUSH_WAIT_MS,
): Promise<ServiceWorkerRegistration> {
  return bounded((async () => {
    let registration = await workers.getRegistration();
    if (!registration) {
      if (!create) throw new PushClientError("尚未注册推送服务，请点击开启推送通知重试");
      registration = await workers.register("/sw.js", { updateViaCache: "none" });
    }
    return registration.active?.state === "activated" ? registration : await workers.ready;
  })(), "推送服务启动超时，请刷新页面后重试", timeoutMs);
}

async function responseData(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// Use AbortController so older browsers supporting Web Push can also time out
// requests without depending on the newer AbortSignal.timeout API.
async function pushRequest(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit = {},
  timeoutMs = PUSH_REQUEST_MS,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    const data = await responseData(response);
    if (controller.signal.aborted) throw new PushClientError("推送请求超时，请检查网络后重试");
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

function serverError(response: Response, data: Record<string, unknown>, fallback: string): PushClientError {
  const error = data.error;
  const message = typeof error === "string" ? error
    : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message
      : response.status === 401 ? "登录已过期，请重新登录后重试"
        : response.status === 403 ? "推送请求被拒绝，请刷新页面后重试"
          : fallback;
  return new PushClientError(message, typeof data.code === "string" ? data.code : undefined);
}

function decodeKey(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) {
    throw new PushClientError("推送公钥配置无效，请联系管理员检查推送设置");
  }
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
    if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("invalid key");
    return bytes;
  } catch {
    throw new PushClientError("推送公钥配置无效，请联系管理员检查推送设置");
  }
}

function sameKey(existing: ArrayBuffer, expected: Uint8Array): boolean {
  const bytes = new Uint8Array(existing);
  return bytes.length === expected.length && bytes.every((value, index) => value === expected[index]);
}

export function isPassivePushRecoveryEligible(
  permission: string,
  pushSupported: boolean,
  standaloneEligible: boolean,
): boolean {
  return permission === "granted" && pushSupported && standaloneEligible;
}

export interface PassivePushRecoveryOptions {
  permission: string;
  pushSupported: boolean;
  standaloneEligible: boolean;
  getRegistration: () => Promise<Pick<ServiceWorkerRegistration, "pushManager"> | null>;
  /** A locally known identity is only a consistency check; the API session remains authoritative. */
  expectedUserId: string;
  isCurrent?: () => boolean;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export type PassivePushRecoveryResult = "synced" | "skipped";

async function authorizedUserId(fetcher: typeof fetch, timeoutMs: number): Promise<string | null> {
  const { response, data } = await pushRequest(fetcher, "/api/auth/me", { cache: "no-store" }, timeoutMs);
  if (!response.ok || !data.user || typeof data.user !== "object" || Array.isArray(data.user)) return null;
  const userId = (data.user as Record<string, unknown>).id;
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}

function completeSubscriptionJson(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const json = value as Record<string, unknown>;
  if (typeof json.endpoint !== "string" || !json.endpoint.trim()) return false;
  if (!json.keys || typeof json.keys !== "object" || Array.isArray(json.keys)) return false;
  const keys = json.keys as Record<string, unknown>;
  return typeof keys.p256dh === "string" && keys.p256dh.length > 0 &&
    typeof keys.auth === "string" && keys.auth.length > 0;
}

/**
 * Restore the server binding for a browser subscription that already exists.
 * This path never asks for permission, subscribes, unsubscribes, or rotates a key.
 */
export async function recoverExistingPushSubscription(
  options: PassivePushRecoveryOptions,
): Promise<PassivePushRecoveryResult> {
  if (!isPassivePushRecoveryEligible(options.permission, options.pushSupported, options.standaloneEligible)) {
    return "skipped";
  }

  const expectedUserId = options.expectedUserId.trim();
  if (!expectedUserId) return "skipped";

  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? PUSH_WAIT_MS;
  const isCurrent = options.isCurrent ?? (() => true);
  if (!isCurrent()) return "skipped";

  const initialUserId = await authorizedUserId(fetcher, timeoutMs);
  if (!initialUserId || !isCurrent() || initialUserId !== expectedUserId) {
    return "skipped";
  }

  const registration = await bounded(
    Promise.resolve().then(options.getRegistration),
    "推送服务启动超时，请稍后重试",
    timeoutMs,
  );
  if (!isCurrent() || !registration) return "skipped";

  const subscription = await bounded(
    registration.pushManager.getSubscription(),
    "读取推送订阅超时，请稍后重试",
    timeoutMs,
  );
  // Auth changes during either browser wait invalidate this run before it can
  // read the key or upload a subscription under a later account's cookie.
  if (!isCurrent() || !subscription) return "skipped";

  const { response: keyResponse, data: keyData } = await pushRequest(
    fetcher,
    "/api/push/vapid-key",
    { cache: "no-store" },
    timeoutMs,
  );
  if (!isCurrent()) return "skipped";
  if (!keyResponse.ok) throw serverError(keyResponse, keyData, "获取推送公钥失败，请稍后重试");
  const key = decodeKey(keyData.publicKey);

  // Passive recovery must never replace a local subscription. If this browser
  // cannot expose its VAPID key, or it differs from the server key, leave it
  // untouched and let the user choose an explicit recovery action.
  const existingKey = subscription.options?.applicationServerKey;
  if (!existingKey || !sameKey(existingKey, key)) return "skipped";
  const subscriptionJson = subscription.toJSON();
  if (!completeSubscriptionJson(subscriptionJson)) {
    throw new PushClientError("浏览器返回的推送订阅不完整，未修改现有订阅");
  }

  const latestUserId = await authorizedUserId(fetcher, timeoutMs);
  if (!isCurrent() || latestUserId !== initialUserId || latestUserId !== expectedUserId) {
    return "skipped";
  }

  // The server derives ownership from its validated session. The browser ID is
  // never sent in this request, and the complete current subscription is kept.
  const { response, data } = await pushRequest(fetcher, "/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscriptionJson),
  }, timeoutMs);
  if (!response.ok || data.success !== true) {
    throw serverError(response, data, "服务端未确认设备绑定，请稍后重试");
  }
  return isCurrent() ? "synced" : "skipped";
}

/** A local subscription is usable only after the server confirms this binding. */
export async function syncPushSubscription(
  registration: Pick<ServiceWorkerRegistration, "pushManager">,
  allowCreate = false,
  fetcher: typeof fetch = fetch,
  timeoutMs = PUSH_WAIT_MS,
): Promise<PushSubscription | null> {
  let subscription = await bounded(registration.pushManager.getSubscription(), "读取推送订阅超时，请刷新页面后重试", timeoutMs);
  if (!subscription && !allowCreate) return null;
  const { response: keyResponse, data: keyData } = await pushRequest(fetcher, "/api/push/vapid-key", { cache: "no-store" });
  if (!keyResponse.ok) throw serverError(keyResponse, keyData, "获取推送公钥失败，请稍后重试");
  const key = decodeKey(keyData.publicKey);

  // Some older browsers do not expose the existing key. Keep that subscription
  // rather than destructively guessing that it changed.
  const existingKey = subscription?.options?.applicationServerKey;
  if (subscription && existingKey && !sameKey(existingKey, key)) {
    const removed = await bounded(subscription.unsubscribe(), "更新推送订阅超时，请刷新页面后重试", timeoutMs);
    if (!removed) throw new PushClientError("更新推送订阅失败，请刷新页面后重试");
    subscription = null;
  }
  if (!subscription) {
    subscription = await bounded(
      registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }),
      "创建推送订阅超时，请刷新页面后重试", timeoutMs,
    );
  }
  const { response, data } = await pushRequest(fetcher, "/api/push/subscribe", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok || data.success !== true) {
    throw serverError(response, data, "服务端未确认设备绑定，请点击开启推送通知重试");
  }
  return subscription;
}

/** Acceptance by a push provider still does not prove display on a device. */
export async function sendTestPush(subscription: PushSubscription, fetcher: typeof fetch = fetch, timeoutMs = PUSH_WAIT_MS): Promise<void> {
  const { response, data } = await pushRequest(fetcher, "/api/push/test", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!response.ok) {
    const error = serverError(response, data, "发送测试推送失败，请稍后重试");
    // A provider-confirmed expired endpoint cannot recover by uploading the
    // same local subscription. Only this explicit code permits its removal.
    if (error.code === "PUSH_SUBSCRIPTION_GONE") {
      try {
        const removed = await bounded(subscription.unsubscribe(), "移除失效推送订阅超时", timeoutMs);
        if (!removed) throw new Error("removal failed");
      } catch {
        throw new PushClientError("推送订阅已失效，但旧订阅未能移除；请在浏览器设置中重置本站通知权限后重试", error.code);
      }
    }
    throw error;
  }
  if (data.simulated === true) throw new PushClientError("当前为模拟推送，未向系统通知栏发送；请联系管理员配置真实推送");
  if (data.success !== true || typeof data.sent !== "number" || !Number.isSafeInteger(data.sent) || data.sent <= 0) {
    throw serverError(response, data, "推送服务未接受测试通知，请稍后重试或联系管理员检查推送设置");
  }
}
