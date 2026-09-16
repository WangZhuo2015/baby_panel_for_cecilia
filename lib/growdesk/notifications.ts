import crypto from "node:crypto";
import { BridgeError, type BridgeFetch, requireData, pathId } from "./bridge-protocol";
import { requireAccessToken } from "./ai-session-client";
import { growdeskFetch } from "./client";

import type { NotificationItem } from "@/app/api/notifications/route";

export interface BffNotification {
  id: string;
  userId: string;
  eventKey: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface CreateBffNotificationInput {
  userId: string;
  eventKey: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

export function fromGrowDeskNotification(rec: any): NotificationItem {
  const eventKey = typeof rec.eventKey === "string" ? rec.eventKey : "";
  let type: NotificationItem["type"] = "daily";
  if (eventKey.startsWith("vaccine")) {
    type = "vaccine";
  } else if (
    eventKey.startsWith("family") ||
    eventKey.startsWith("record") ||
    eventKey.startsWith("member")
  ) {
    type = "family";
  } else if (eventKey.startsWith("ai")) {
    type = "ai";
  } else if (eventKey.startsWith("data_release")) {
    type = "data_release";
  }

  const data = (rec.data && typeof rec.data === "object" ? rec.data : {}) as Record<string, unknown>;
  const createdAtMs = rec.createdAt ? new Date(rec.createdAt).getTime() : Date.now();

  return {
    id: rec.id || crypto.randomUUID(),
    type,
    title: rec.title || "通知提醒",
    detail: rec.body || rec.detail || "",
    time: rec.createdAt ? formatRelativeTime(new Date(rec.createdAt)) : "刚刚",
    urgent: Boolean(data.urgent || eventKey.includes("urgent")),
    icon: (typeof data.icon === "string" && data.icon)
      ? data.icon
      : type === "vaccine"
        ? "💉"
        : type === "family"
          ? "👨‍👩‍👧"
          : "⏰",
    actorId: (data.actorId as string) || null,
    actorLabel: (data.actorLabel as string) || null,
    createdAt: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
  };
}

function notification(value: unknown, userId: string): BffNotification {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BridgeError(502,"UPSTREAM_INVALID_NOTIFICATION","通知响应无效");
  const row = value as BffNotification;
  if (typeof row.id !== "string" || !row.id || row.userId !== userId || typeof row.eventKey !== "string" || typeof row.title !== "string" || typeof row.body !== "string" || typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt))) throw new BridgeError(502,"UPSTREAM_INVALID_NOTIFICATION","通知数据缺失或归属不符");
  return row;
}
export function createNotificationClient(fetchApi: BridgeFetch) {
  async function mutate(userId: string,id: string,token: string|undefined,read: boolean) {
    const response=await fetchApi<{success:boolean}>(`/api/v1/notifications/${pathId(id)}${read?"/read":""}`,{method:read?"POST":"DELETE",accessToken:requireAccessToken(token)});
    if(!response.ok&&response.status===404)return false;
    const data=requireData(response);
    if(!data||data.success!==true)throw new BridgeError(502,"UPSTREAM_INVALID_NOTIFICATION","通知更新未得到确认");
    return true;
  }
  return {
    async listNotifications(userId: string,options:{limit?:number;cursor?:string;accessToken?:string}={}) {
      const query=new URLSearchParams({limit:String(options.limit??100)});if(options.cursor)query.set("cursor",options.cursor);
      const response=await fetchApi<unknown>(`/api/v1/notifications?${query}`,{accessToken:requireAccessToken(options.accessToken)});
      const data=requireData(response);if(!Array.isArray(data))throw new BridgeError(502,"UPSTREAM_INVALID_NOTIFICATION","通知列表无效");
      const list=data.map(row=>notification(row,userId));
      if(new Set(list.map(row=>row.id)).size!==list.length)throw new BridgeError(502,"UPSTREAM_INVALID_NOTIFICATION","通知列表包含重复记录");
      return {data:list,page:response.page};
    },
    markAsRead:(userId:string,id:string,token?:string)=>mutate(userId,id,token,true),
    deleteNotification:(userId:string,id:string,token?:string)=>mutate(userId,id,token,false),
  };
}
export const bffNotificationStore=createNotificationClient(growdeskFetch);
