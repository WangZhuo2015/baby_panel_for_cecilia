export interface PlanModel { id: string; name: string; input: string[] }
export interface PlanStatus { profiles: { id: string; name: string; email: string; connected: boolean; sharing: boolean; reauthorize: boolean }[]; pending: { id: string; status: string; message?: string }[]; callback_port: number; manage_usage_url: string }
export class ChatGPTPlanError extends Error { code: string; constructor(code: string) }
export class ChatGPTPlan {
  constructor(options: { file: string; appName: string; port?: number; bindHost?: string; fetcher?: typeof fetch; now?: () => number });
  status(owner: string): PlanStatus;
  start(owner: string, options?: { profileId?: string; authorized?: () => boolean }): Promise<{ id: string; profile_id: string; authorization_url: string; callback_port: number; expires_at: number }>;
  models(owner: string, id: string): Promise<PlanModel[]>;
  access(owner: string, id: string): Promise<string>;
  disconnect(owner: string, id: string): Promise<{ revoked: boolean }>;
  close(): Promise<void>;
}
export function planErrorMessage(error: unknown): string;
export function planResponseError(status: number, data: unknown): string;
export function chatGPTPlanModel(id: string, input?: string[]): any;
export function chatGPTPlanFetch(plan: ChatGPTPlan, owner: string, profileId: string, options?: { fetcher?: typeof fetch; onError?: (code: string) => void }): typeof fetch;
export function chatGPTPlanPayload(payload: Record<string, unknown>): Record<string, unknown>;
