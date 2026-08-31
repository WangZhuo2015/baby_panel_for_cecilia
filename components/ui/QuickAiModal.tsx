"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  X,
  Send,
  Sparkles,
  Copy,
  Check,
  Baby,
  Bot,
  AlertCircle,
  Mic,
  Image as ImageIcon,
  Loader2,
  Wrench,
  Globe,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  History,
  MessageSquare,
  Plus,
  Trash2,
  Clock,
  ChevronLeft,
} from "lucide-react";
import { useBabyStore } from "@/stores/useBabyStore";
import { calculateAge } from "@/lib/age";
import { AiActionCard, ActionCardData } from "@/components/ui/AiActionCard";
import { useToast } from "@/components/ui/Toast";

export type AiContextType =
  | "food"
  | "growth"
  | "development"
  | "vaccine"
  | "medical"
  | "sleep"
  | "feeding"
  | "diaper"
  | "general";

interface QuickAiModalProps {
  isOpen: boolean;
  onClose: () => void;
  contextType: AiContextType;
  contextTitle?: string;
  contextDetail?: string | object;
  initialPrompt?: string;
}

interface ToolTrace {
  name: string;
  label?: string;
  status: "start" | "end";
  isError?: boolean;
  summary?: string;
  details?: any;
}

export interface SessionSummary {
  id: string;
  title: string;
  contextType: string;
  babyId?: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage?: {
    id: string;
    role: string;
    content: string;
    createdAt: string;
  } | null;
}

interface SearchEvidenceItem {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

function WebSearchCitationCard({ results }: { results: SearchEvidenceItem[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!results || results.length === 0) return null;

  const displayResults = expanded ? results : results.slice(0, 2);

  return (
    <div className="my-2 rounded-2xl bg-gradient-to-br from-blue-50/80 via-indigo-50/40 to-sky-50/30 border border-blue-200/70 p-2.5 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-bold text-blue-900 text-xs">
          <Globe size={13} className="text-blue-600 animate-pulse" />
          <span>权威联网佐证与引用来源（{results.length} 篇）</span>
        </div>
        {results.length > 2 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] font-medium text-blue-600 hover:text-blue-800 flex items-center gap-0.5 cursor-pointer"
          >
            <span>{expanded ? "收起" : `查看更多 (${results.length - 2})`}</span>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        {displayResults.map((r, i) => {
          let domain = "";
          try {
            domain = new URL(r.url).hostname.replace(/^www\./, "");
          } catch {}

          const rawUrl = r.url || "";
          const safeUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

          return (
            <a
              key={i}
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-2 rounded-xl bg-white/90 hover:bg-white border border-blue-100/80 shadow-2xs transition-all hover:border-blue-300 hover:shadow-xs group"
            >
              <div className="flex items-start justify-between gap-1.5">
                <span className="font-semibold text-text-primary text-[11px] group-hover:text-blue-600 line-clamp-1 flex items-center gap-1">
                  <span>{r.title || "参考资料"}</span>
                  <ExternalLink size={10} className="text-text-muted shrink-0 group-hover:text-blue-500" />
                </span>
                {domain && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100/70 text-blue-800 shrink-0 font-medium">
                    {domain}
                  </span>
                )}
              </div>
              {r.snippet && (
                <p className="text-[10px] text-text-secondary mt-1 line-clamp-2 leading-relaxed">
                  {r.snippet}
                </p>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string;
  timestamp: string;
  isStreaming?: boolean;
  tools?: ToolTrace[];
}

const CONTEXT_META: Record<
  AiContextType,
  { title: string; emoji: string; chips: string[]; placeholder: string }
> = {
  medical: {
    title: "化验单与体检智能解读",
    emoji: "📑",
    chips: [
      "📷 拍照识别血常规/体检单入库",
      "如何看懂血常规白细胞与CRP指标？",
      "微量元素缺铁缺锌怎么科学食补或药补？",
      "出现哪些紧急症状需要立刻去医院急诊？",
    ],
    placeholder: "上传化验单/体检单照片，或输入任何医学疑问...",
  },
  food: {
    title: "辅食与营养顾问",
    emoji: "🥑",
    chips: [
      "当前月龄可以吃什么新食材？怎么做？",
      "宝宝辅食过敏排查与排便异常怎么办？",
      "根据月龄规划今天的辅食营养搭配",
      "宝宝不肯吃辅食、挑食怎么引导？",
    ],
    placeholder: "输入关于辅食制作、食材引入、过敏排查等问题...",
  },
  growth: {
    title: "生长曲线与发育解读",
    emoji: "📈",
    chips: [
      "如何解读宝宝目前的体重和身长百分位？",
      "体重或身长增长偏缓，需要怎么改善？",
      "追赶生长期的科学营养搭配建议",
      "头围生长偏大或偏小怎么看？",
    ],
    placeholder: "输入关于生长曲线、体重身长评估等问题...",
  },
  development: {
    title: "发育里程碑与早教顾问",
    emoji: "🎯",
    chips: [
      "当前月龄大运动落后该如何在家训练？",
      "适合当前月龄的亲子互动益智小游戏",
      "有哪些需要警惕的发育红旗信号？",
      "如何锻炼宝宝的精细动作与语言能力？",
    ],
    placeholder: "输入关于大运动训练、语言发育、早教互动等问题...",
  },
  vaccine: {
    title: "疫苗接种与健康问答",
    emoji: "💉",
    chips: [
      "二类自费疫苗（如13价/轮状等）推荐打哪些？",
      "接种疫苗后发烧、接种处红肿硬结如何护理？",
      "宝宝轻微感冒咳嗽能如期接种疫苗吗？",
      "疫苗推迟接种会有什么不良影响吗？",
    ],
    placeholder: "输入关于疫苗规划、禁忌、接种后反应等问题...",
  },
  feeding: {
    title: "喂养与胀气排嗝顾问",
    emoji: "🍼",
    chips: [
      "防吐奶防溢奶的喂养姿势与拍嗝技巧",
      "宝宝肠胀气、扭动哭闹的排气操手法",
      "当前月龄每日科学奶量标准是多少？",
      "如何温和减少夜奶次数？",
    ],
    placeholder: "输入关于吃奶、吐奶、拍嗝、肠胀气等问题...",
  },
  sleep: {
    title: "睡眠与作息顾问",
    emoji: "😴",
    chips: [
      "宝宝接觉困难、白天短睡半小时怎么破？",
      "落地醒、必须抱睡奶睡怎么温和改善？",
      "当前月龄合理的清醒间隔与作息时间表",
      "并觉期与闹觉期作息如何平稳过渡？",
    ],
    placeholder: "输入关于接觉、落地醒、作息规律等问题...",
  },
  diaper: {
    title: "排便与臀部护理顾问",
    emoji: "🍑",
    chips: [
      "大便有奶瓣/发绿/粘液/水样便正常吗？",
      "红屁屁（尿布疹）的正确清洁与护理步骤",
      "每天尿布湿几片算摄入充足？",
      "宝宝几天不拉大便算便秘吗？",
    ],
    placeholder: "输入关于大便颜色质地、红屁屁护理等问题...",
  },
  general: {
    title: "AI 智能育儿顾问",
    emoji: "✨",
    chips: [
      "今天这个月龄最需要注意什么？",
      "宝宝体温多少度算发烧？怎么物理降温？",
      "如何建立规律舒适的每日生活作息？",
    ],
    placeholder: "随时提问、发照片或自然语言记录日常...",
  },
};

/**
 * Parses out ```json:action ... ``` or ```action ... ``` blocks from assistant messages
 */
function extractActionsAndCleanMarkdown(content: string): { cleanText: string; actions: ActionCardData[] } {
  const closedRegex = /```(?:json:action|action)\s*([\s\S]*?)\s*```/g;
  const actions: ActionCardData[] = [];
  let cleanText = content;

  // 收集全部闭合块：一句话多事件 → 多张待确认卡片
  const matches = [...content.matchAll(closedRegex)];
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (actions.length < 6) actions.push(parsed);
    } catch {
      // 单块解析失败不影响其余
    }
  }
  if (matches.length > 0) {
    cleanText = content.replace(closedRegex, "").trim();
    return { cleanText, actions };
  }

  // Strip unclosed streaming action block from visible markdown
  const unclosedRegex = /```(?:json:action|action)[\s\S]*$/;
  if (unclosedRegex.test(content)) {
    return { cleanText: content.replace(unclosedRegex, "").trim(), actions: [] };
  }

  return { cleanText: content, actions: [] };
}

export const QuickAiModal: React.FC<QuickAiModalProps> = ({
  isOpen,
  onClose,
  contextType,
  contextTitle,
  contextDetail,
  initialPrompt,
}) => {
  const baby = useBabyStore((s) => s.baby);
  const age = baby ? calculateAge(baby.birthDate) : { months: 0, days: 0, label: "0月0天" };

  const meta = CONTEXT_META[contextType] || CONTEXT_META.general;
  const displayTitle = contextTitle || meta.title;

  const [messages, setMessages] = useState<Message[]>([]);
  const { showToast } = useToast();

  // ===== iOS 键盘适配：visualViewport 收缩时把输入条上移，避免露出下层内容 =====
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // 布局视口高度 - 可视视口高度 - 顶部偏移 ≈ 键盘占据的高度
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset > 120 ? inset : 0); // 小于阈值视作收起
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  const [inputText, setInputText] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ===== 会话与历史持久化状态 =====
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = sessionId;

  const [showHistory, setShowHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"all" | "current">("current");
  const [sessionList, setSessionList] = useState<SessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (baby?.id) query.set("babyId", baby.id);
      const res = await fetch(`/api/ai/sessions?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSessionList(data.sessions || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingSessions(false);
    }
  }, [baby?.id]);

  const loadSessionDetail = async (targetId: string) => {
    const summary = sessionList.find((session) => session.id === targetId);
    if (
      summary &&
      (summary.babyId !== (baby?.id ?? null) || summary.contextType !== contextType)
    ) {
      showToast("请切换到该宝宝和对应领域后再打开这条历史对话");
      return;
    }
    try {
      const query = new URLSearchParams();
      if (baby?.id) query.set("babyId", baby.id);
      query.set("contextType", contextType);
      const res = await fetch(`/api/ai/sessions/${targetId}?${query.toString()}`);
      if (!res.ok) throw new Error("加载历史对话失败");
      const data = await res.json();
      const s = data.session;
      setSessionId(s.id);
      setSessionTitle(s.title);
      if (s.messages && s.messages.length > 0) {
        setMessages(
          s.messages.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            image: m.image || undefined,
            timestamp: new Date(m.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
            tools: Array.isArray(m.tools) ? m.tools : [],
          }))
        );
      }
      setShowHistory(false);
    } catch (err: any) {
      showToast(err?.message || "加载历史对话失败");
    }
  };

  const startNewSession = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setSessionId(null);
    setSessionTitle(null);
    const welcome: Message = {
      id: "welcome",
      role: "assistant",
      content: `你好！我是针对 **${baby?.nickname || "宝宝"}**（${age.label}）的专属 **${displayTitle}** ✨\n\n你可以点击上方的热门问题、拍照上传单据，或直接输入任何你想了解的育儿疑问：`,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages([welcome]);
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 150);
  };

  const handleDeleteSession = async (e: React.MouseEvent, targetId: string) => {
    e.stopPropagation();
    if (!window.confirm("确定删除这条历史对话记录吗？")) return;
    try {
      const res = await fetch(`/api/ai/sessions/${targetId}`, { method: "DELETE" });
      if (res.ok) {
        setSessionList((prev) => prev.filter((s) => s.id !== targetId));
        showToast("已删除历史对话");
        if (sessionId === targetId) {
          startNewSession();
        }
      }
    } catch {
      showToast("删除失败，请重试");
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  const inputTextRef = useRef(inputText);
  inputTextRef.current = inputText;
  const selectedImageRef = useRef(selectedImage);
  selectedImageRef.current = selectedImage;

  // ===== 语音输入（服务端中文 ASR）=====
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopRecording = React.useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === "recording") mr.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        setTranscribing(true);
        try {
          const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
          if (blob.size < 800) throw new Error("录音太短");
          const fd = new FormData();
          fd.append("audio", blob, `voice${mime.includes("mp4") ? ".m4a" : ".webm"}`);
          const res = await fetch("/api/asr/transcribe", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || "识别失败");
          showToast(`已识别：${String(data.text).slice(0, 30)}${data.text.length > 30 ? "…" : ""}`);
          // 语音模式：识别即发送，直接在对话里出结果卡片
          handleSend(String(data.text));
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : "语音识别失败");
        } finally {
          setTranscribing(false);
        }
      };
      mr.start(250);
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {
      showToast("无法访问麦克风，请检查权限");
    }
  };
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSend = useCallback(
    async (textToSend?: string) => {
      const query = (textToSend || inputTextRef.current).trim();
      const currentImg = selectedImageRef.current;
      if ((!query && !currentImg) || loadingRef.current) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const userMsg: Message = {
        id: `user_${Date.now()}`,
        role: "user",
        content: query || (currentImg ? "请帮我结构化识别这张单据并提供儿科解读" : ""),
        image: currentImg || undefined,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      const aiMsgId = `ai_${Date.now()}`;
      const initialAiMsg: Message = {
        id: aiMsgId,
        role: "assistant",
        content: "",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, initialAiMsg]);
      setInputText("");
      setSelectedImage(null);
      setLoading(true);

      try {
        const history = messagesRef.current
          .filter((m) => m.id !== "welcome")
          .map((m) => ({ role: m.role, content: m.content }));

        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            messages: [
              ...history,
              {
                role: "user",
                content: query || "请帮我结构化识别这张单据并提供儿科解读",
              },
            ],
            contextType,
            contextDetail,
            babyId: baby?.id,
            image: currentImg,
            sessionId: sessionIdRef.current || undefined,
          }),
        });

        if (!res.body) {
          throw new Error("No response stream");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;

            if (trimmed === "data: [DONE]") {
              break;
            }

            if (trimmed.startsWith("data: ")) {
              try {
                const data = JSON.parse(trimmed.slice(6));
                if (data.session && typeof data.session.id === "string") {
                  setSessionId(data.session.id);
                  sessionIdRef.current = data.session.id;
                  setSessionTitle(data.session.title);
                }
                if (data.text) {
                  accumulatedText += data.text;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === aiMsgId
                        ? { ...msg, content: accumulatedText, isStreaming: true }
                        : msg
                    )
                  );
                }
                if (data.tool && typeof data.tool.name === "string") {
                  const incoming = data.tool as ToolTrace;
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id !== aiMsgId) return msg;
                      const tools = [...(msg.tools || [])];
                      const idx = tools.findIndex(
                        (t) => t.name === incoming.name && t.status === "start"
                      );
                      if (incoming.status === "end" && idx >= 0) {
                        tools[idx] = { ...tools[idx], ...incoming };
                      } else {
                        tools.push(incoming);
                      }
                      return { ...msg, tools, isStreaming: true };
                    })
                  );
                }
              } catch {
                // Partial JSON, ignore
              }
            }
          }
        }

        // Mark streaming finished
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === aiMsgId
              ? {
                  ...msg,
                  content: accumulatedText || "未能获取有效回复，请重试。",
                  isStreaming: false,
                }
              : msg
          )
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === aiMsgId ? { ...msg, isStreaming: false } : msg
            )
          );
          return;
        }
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === aiMsgId
              ? {
                  ...msg,
                  content: "网络连接暂时超时，请稍后重新提问。若宝宝身体有明显不适，请以专业医生诊断为准。",
                  isStreaming: false,
                }
              : msg
          )
        );
      } finally {
        setLoading(false);
        useBabyStore.getState().refreshAll().catch(() => {});
      }
    },
    [contextType, contextDetail, baby?.id]
  );

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const prevScopeRef = useRef<{ contextType: string; babyId: string | null }>({
    contextType,
    babyId: baby?.id ?? null,
  });

  useEffect(() => {
    if (isOpen) {
      const previousScope = prevScopeRef.current;
      const isScopeChanged =
        previousScope.contextType !== contextType ||
        previousScope.babyId !== (baby?.id ?? null);
      prevScopeRef.current = {
        contextType,
        babyId: baby?.id ?? null,
      };

      if (isScopeChanged) {
        setSessionId(null);
        sessionIdRef.current = null;
        setSessionTitle(null);
        setSelectedImage(null);
      }

      fetchSessions();

      if (messages.length === 0 || isScopeChanged) {
        // Welcome message
        const welcome: Message = {
          id: "welcome",
          role: "assistant",
          content: `你好！我是针对 **${baby?.nickname || "宝宝"}**（${age.label}）的专属 **${displayTitle}** ✨\n\n你可以点击上方的热门问题、拍照上传单据，或直接输入任何你想了解的育儿疑问：`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages([welcome]);

        if (initialPrompt) {
          handleSend(initialPrompt);
        }
      }
      setTimeout(() => inputRef.current?.focus(), 150);
    } else {
      // Trigger store refresh when closed
      useBabyStore.getState().refreshAll().catch(() => {});
    }
  }, [isOpen, contextType, initialPrompt, displayTitle, baby?.id, baby?.nickname, age.label, messages.length, handleSend, fetchSessions]);

  useEffect(() => {
    if (!isOpen && abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, loading, isOpen]);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      alert("单据照片大小不能超过 8MB，请压缩后重试");
      return;
    }

    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/medical/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "上传图片失败");
      }
      const data = await res.json();
      setSelectedImage(data.imageUrl);
    } catch (err: any) {
      alert(err?.message || "单据图片上传失败，请重新选择或拍照");
      setSelectedImage(null);
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };


  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-ai-title"
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
    >
      {/* Backdrop with soft blur */}
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Sheet / Modal Container - Full screen on mobile, elegant dual-pane dialog on iPad/desktop */}
      <div className="relative w-full max-w-full sm:max-w-4xl lg:max-w-5xl bg-card h-full sm:h-[720px] lg:h-[760px] max-h-full sm:max-h-[92vh] rounded-none sm:rounded-[28px] shadow-2xl overflow-hidden flex flex-row border-0 sm:border sm:border-primary/15 animate-in slide-in-from-bottom-6 duration-200 z-10">
        
        {/* ===== 左侧常驻历史会话边栏 (md / lg 视口常驻) ===== */}
        <div className="w-72 border-r border-primary/10 hidden md:flex flex-col bg-white/50 dark:bg-card/50 shrink-0 select-none">
          {/* 边栏 Header */}
          <div className="flex items-center justify-between px-3.5 py-3 pt-[max(12px,env(safe-area-inset-top))] bg-white/90 dark:bg-card/90 backdrop-blur-md border-b border-primary/10 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-primary-soft/50 text-primary flex items-center justify-center">
                <History size={15} />
              </div>
              <span className="font-bold text-xs sm:text-sm text-text-primary">历史对话</span>
            </div>
            <button
              type="button"
              onClick={startNewSession}
              className="px-2.5 py-1 rounded-xl bg-gradient-to-r from-primary to-pink-500 text-white text-xs font-bold shadow-xs hover:opacity-95 flex items-center gap-1 cursor-pointer transition-all active:scale-95"
              title="新建会话"
            >
              <Plus size={13} />
              <span>新对话</span>
            </button>
          </div>

          {/* 边栏过滤 Chips */}
          <div className="px-3 py-2 bg-white/40 dark:bg-card/40 border-b border-primary/10 flex gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setHistoryFilter("all")}
              className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-all cursor-pointer ${
                historyFilter === "all"
                  ? "bg-primary text-white shadow-xs"
                  : "bg-card text-text-secondary border border-primary/15 hover:bg-primary-light/40"
              }`}
            >
              全部 ({sessionList.length})
            </button>
            <button
              type="button"
              onClick={() => setHistoryFilter("current")}
              className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-all cursor-pointer ${
                historyFilter === "current"
                  ? "bg-primary text-white shadow-xs"
                  : "bg-card text-text-secondary border border-primary/15 hover:bg-primary-light/40"
              }`}
            >
              当前领域 ({sessionList.filter((s) => s.contextType === contextType).length})
            </button>
          </div>

          {/* 滚动会话列表 */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2 scrollbar-thin">
            {loadingSessions ? (
              <div className="flex flex-col items-center justify-center py-12 text-text-muted gap-2">
                <Loader2 size={20} className="animate-spin text-primary" />
                <span className="text-[11px]">加载历史中...</span>
              </div>
            ) : sessionList.filter((s) => (historyFilter === "current" ? s.contextType === contextType : true)).length === 0 ? (
              <div className="text-center py-12 space-y-1.5">
                <p className="text-2xl">💬</p>
                <p className="text-[11px] text-text-muted">暂无历史对话记录</p>
                <button
                  type="button"
                  onClick={startNewSession}
                  className="text-xs text-primary font-bold hover:underline cursor-pointer"
                >
                  开启新对话
                </button>
              </div>
            ) : (
              sessionList
                .filter((s) => (historyFilter === "current" ? s.contextType === contextType : true))
                .map((s) => {
                  const sMeta = CONTEXT_META[s.contextType as AiContextType] || CONTEXT_META.general;
                  const isCurrentActive = s.id === sessionId;

                  return (
                    <div
                      key={s.id}
                      onClick={() => loadSessionDetail(s.id)}
                      className={`p-2.5 rounded-2xl border transition-all cursor-pointer group flex items-start justify-between gap-2 ${
                        isCurrentActive
                          ? "bg-primary-light/50 dark:bg-primary-950/40 border-primary shadow-xs ring-1 ring-primary/20"
                          : "bg-card hover:bg-white dark:hover:bg-white/5 border-primary/10 hover:border-primary/30 shadow-2xs"
                      }`}
                    >
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <div className="w-7 h-7 rounded-xl bg-primary-soft/50 text-sm flex items-center justify-center shrink-0 mt-0.5">
                          {sMeta.emoji}
                        </div>
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1">
                            <h4 className="font-bold text-xs text-text-primary truncate group-hover:text-primary transition-colors">
                              {s.title}
                            </h4>
                            {isCurrentActive && (
                              <span className="text-[8px] px-1 py-0.2 rounded bg-primary text-white font-bold shrink-0">
                                当前
                              </span>
                            )}
                          </div>
                          {s.lastMessage && (
                            <p className="text-[10px] text-text-muted truncate">
                              {s.lastMessage.role === "user" ? "问：" : "AI："}{s.lastMessage.content}
                            </p>
                          )}
                          <div className="flex items-center gap-1 text-[9px] text-text-muted pt-0.5">
                            <Clock size={9} />
                            <span>{new Date(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            <span>·</span>
                            <span>{s.messageCount} 条</span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(e, s.id)}
                        className="p-1 text-text-muted hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                        title="删除会话"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })
            )}
          </div>
        </div>

        {/* ===== 右侧主对话与工具链展示区域 ===== */}
        <div className="flex-1 flex flex-col min-w-0 h-full relative">
          {/* Header - Frosted pastel navbar with notch safe area */}
          <div className="flex items-center justify-between px-4 py-3 pt-[max(12px,env(safe-area-inset-top))] bg-white/95 backdrop-blur-md border-b border-primary/10 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-primary to-pink-500 text-white flex items-center justify-center text-lg shadow-sm shadow-primary/25 shrink-0">
                {meta.emoji}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h3 id="quick-ai-title" className="font-bold text-text-primary text-sm sm:text-base truncate">
                    {sessionTitle || displayTitle}
                  </h3>
                </div>
                <p className="text-[11px] text-text-muted flex items-center gap-1 mt-0.5 truncate">
                  <span className="font-medium text-text-secondary">{baby?.nickname || "宝宝"}</span>
                  <span>·</span>
                  <span>{age.label}</span>
                  {sessionTitle && (
                    <>
                      <span>·</span>
                      <span className="text-primary font-medium">{meta.title}</span>
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* 移动端历史记录抽屉触发按钮 */}
              <button
                type="button"
                onClick={() => {
                  setShowHistory(true);
                  fetchSessions();
                }}
                className="md:hidden w-8 h-8 rounded-full bg-primary-soft/40 hover:bg-primary-soft text-text-muted hover:text-primary flex items-center justify-center transition-colors cursor-pointer"
                title="历史对话记录"
                aria-label="历史对话记录"
              >
                <History size={16} />
              </button>
              <button
                type="button"
                onClick={startNewSession}
                className="w-8 h-8 rounded-full bg-primary-soft/40 hover:bg-primary-soft text-text-muted hover:text-primary flex items-center justify-center transition-colors cursor-pointer"
                title="新建对话"
                aria-label="新建对话"
              >
                <Plus size={16} />
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-primary-soft/40 hover:bg-primary-soft text-text-muted hover:text-text-primary flex items-center justify-center transition-colors cursor-pointer"
                title="关闭"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* 移动端历史抽屉浮层 (md 屏幕以上隐藏) */}
          {showHistory && (
            <div className="absolute inset-0 bg-card z-30 flex flex-col md:hidden animate-in fade-in slide-in-from-right-4 duration-200">
              {/* History Header */}
              <div className="flex items-center justify-between px-4 py-3 pt-[max(12px,env(safe-area-inset-top))] bg-white/95 backdrop-blur-md border-b border-primary/10 shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowHistory(false)}
                    className="w-8 h-8 rounded-full bg-primary-soft/40 hover:bg-primary-soft text-text-muted hover:text-text-primary flex items-center justify-center transition-colors cursor-pointer"
                    title="返回当前对话"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div>
                    <h3 className="font-bold text-text-primary text-sm sm:text-base">历史对话记录</h3>
                    <p className="text-[11px] text-text-muted">按主题回溯与随时续聊</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={startNewSession}
                  className="px-3 py-1.5 rounded-full bg-gradient-to-r from-primary to-pink-500 text-white text-xs font-bold shadow-xs hover:opacity-95 flex items-center gap-1 cursor-pointer"
                >
                  <Plus size={14} />
                  <span>新对话</span>
                </button>
              </div>

              {/* Filter Chips */}
              <div className="px-3.5 py-2 bg-white/60 border-b border-primary/10 flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setHistoryFilter("all")}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition-all ${
                    historyFilter === "all"
                      ? "bg-primary text-white shadow-xs"
                      : "bg-card text-text-secondary border border-primary/15 hover:bg-primary-light/40"
                  }`}
                >
                  全部历史 ({sessionList.length})
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryFilter("current")}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition-all ${
                    historyFilter === "current"
                      ? "bg-primary text-white shadow-xs"
                      : "bg-card text-text-secondary border border-primary/15 hover:bg-primary-light/40"
                  }`}
                >
                  当前领域 ({sessionList.filter((s) => s.contextType === contextType).length})
                </button>
              </div>

              {/* Session List */}
              <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-2.5">
                {loadingSessions ? (
                  <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-2">
                    <Loader2 size={24} className="animate-spin text-primary" />
                    <span className="text-xs">加载历史记录中...</span>
                  </div>
                ) : sessionList.filter((s) => (historyFilter === "current" ? s.contextType === contextType : true)).length === 0 ? (
                  <div className="text-center py-16 space-y-2">
                    <p className="text-3xl">💬</p>
                    <p className="text-xs text-text-muted">暂无历史对话记录</p>
                    <button
                      type="button"
                      onClick={startNewSession}
                      className="text-xs text-primary font-bold hover:underline"
                    >
                      开启一次新对话
                    </button>
                  </div>
                ) : (
                  sessionList
                    .filter((s) => (historyFilter === "current" ? s.contextType === contextType : true))
                    .map((s) => {
                      const sMeta = CONTEXT_META[s.contextType as AiContextType] || CONTEXT_META.general;
                      const isCurrentActive = s.id === sessionId;

                      return (
                        <div
                          key={s.id}
                          onClick={() => loadSessionDetail(s.id)}
                          className={`p-3 rounded-2xl border transition-all cursor-pointer group flex items-start justify-between gap-2.5 ${
                            isCurrentActive
                              ? "bg-primary-light/40 border-primary shadow-xs ring-1 ring-primary/20"
                              : "bg-card hover:bg-white border-primary/10 hover:border-primary/30 shadow-2xs"
                          }`}
                        >
                          <div className="flex items-start gap-2.5 flex-1 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-primary-soft/50 text-base flex items-center justify-center shrink-0 mt-0.5">
                              {sMeta.emoji}
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center gap-1.5">
                                <h4 className="font-bold text-xs sm:text-sm text-text-primary truncate group-hover:text-primary transition-colors">
                                  {s.title}
                                </h4>
                                {isCurrentActive && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary text-white font-bold shrink-0">
                                    当前
                                  </span>
                                )}
                              </div>
                              {s.lastMessage && (
                                <p className="text-[11px] text-text-muted truncate">
                                  {s.lastMessage.role === "user" ? "家长：" : "AI："}{s.lastMessage.content}
                                </p>
                              )}
                              <div className="flex items-center gap-2 text-[10px] text-text-muted">
                                <span className="flex items-center gap-0.5">
                                  <Clock size={10} />
                                  <span>{new Date(s.updatedAt).toLocaleDateString()} {new Date(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                </span>
                                <span>·</span>
                                <span className="flex items-center gap-0.5">
                                  <MessageSquare size={10} />
                                  <span>{s.messageCount} 条</span>
                                </span>
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => handleDeleteSession(e, s.id)}
                            className="p-1.5 text-text-muted hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors shrink-0"
                            title="删除会话"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          )}

          {/* Quick Suggestion Chips */}
          <div className="px-3.5 py-2.5 bg-white/60 backdrop-blur-xs border-b border-primary/10 overflow-x-auto scrollbar-hide flex gap-2 shrink-0">
            {meta.chips.map((chip, idx) => (
              <button
                key={idx}
                type="button"
                disabled={loading}
                onClick={() => {
                  if (chip.startsWith("📷")) {
                    fileInputRef.current?.click();
                  } else {
                    handleSend(chip);
                  }
                }}
                className="text-xs bg-card text-text-secondary hover:text-primary hover:bg-primary-light/50 border border-primary/15 rounded-full px-3 py-1.5 shrink-0 shadow-xs transition-all active:scale-95 text-left flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <Sparkles size={11} className="text-primary shrink-0" />
                <span>{chip}</span>
              </button>
            ))}
          </div>

        {/* Message History */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-transparent to-primary-light/10">
          {messages.map((m) => {
            const isUser = m.role === "user";
            const isThinking =
              !isUser && m.isStreaming && !m.content && !(m.tools && m.tools.length);
            const { cleanText, actions } = !isUser
              ? extractActionsAndCleanMarkdown(m.content)
              : { cleanText: m.content, actions: [] as ActionCardData[] };

            return (
              <div
                key={m.id}
                className={`flex gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}
              >
                {!isUser && (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-soft to-pink-100 text-primary flex items-center justify-center shrink-0 mt-0.5 shadow-xs border border-primary/10">
                    <Bot size={14} />
                  </div>
                )}

                <div
                  className={`relative max-w-[88%] rounded-2xl p-3.5 shadow-sm text-xs sm:text-sm leading-relaxed ${
                    isUser
                      ? "bg-gradient-to-r from-primary to-pink-500 text-white shadow-primary/20"
                      : "bg-card text-text-primary border border-primary/10 shadow-none"
                  }`}
                >
                  {/* Thinking status inside the single assistant bubble */}
                  {isThinking ? (
                    <div className="flex items-center gap-2 text-xs text-text-secondary py-1">
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" />
                      </div>
                      <span className="text-[11px] text-text-muted">结合宝宝月龄与多模态数据深度解析中...</span>
                    </div>
                  ) : isUser ? (
                    /* User message with optional image thumbnail */
                    <div className="space-y-2">
                      {m.image && (
                        <div className="rounded-xl overflow-hidden max-w-[200px] border border-white/30 shadow-xs">
                          <img src={m.image} alt="上传单据" className="w-full h-auto max-h-48 object-cover" />
                        </div>
                      )}
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    </div>
                  ) : (
                    /* Assistant Rich Markdown Rendering + Action Card + Search Citations */
                    <div className="space-y-2">
                      {m.tools && m.tools.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {m.tools.map((t, i) => (
                            <span
                              key={`${t.name}-${i}`}
                              className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${
                                t.name === "web_search"
                                  ? "bg-blue-50 text-blue-700 border-blue-200"
                                  : t.status === "start"
                                    ? "bg-primary-light/50 text-text-secondary border-primary/15"
                                    : t.isError
                                      ? "bg-red-50 text-red-600 border-red-200"
                                      : "bg-emerald-50 text-emerald-700 border-emerald-200"
                              }`}
                              title={t.summary || t.name}
                            >
                              {t.name === "web_search" ? (
                                <Globe size={10} className="text-blue-500 animate-pulse" />
                              ) : (
                                <Wrench size={10} />
                              )}
                              {t.status === "start" ? "正在" : t.isError ? "失败" : "已完成"}
                              {t.label || t.name}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* 🌐 实时联网检索佐证卡片 */}
                      {(() => {
                        const webSearchTool = m.tools?.find((t) => t.name === "web_search");
                        let searchEvidenceResults: SearchEvidenceItem[] = [];
                        if (webSearchTool) {
                          if (Array.isArray((webSearchTool.details as any)?.results)) {
                            searchEvidenceResults = (webSearchTool.details as any).results;
                          } else if (typeof webSearchTool.summary === "string") {
                            try {
                              const parsed = JSON.parse(webSearchTool.summary);
                              if (Array.isArray(parsed.results)) searchEvidenceResults = parsed.results;
                            } catch {}
                          }
                        }
                        return searchEvidenceResults.length > 0 ? (
                          <WebSearchCitationCard results={searchEvidenceResults} />
                        ) : null;
                      })()}

                      <div className="markdown-content space-y-2">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ href, children }) => (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 my-0.5 rounded-md bg-blue-50/80 hover:bg-blue-100 text-blue-600 hover:text-blue-800 border border-blue-200/60 font-medium text-[11px] transition-colors"
                              >
                                <span>{children}</span>
                                <ExternalLink size={10} className="shrink-0 text-blue-400" />
                              </a>
                            ),
                            h1: ({ children }) => (
                              <h1 className="text-sm font-bold text-primary-dark mt-2 mb-1 border-l-2 border-primary pl-2">
                                {children}
                              </h1>
                            ),
                            h2: ({ children }) => (
                              <h2 className="text-xs sm:text-sm font-bold text-text-primary mt-2 mb-1 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                                {children}
                              </h2>
                            ),
                            h3: ({ children }) => (
                              <h3 className="text-xs font-bold text-text-primary mt-1.5 mb-0.5">
                                {children}
                              </h3>
                            ),
                            p: ({ children }) => (
                              <p className="my-1 leading-relaxed text-text-primary">{children}</p>
                            ),
                            strong: ({ children }) => (
                              <strong className="font-bold text-primary bg-primary-light/50 px-1 py-0.5 rounded">
                                {children}
                              </strong>
                            ),
                            ul: ({ children }) => (
                              <ul className="my-1.5 pl-4 space-y-1 list-disc marker:text-primary/70">
                                {children}
                              </ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="my-1.5 pl-4 space-y-1 list-decimal marker:text-primary font-medium">
                                {children}
                              </ol>
                            ),
                            li: ({ children }) => (
                              <li className="leading-relaxed pl-0.5">{children}</li>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className="my-2 p-2.5 bg-primary-light/30 border-l-3 border-primary rounded-r-xl text-xs text-text-secondary">
                                {children}
                              </blockquote>
                            ),
                            table: ({ children }) => (
                              <div className="overflow-x-auto my-2 rounded-xl border border-primary/15">
                                <table className="w-full text-left text-[11px] border-collapse">
                                  {children}
                                </table>
                              </div>
                            ),
                            thead: ({ children }) => (
                              <thead className="bg-primary-light/60 text-text-primary font-bold">
                                {children}
                              </thead>
                            ),
                            th: ({ children }) => (
                              <th className="p-2 border-b border-primary/15">{children}</th>
                            ),
                            td: ({ children }) => (
                              <td className="p-2 border-b border-primary/10">{children}</td>
                            ),
                            code: ({ children }) => (
                              <code className="bg-primary-light/40 text-primary px-1.5 py-0.5 rounded text-[11px] font-mono">
                                {children}
                              </code>
                            ),
                          }}
                        >
                          {cleanText}
                        </ReactMarkdown>

                        {/* Streaming blinking cursor */}
                        {m.isStreaming && (
                          <span className="inline-block w-1.5 h-3.5 bg-primary ml-0.5 animate-pulse align-middle" />
                        )}
                      </div>

                      {/* Interactive Action Cards（支持多事件多卡片） */}
                      {actions.map((a, i) => (
                        <div key={`${a.type}-${i}`} className={i > 0 ? "mt-2.5" : ""}>
                          <AiActionCard action={a} />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Bubble footer */}
                  <div
                    className={`flex items-center justify-between gap-3 mt-2 text-[10px] ${
                      isUser ? "text-white/75" : "text-text-muted"
                    }`}
                  >
                    <span>{m.timestamp}</span>
                    {!isUser && m.id !== "welcome" && !m.isStreaming && cleanText && (
                      <button
                        onClick={() => handleCopy(m.id, cleanText)}
                        className="hover:text-primary transition-colors flex items-center gap-0.5 cursor-pointer"
                        title="复制建议"
                      >
                        {copiedId === m.id ? (
                          <>
                            <Check size={11} className="text-emerald-500" />
                            <span className="text-emerald-500">已复制</span>
                          </>
                        ) : (
                          <>
                            <Copy size={11} />
                            <span>复制</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {isUser && (
                  <div className="w-7 h-7 rounded-full bg-primary-light flex items-center justify-center shrink-0 mt-0.5 overflow-hidden shadow-xs border border-primary/20">
                    {baby?.avatarUrl ? (
                      <img src={baby.avatarUrl} alt="头像" className="w-full h-full object-cover" />
                    ) : (
                      <Baby size={14} className="text-primary" />
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar - High contrast, sticky with image upload */}
        <div
          className="p-3 pb-[max(14px,env(safe-area-inset-bottom))] relative bg-card border-t border-primary/15 flex flex-col gap-2 shrink-0 z-30"
          style={{
            transform: keyboardInset > 0 ? `translateY(-${keyboardInset}px)` : undefined,
            paddingBottom: keyboardInset > 0 ? 12 : undefined,
            transition: "transform 0.15s ease-out",
          }}
        >
          {/* 键盘上方 iOS form assistant 栏是半透明的，用不透明色块向下延伸遮住透出的页面 */}
          {keyboardInset > 0 && (
            <div aria-hidden className="absolute left-0 right-0 top-full h-[40vh] bg-card pointer-events-none" />
          )}
          
          {/* Selected image preview chip */}
          {selectedImage && (
            <div className="flex items-center gap-2 bg-primary-light/40 p-1.5 px-3 rounded-2xl border border-primary/20 w-fit animate-in fade-in">
              <div className="w-8 h-8 rounded-lg overflow-hidden border border-primary/30">
                <img src={selectedImage} alt="预览" className="w-full h-full object-cover" />
              </div>
              <span className="text-[11px] text-text-primary font-medium">已附加单据照片</span>
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                className="tap-hotzone w-5 h-5 rounded-full bg-primary/20 text-primary hover:bg-primary/30 flex items-center justify-center cursor-pointer"
              >
                <X size={12} />
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            {/* Hidden image input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageSelect}
            />

            {/* Photo / Image Attachment button */}
            <button
              type="button"
              disabled={loading || uploadingImage}
              onClick={() => fileInputRef.current?.click()}
              className="w-10 h-10 rounded-2xl bg-slate-100 hover:bg-primary-light text-text-secondary hover:text-primary flex items-center justify-center border border-primary/15 transition-all shrink-0 active:scale-95 cursor-pointer disabled:opacity-40"
              title="拍照 / 上传化验单或图片"
            >
              {uploadingImage ? (
                <Loader2 size={16} className="animate-spin text-primary" />
              ) : (
                <ImageIcon size={18} />
              )}
            </button>

            {/* Voice input button */}
            <button
              type="button"
              disabled={loading || transcribing}
              onClick={() => (recording ? stopRecording() : startRecording())}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center border transition-all shrink-0 active:scale-95 cursor-pointer disabled:opacity-40 ${
                recording
                  ? "bg-red-500 text-white border-red-500 animate-pulse"
                  : "bg-slate-100 hover:bg-primary-light text-text-secondary hover:text-primary border-primary/15"
              }`}
              title={recording ? "点击停止并发送识别" : "按一下说话，自动转成文字"}
            >
              {transcribing ? (
                <Loader2 size={18} className="animate-spin text-primary" />
              ) : recording ? (
                <span className="w-3 h-3 bg-white rounded-sm" />
              ) : (
                <Mic size={18} />
              )}
            </button>

            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={selectedImage ? "可补充说明，如'帮我解读并存入档案'..." : meta.placeholder}
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-slate-50/90 hover:bg-white focus:bg-white rounded-2xl text-xs sm:text-sm text-text-primary font-medium border-2 border-primary/20 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-text-muted/70 shadow-2xs"
            />

            <button
              type="submit"
              disabled={(!inputText.trim() && !selectedImage) || loading}
              className="w-10 h-10 rounded-2xl bg-gradient-to-r from-primary to-pink-500 text-white flex items-center justify-center shadow-button hover:opacity-95 disabled:opacity-35 transition-all shrink-0 active:scale-95 cursor-pointer"
              title="发送提问或录入"
            >
              <Send size={15} />
            </button>
          </form>

          {/* Medical disclaimer */}
          <p className="text-[10px] text-text-muted/70 text-center flex items-center justify-center gap-1">
            <AlertCircle size={10} className="text-amber-500/70 shrink-0" />
            支持拍照化验单智能录入与自然语言日常记账 · 医疗建议仅供参考
          </p>
        </div>
      </div>
    </div>
  </div>
  );
};
