import { growdeskFetch } from "./client";
import { createAiSessionClient } from "./ai-session-client";

export type { BffAiChatMessage, BffAiSession, CreateAiSessionInput, ListAiSessionsOptions } from "./ai-session-client";
export { createAiSessionClient } from "./ai-session-client";

// There is deliberately no process-global cache, filesystem persistence or success fallback.
export const bffAiSessionStore = createAiSessionClient(growdeskFetch);
