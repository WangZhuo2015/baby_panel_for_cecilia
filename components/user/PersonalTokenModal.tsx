"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Key,
  Copy,
  Check,
  Trash2,
  Plus,
  X,
  Smartphone,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface TokenItem {
  id: string;
  name: string;
  maskedToken: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function PersonalTokenModal({ isOpen, onClose }: Props) {
  const { showToast } = useToast();
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tokenName, setTokenName] = useState("我的 iPhone 快捷指令");
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/user/tokens");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setTokens(data.tokens || []);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchTokens();
      setNewlyCreatedToken(null);
    }
  }, [isOpen, fetchTokens]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/user/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tokenName }),
      });
      const data = await res.json();
      if (data.success && data.token) {
        setNewlyCreatedToken(data.token.token);
        showToast("专属令牌已生成！请务必立即复制保存 ✨");
        fetchTokens();
      } else {
        showToast(data.error || "创建失败");
      }
    } catch (err: any) {
      showToast(err?.message || "网络请求失败");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("确定要撤销该令牌吗？撤销后使用此令牌的快捷指令将无法访问。")) return;
    try {
      const res = await fetch(`/api/user/tokens/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        showToast("令牌已撤销");
        fetchTokens();
      } else {
        showToast(data.error || "撤销失败");
      }
    } catch (err: any) {
      showToast(err?.message || "网络错误");
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "https://baby.zwang.fun";
  const voiceApiUrl = `${origin}/api/agent/voice`;

  const handleCopyNewToken = () => {
    if (!newlyCreatedToken) return;
    navigator.clipboard.writeText(newlyCreatedToken);
    setCopiedToken(true);
    showToast("Token 已复制到剪贴板 📋");
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const handleCopyFullConfig = () => {
    const tokenVal = newlyCreatedToken || (tokens.length > 0 ? tokens[0].maskedToken : "<YOUR_TOKEN>");
    const configText = `【iOS 快捷指令「获取 URL 内容」配置】
- URL: ${voiceApiUrl}
- 方法: POST
- 请求头 (Headers):
  Authorization: Bearer ${tokenVal}
  Content-Type: application/json
- 请求体 (Request Body / JSON):
  {"text": "快捷指令听写文本"}`;

    navigator.clipboard.writeText(configText);
    setCopiedConfig(true);
    showToast("完整配置参数已复制，可直接参考粘贴 📋");
    setTimeout(() => setCopiedConfig(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        className="relative w-full max-w-lg max-h-[90vh] bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-primary/20 flex flex-col overflow-hidden animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/15 via-lavender/20 to-pink-500/10 border-b border-primary/10 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full text-text-muted hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            aria-label="关闭"
          >
            <X size={18} />
          </button>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-indigo-600 text-white flex items-center justify-center shadow-md shadow-primary/25">
              <Key size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-text-primary">
                个人专属 Siri / 快捷指令 Token
              </h3>
              <p className="text-xs text-text-secondary mt-0.5">
                与家庭解耦 · 专属于您的个人设备身份凭证
              </p>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-sm">
          {/* Notice banner */}
          <div className="p-3.5 rounded-2xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/50 flex gap-2.5 text-xs text-sky-800 dark:text-sky-300">
            <ShieldCheck size={16} className="shrink-0 text-sky-500 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">独占式个人身份</p>
              <p className="leading-relaxed">
                每个家庭成员均可生成自己的专属 Token 配置在自己的 iPhone 或 HomePod 上。Siri 收到指令后会自动识别具体是哪位家长在记录，告别服务器全局配置。
              </p>
            </div>
          </div>

          {/* Newly created token display */}
          {newlyCreatedToken && (
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-600 space-y-2.5 animate-scale-up">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-800 dark:text-amber-300 text-xs flex items-center gap-1">
                  <AlertCircle size={14} />
                  已生成新 Token（仅显示一次，请立即复制）
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-800 font-mono text-xs text-text-primary break-all select-all border border-amber-200 dark:border-amber-800">
                {newlyCreatedToken}
              </div>
              <button
                type="button"
                onClick={handleCopyNewToken}
                className="w-full py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
              >
                {copiedToken ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedToken ? "已复制到剪贴板" : "复制此 Token"}</span>
              </button>
            </div>
          )}

          {/* Active tokens list */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-text-primary text-xs">已绑定的设备令牌</span>
              <button
                type="button"
                onClick={fetchTokens}
                className="text-text-muted hover:text-text-secondary text-xs flex items-center gap-1"
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                刷新
              </button>
            </div>

            {tokens.length === 0 && !loading && (
              <div className="p-4 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-700 text-center text-text-muted text-xs">
                暂无令牌，点击下方按钮为您的手机生成一个吧
              </div>
            )}

            {tokens.map((token) => (
              <div
                key={token.id}
                className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/70 dark:border-zinc-700/60 flex items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-text-primary text-xs truncate">
                      {token.name}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-text-muted mt-0.5">
                    {token.maskedToken}
                  </p>
                  <p className="text-[10px] text-text-muted mt-1">
                    创建于 {new Date(token.createdAt).toLocaleDateString()}
                    {token.lastUsedAt && ` · 最近使用: ${new Date(token.lastUsedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleRevoke(token.id)}
                  className="p-2 rounded-xl text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                  title="撤销此令牌"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}

            {/* Create new token button / input */}
            <div className="pt-1 flex gap-2">
              <input
                type="text"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="例如：我的 iPhone 16"
                className="flex-1 px-3.5 py-2.5 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-dark text-white font-bold text-xs flex items-center gap-1.5 shadow-button disabled:opacity-50 transition-all cursor-pointer shrink-0"
              >
                <Plus size={14} />
                <span>{creating ? "生成中..." : "生成令牌"}</span>
              </button>
            </div>
          </div>

          {/* Quick instructions & Copy Config */}
          <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/70 dark:border-zinc-700/60 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-text-primary text-xs flex items-center gap-1.5">
                <Smartphone size={14} className="text-primary" />
                iOS 快捷指令配置参考
              </span>
              <button
                type="button"
                onClick={handleCopyFullConfig}
                className="text-primary hover:text-primary-dark font-medium text-xs flex items-center gap-1 cursor-pointer"
              >
                {copiedConfig ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedConfig ? "已复制配置" : "一键复制配置"}</span>
              </button>
            </div>

            <div className="space-y-1.5 text-[11px] text-text-secondary font-mono bg-white dark:bg-zinc-900 p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 select-all overflow-x-auto">
              <div><span className="text-text-muted">URL:</span> {voiceApiUrl}</div>
              <div><span className="text-text-muted">Method:</span> POST</div>
              <div><span className="text-text-muted">Header:</span> Authorization: Bearer &lt;你的Token&gt;</div>
              <div><span className="text-text-muted">Body:</span> &#123;&quot;text&quot;: &quot;快捷指令听写文本&quot;&#125;</div>
            </div>

            <ol className="text-xs text-text-muted space-y-1 list-decimal list-inside pl-0.5">
              <li>在 iPhone 打开「快捷指令」，新建指令并添加「听写文本」动作；</li>
              <li>添加「获取 URL 内容」动作，粘贴上述 URL、Header 与 Body；</li>
              <li>最后添加「朗读文本」动作（朗读获取到的 reply），即可对 Siri 喊出指令！</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
