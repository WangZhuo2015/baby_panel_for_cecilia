import {
  type ApiBaby,
  type BridgeFetch,
  BridgeError,
  bridgeErrorResponse,
  requireData,
  pathId,
  babyPayload,
  legacyBaby,
} from "./bridge-protocol";
import {
  type ApiFamily,
  type ApiFamilyMember,
  type ApiBabyMember,
  type ApiBabyMemberRole,
  type LegacyBaby,
  accessibleFamily,
  loadFamilyMembers,
  loadFamilyBabies,
  loadWebIdentity,
  loadWebBaby,
  creationFamilyId,
} from "./bridge-identity";
import {
  GROWDESK_REPRESENTATION_HEADER,
  wantsExtendedRepresentation,
} from "./legacy-projections";
export { GROWDESK_REPRESENTATION_HEADER } from "./legacy-projections";

export interface WebSession {
  accessToken: string;
  user: { id: string; username: string; displayName: string };
  sessionSecret?: string;
  isNewSession?: boolean;
}

export interface LegacyFamily {
  id: string;
  name: string;
  inviteCode?: string;
  inviteExpiresAt?: string;
  role?: string;
  timeZone?: string | null;
  createdAt?: string;
  updatedAt?: string;
  babies: LegacyBaby[];
}

export interface RegisterSessionInput {
  username: string;
  password: string;
  displayName: string;
  inviteCode?: string;
  relation?: string;
}

export interface RegisterSessionResult {
  success: boolean;
  sessionSecret?: string;
  user?: WebSession["user"];
  family?: LegacyFamily | null;
  baby?: LegacyBaby | null;
  families?: LegacyFamily[];
  babies?: LegacyBaby[];
  error?: string;
  status?: number;
}

export interface EndpointDependencies {
  fetchApi: BridgeFetch;
  resolveSession: (request: Request) => Promise<WebSession | null>;
  verifyCsrf: (request: Request) => Response | null;
  registerSession?: (input: RegisterSessionInput) => Promise<RegisterSessionResult>;
  setSessionCookie?: (response: Response, sessionSecret: string) => void;
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Identity reads default to the old Web response shape. The new client opts
 * into the extended projection explicitly so an old client never starts
 * depending on additive fields by accident.
 */
async function jsonObject(request: Request): Promise<Record<string, unknown>> {
  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BridgeError(400, "INVALID_JSON", "请求正文必须是 JSON 对象");
  }
  return raw as Record<string, unknown>;
}

function legacyFamily(
  family: ApiFamily,
  babies: LegacyBaby[] = [],
  extra: Partial<LegacyFamily> = {},
): LegacyFamily {
  return {
    id: family.id,
    name: family.name,
    timeZone: family.timeZone,
    createdAt: family.createdAt,
    updatedAt: family.updatedAt,
    babies,
    ...extra,
  };
}

function legacyUser(user: WebSession["user"]): WebSession["user"] {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
  };
}

/** The old baby endpoint did not expose the canonical gestational-day field. */
function legacyBabyResponse(baby: LegacyBaby | null): Record<string, unknown> | null {
  if (!baby) return null;
  return {
    id: baby.id,
    familyId: baby.familyId,
    nickname: baby.nickname,
    birthDate: baby.birthDate,
    gender: baby.gender,
    avatarUrl: baby.avatarUrl,
    gestationalAge: baby.gestationalAge,
    createdAt: baby.createdAt,
    updatedAt: baby.updatedAt,
  };
}

/** Keep inviteCode only when a real upstream response supplied one. */
function legacyFamilyResponse(family: LegacyFamily | null): Record<string, unknown> | null {
  if (!family) return null;
  const result: Record<string, unknown> = { id: family.id, name: family.name };
  if (family.inviteCode !== undefined) result.inviteCode = family.inviteCode;
  return result;
}

function identityResponse(
  identity: Awaited<ReturnType<typeof loadWebIdentity>>,
  extended: boolean,
) {
  const families = identity.families.map(item => legacyFamily(item.family, item.babies));
  const selectedFamily = families.find(item => item.id === identity.family?.id) ?? families[0] ?? null;
  if (!extended) {
    return {
      family: legacyFamilyResponse(selectedFamily),
      baby: legacyBabyResponse(identity.baby),
    };
  }
  return {
    family: selectedFamily,
    baby: identity.baby,
    families,
    babies: identity.babies,
  };
}

const FAMILY_MEMBER_ROLES = new Set(["admin", "member", "viewer"]);

function mapMember(member: ApiFamilyMember, familyId: string, extended = true): Record<string, unknown> {
  if (
    !member ||
    typeof member !== "object" ||
    typeof member.id !== "string" ||
    typeof member.userId !== "string" ||
    member.familyId !== familyId ||
    !FAMILY_MEMBER_ROLES.has(member.role) ||
    typeof member.username !== "string" ||
    typeof member.displayName !== "string" ||
    typeof member.relation !== "string" ||
    !member.relation.trim() ||
    typeof member.joinedAt !== "string"
  ) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 成员响应无效");
  }
  if (!extended) {
    return {
      id: member.id,
      userId: member.userId,
      username: member.username,
      displayName: member.displayName,
      role: member.role,
      relation: member.relation,
      joinedAt: member.joinedAt,
    };
  }
  return {
    id: member.id,
    userId: member.userId,
    familyId: member.familyId,
    username: member.username,
    displayName: member.displayName,
    role: member.role,
    relation: member.relation,
    joinedAt: member.joinedAt,
  };
}

const BABY_MEMBER_ROLES = new Set<ApiBabyMemberRole>(["admin", "member", "viewer"]);

function mapBabyMember(member: ApiBabyMember): Record<string, unknown> {
  if (
    !member ||
    typeof member !== "object" ||
    typeof member.userId !== "string" ||
    typeof member.babyId !== "string" ||
    typeof member.familyId !== "string" ||
    typeof member.displayName !== "string" ||
    typeof member.joinedAt !== "string" ||
    !BABY_MEMBER_ROLES.has(member.role)
  ) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 宝宝成员响应无效");
  }
  return {
    userId: member.userId,
    babyId: member.babyId,
    familyId: member.familyId,
    role: member.role,
    displayName: member.displayName,
    joinedAt: member.joinedAt,
  };
}

export function createIdentityEndpoints(deps: EndpointDependencies) {
  return {
    async me(request: Request): Promise<Response> {
      try {
        const extended = wantsExtendedRepresentation(request);
        const session = await deps.resolveSession(request);
        if (!session) {
          return extended
            ? json({ user: null, family: null, baby: null, families: [], babies: [], membership: null })
            : json({ user: null, family: null, baby: null });
        }
        const identity = await loadWebIdentity(deps.fetchApi, session.accessToken);
        let membership: { role: string; relation: string } | null = null;
        if (identity.family) {
          const members = await loadFamilyMembers(deps.fetchApi, session.accessToken, identity.family);
          const current = members.find(member => member.userId === session.user.id);
          if (current) {
            const mapped = mapMember(current, identity.family.id);
            membership = {
              role: String(mapped.role),
              relation: String(mapped.relation),
            };
          }
        }
        const response = json({
          user: extended ? session.user : legacyUser(session.user),
          ...identityResponse(identity, extended),
          membership,
        });
        if (session.isNewSession && session.sessionSecret) {
          deps.setSessionCookie?.(response, session.sessionSecret);
        }
        return response;
      } catch (error) {
        return bridgeErrorResponse(error);
      }
    },

    async register(request: Request): Promise<Response> {
      try {
        if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
        const csrf = deps.verifyCsrf(request);
        if (csrf) return csrf;
        if (!deps.registerSession) throw new BridgeError(501, "REGISTER_NOT_CONFIGURED", "预览注册桥接尚未配置");
        const body = await jsonObject(request);
        if (typeof body.username !== "string" || !body.username.trim()) {
          throw new BridgeError(400, "INVALID_USERNAME", "请输入用户名");
        }
        if (typeof body.password !== "string" || body.password.length < 8) {
          throw new BridgeError(400, "INVALID_PASSWORD", "密码至少需要 8 个字符");
        }
        if (typeof body.displayName !== "undefined" && typeof body.displayName !== "string") {
          throw new BridgeError(400, "INVALID_DISPLAY_NAME", "显示名称格式错误");
        }
        const inviteCode = typeof body.inviteCode === "string" && body.inviteCode.trim()
          ? body.inviteCode.trim().toUpperCase()
          : undefined;
        const result = await deps.registerSession({
          username: body.username.trim(),
          password: body.password,
          displayName: typeof body.displayName === "string" && body.displayName.trim()
            ? body.displayName.trim()
            : body.username.trim(),
          inviteCode,
          relation: typeof body.relation === "string" ? body.relation : undefined,
        });
        if (!result.success || !result.sessionSecret || !result.user) {
          throw new BridgeError(result.status ?? 502, "REGISTER_FAILED", result.error ?? "注册失败");
        }
        const response = json({
          user: result.user,
          family: result.family ?? null,
          baby: result.baby ?? null,
          families: result.families ?? [],
          babies: result.babies ?? [],
        }, 201);
        deps.setSessionCookie?.(response, result.sessionSecret);
        return response;
      } catch (error) {
        return bridgeErrorResponse(error);
      }
    },

    async familyPreview(request: Request): Promise<Response> {
      try {
        if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
        const code = new URL(request.url).searchParams.get("code")?.trim().toUpperCase();
        if (!code || code.length < 4 || code.length > 64) {
          throw new BridgeError(400, "INVALID_INVITE_CODE", "请输入有效的邀请码");
        }
        const preview = requireData(await deps.fetchApi<{
          familyName: string;
          inviterName: string;
          expiresAt: string;
        }>(`/api/v1/families/invites/preview?code=${encodeURIComponent(code)}`));
        if (!preview || typeof preview.familyName !== "string" || typeof preview.expiresAt !== "string") {
          throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 邀请预览响应无效");
        }
        return json({
          found: true,
          family: {
            name: preview.familyName,
            inviteCode: code,
            adminName: preview.inviterName || "家庭管理员",
          },
          baby: null,
          expiresAt: preview.expiresAt,
          inviterName: preview.inviterName,
        });
      } catch (error) {
        return bridgeErrorResponse(error);
      }
    },

    async familyJoin(request: Request): Promise<Response> {
      try {
        if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
        const csrf = deps.verifyCsrf(request);
        if (csrf) return csrf;
        const session = await deps.resolveSession(request);
        if (!session) throw new BridgeError(401, "UNAUTHORIZED", "会话无效或已过期");
        const body = await jsonObject(request);
        if (typeof body.inviteCode !== "string" || !body.inviteCode.trim()) {
          throw new BridgeError(400, "INVALID_INVITE_CODE", "请输入家庭邀请码");
        }
        // The preview backend accepts only inviteCode. Relation is retained by the
        // legacy UI type for compatibility, but is not sent as an invented field.
        const inviteCode = body.inviteCode.trim().toUpperCase();
        const joined = requireData(await deps.fetchApi<{
          family: ApiFamily;
          role: string;
        }>("/api/v1/families/join", {
          method: "POST",
          accessToken: session.accessToken,
          body: { inviteCode },
        }));
        if (!joined.family?.id || typeof joined.family.name !== "string") {
          throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 加入家庭响应无效");
        }
        const identity = await loadWebIdentity(deps.fetchApi, session.accessToken);
        const target = identity.families.find(item => item.family.id === joined.family.id);
        const targetFamily = target
          ? legacyFamily(target.family, target.babies, { role: joined.role })
          : legacyFamily(joined.family, [], { role: joined.role });
        const families = identity.families.map(item => legacyFamily(item.family, item.babies));
        const baby = target?.babies[0] ?? null;
        return json({
          message: "已加入家庭。现有宝宝需要家庭成员进一步授权后才可访问。",
          family: targetFamily,
          baby,
          families,
          babies: identity.babies,
          role: joined.role,
        });
      } catch (error) {
        return bridgeErrorResponse(error);
      }
    },

    async familyMembers(request: Request): Promise<Response> {
      try {
        if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
        const extended = wantsExtendedRepresentation(request);
        const session = await deps.resolveSession(request);
        if (!session) throw new BridgeError(401, "UNAUTHORIZED", "会话无效或已过期");
        const requestedId = new URL(request.url).searchParams.get("familyId") ?? undefined;
        const family = await accessibleFamily(deps.fetchApi, session.accessToken, requestedId);
        const members = await loadFamilyMembers(deps.fetchApi, session.accessToken, family);
        return json({
          family: extended ? legacyFamily(family) : legacyFamilyResponse(legacyFamily(family)),
          members: members.map(member => mapMember(member, family.id, extended)),
        });
      } catch (error) {
        return bridgeErrorResponse(error);
      }
    },

    async familyInvite(request: Request): Promise<Response> {
      try {
        if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
        const csrf = deps.verifyCsrf(request);
        if (csrf) return csrf;
        const session = await deps.resolveSession(request);
        if (!session) throw new BridgeError(401, "UNAUTHORIZED", "会话无效或已过期");
        const body = await jsonObject(request);
        const family = await accessibleFamily(deps.fetchApi, session.accessToken, body.familyId);
        const expiresInDays = body.expiresInDays;
        if (expiresInDays !== undefined && (!Number.isInteger(expiresInDays) || Number(expiresInDays) < 1 || Number(expiresInDays) > 30)) {
          throw new BridgeError(400, "INVALID_INVITE_EXPIRY", "邀请码有效期必须为 1–30 天");
        }
        const invite = requireData(await deps.fetchApi<{ inviteCode: string; expiresAt: string }>(
          `/api/v1/families/${pathId(family.id)}/invites`,
          {
            method: "POST",
            accessToken: session.accessToken,
            body: expiresInDays === undefined ? {} : { expiresInDays },
          },
        ));
        if (!invite?.inviteCode || !invite.expiresAt) {
          throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 邀请响应无效");
        }
        return json({ familyId: family.id, inviteCode: invite.inviteCode, expiresAt: invite.expiresAt });
      } catch (error) {
        return bridgeErrorResponse(error);
      }
    },

    async babyMembers(request: Request): Promise<Response> {
      try {
        if (!["GET", "POST", "DELETE"].includes(request.method)) {
          return json({ error: "Method not allowed" }, 405);
        }

        if (request.method !== "GET") {
          const csrf = deps.verifyCsrf(request);
          if (csrf) return csrf;
        }

        const session = await deps.resolveSession(request);
        if (!session) throw new BridgeError(401, "UNAUTHORIZED", "会话无效或已过期");

        if (request.method === "GET") {
          const requestedBabyId = new URL(request.url).searchParams.get("babyId");
          // The no-scope GET is a capability probe for the legacy page. It
          // returns no member data and therefore never substitutes a baby or
          // family scope; a scoped request below still goes through the
          // canonical authorization check.
          if (!requestedBabyId) return json({ supported: true, babyId: null, members: [] });
          const babyId = pathId(requestedBabyId);
          const members = requireData(await deps.fetchApi<ApiBabyMember[]>(
            `/api/v1/babies/${babyId}/members`,
            { accessToken: session.accessToken },
          ));
          if (!Array.isArray(members)) {
            throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 宝宝成员列表格式错误");
          }
          return json({ supported: true, babyId: decodeURIComponent(babyId), members: members.map(mapBabyMember) });
        }

        const body = await jsonObject(request);
        const babyId = pathId(body.babyId);
        const userId = pathId(body.userId);

        if (request.method === "POST") {
          const role = body.role === undefined ? "member" : body.role;
          if (typeof role !== "string" || !BABY_MEMBER_ROLES.has(role as ApiBabyMemberRole)) {
            throw new BridgeError(400, "INVALID_BABY_MEMBER_ROLE", "宝宝成员角色无效");
          }
          const result = requireData(await deps.fetchApi<{ success: true }>(
            `/api/v1/babies/${babyId}/members`,
            {
              method: "POST",
              accessToken: session.accessToken,
              body: { userId: decodeURIComponent(userId), role },
            },
          ));
          return json({ babyId: decodeURIComponent(babyId), userId: decodeURIComponent(userId), ...result }, 201);
        }

        const result = requireData(await deps.fetchApi<{ removed: true }>(
          `/api/v1/babies/${babyId}/members/${userId}`,
          { method: "DELETE", accessToken: session.accessToken },
        ));
        return json({ babyId: decodeURIComponent(babyId), userId: decodeURIComponent(userId), ...result });
      } catch (error) {
        return bridgeErrorResponse(error);
      }
    },

    async baby(request: Request): Promise<Response> {
      try {
        if (!["GET", "POST", "PUT"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
        const csrf = deps.verifyCsrf(request);
        if (csrf) return csrf;
        const session = await deps.resolveSession(request);
        if (!session) throw new BridgeError(401, "UNAUTHORIZED", "会话无效或已过期");
        const accessToken = session.accessToken;
        if (request.method === "GET") {
          const baby = await loadWebBaby(deps.fetchApi, accessToken, new URL(request.url).searchParams.get("babyId"));
          return json(wantsExtendedRepresentation(request) ? baby : legacyBabyResponse(baby));
        }
        const body = await jsonObject(request);
        if (request.method === "POST") {
          const familyId = await creationFamilyId(deps.fetchApi, accessToken, body.familyId);
          const created = requireData(await deps.fetchApi<ApiBaby>(`/api/v1/families/${pathId(familyId)}/babies`, {
            method: "POST", accessToken, body: babyPayload(body),
          }));
          return json(legacyBaby(created), 201);
        }
        const requestedId = body.babyId ?? body.id;
        pathId(requestedId); // Mutations must never infer the first accessible baby.
        const existing = await loadWebBaby(deps.fetchApi, accessToken, requestedId);
        if (!existing) throw new BridgeError(404, "BABY_NOT_FOUND", "请先创建宝宝资料");
        const patch = { ...body };
        // Do not treat an unchanged legacy avatar as a new upload, or erase its reference.
        if (patch.avatarUrl === existing.avatarUrl) delete patch.avatarUrl;
        const updated = requireData(await deps.fetchApi<ApiBaby>(`/api/v1/babies/${pathId(existing.id)}`, {
          method: "PATCH", accessToken, body: babyPayload(patch, true),
        }));
        return json(legacyBaby(updated));
      } catch (error) {
        return bridgeErrorResponse(error);
      }
    },
  };
}
