"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ShieldCheck, UserCheck, Baby as BabyIcon, Lock, AlertCircle, ArrowRight, X } from "lucide-react";

function AuthorizeForm() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [authData, setAuthData] = useState<{
    authenticated: boolean;
    user?: { id: string; username: string; displayName: string };
    babies?: Array<{ id: string; nickname: string; gender: string; birthDate: string; familyName: string }>;
    client?: { clientId: string; clientName: string };
    params?: any;
  } | null>(null);

  // Form states
  const [selectedBabyId, setSelectedBabyId] = useState<string>("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const clientId = searchParams.get("client_id") || "";
  const redirectUri = searchParams.get("redirect_uri") || "";
  const scope = searchParams.get("scope") || "baby:read baby:write";
  const state = searchParams.get("state") || "";
  const codeChallenge = searchParams.get("code_challenge") || "";
  const codeChallengeMethod = searchParams.get("code_challenge_method") || "S256";
  const resource = searchParams.get("resource") || "";

  useEffect(() => {
    async function loadAuth() {
      try {
        setLoading(true);
        const res = await fetch(`/api/oauth/authorize?${searchParams.toString()}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error_description || data.error || "授权请求无效");
          return;
        }
        setAuthData(data);
        if (data.babies && data.babies.length > 0) {
          setSelectedBabyId(data.babies[0].id);
        }
      } catch (err: any) {
        setError(err.message || "加载授权信息失败");
      } finally {
        setLoading(false);
      }
    }
    loadAuth();
  }, [searchParams]);

  const handleDecision = async (decision: "allow" | "deny") => {
    setSubmitting(true);
    setError(null);
    try {
      const payload: any = {
        clientId,
        redirectUri,
        scope,
        state,
        codeChallenge,
        codeChallengeMethod,
        resource,
        babyId: selectedBabyId,
        decision,
      };

      if (!authData?.authenticated) {
        if (!username || !password) {
          setError("请输入用户名和密码以完成授权");
          setSubmitting(false);
          return;
        }
        payload.username = username;
        payload.password = password;
      }

      const res = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error_description || data.error || "授权失败");
        setSubmitting(false);
        return;
      }

      if (data.redirect_url) {
        window.location.href = data.redirect_url;
      }
    } catch (err: any) {
      setError(err.message || "提交授权失败");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-4 bg-slate-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-rose-500" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-4 bg-slate-50 text-slate-800">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-rose-500 to-pink-500 p-6 text-white text-center">
          <div className="inline-flex p-3 bg-white/20 rounded-2xl backdrop-blur-sm mb-3">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold">授权连接应用</h1>
          <p className="text-rose-100 text-xs mt-1">Baby Panel 安全 OAuth 2.1 授权中枢</p>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Client Application Info */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">请求连接的应用</span>
              <div className="font-semibold text-slate-800 text-base">
                {authData?.client?.clientName || clientId}
              </div>
            </div>
            <div className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs rounded-full font-medium">
              {authData?.client?.clientName ? `${authData.client.clientName} / MCP` : "MCP 智能体"}
            </div>
          </div>

          {/* User Status or Login Form */}
          {authData?.authenticated ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-emerald-50/60 border border-emerald-100 rounded-xl text-sm text-slate-700">
                <UserCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                <div>
                  <span className="text-xs text-slate-400 block">当前登录家长</span>
                  <span className="font-medium text-slate-800">
                    {authData.user?.displayName || authData.user?.username}
                  </span>
                </div>
              </div>

              {/* Baby Selection */}
              {authData.babies && authData.babies.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1.5">
                    <BabyIcon className="w-4 h-4 text-rose-500" />
                    选择授权访问的宝宝档案:
                  </label>
                  <select
                    value={selectedBabyId}
                    onChange={(e) => setSelectedBabyId(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  >
                    {authData.babies.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nickname} ({b.gender === "male" ? "男宝" : "女宝"} · {b.birthDate}) - {b.familyName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-rose-500" />
                请登录您的 Baby Panel 家长账号:
              </div>
              <input
                type="text"
                placeholder="用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
              <input
                type="password"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>
          )}

          {/* Requested Scopes & Permissions */}
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-2">该应用将获得以下权限:</div>
            <div className="space-y-2">
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex items-start gap-2.5 text-xs text-slate-600">
                <div className="w-2 h-2 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                <div>
                  <span className="font-semibold text-slate-800">读取日常与健康数据 (baby:read)</span>
                  <p className="text-slate-500 mt-0.5">查看宝宝档案、喂养统计、睡眠作息、换尿布记录、生长曲线与疫苗计划。</p>
                </div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex items-start gap-2.5 text-xs text-slate-600">
                <div className="w-2 h-2 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                <div>
                  <span className="font-semibold text-slate-800">打卡与数据录入 (baby:write)</span>
                  <p className="text-slate-500 mt-0.5">代表您记录喂奶、睡眠、排便、辅食餐点、补剂打卡及体检报告。</p>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleDecision("deny")}
              className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <X className="w-4 h-4" />
              拒绝
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleDecision("allow")}
              className="flex-1 px-4 py-2.5 bg-gradient-to-r from-rose-500 to-pink-500 text-white rounded-xl text-sm font-semibold shadow-md shadow-rose-500/20 hover:opacity-95 transition-opacity flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {submitting ? "正在授权..." : "允许授权"}
              {!submitting && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>

          <div className="text-center">
            <p className="text-[11px] text-slate-400">
              数据受端到端权限保护，绝不跨家庭共享。随时可在应用设置中取消授权。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center p-4 bg-slate-50">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-rose-500" />
        </div>
      }
    >
      <AuthorizeForm />
    </Suspense>
  );
}
