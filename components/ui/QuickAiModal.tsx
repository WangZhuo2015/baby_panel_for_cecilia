"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRouter } from "next/navigation";
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
  FileText,
  Camera,
  Layers,
  Lightbulb,
  Droplets,
  Moon,
  Wind,
  UtensilsCrossed,
  ShieldCheck,
  TrendingUp,
  Star,
  Activity,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { useBabyStore } from "@/stores/useBabyStore";
import { calculateAge } from "@/lib/age";
import { AiActionCard, ActionCardData } from "@/components/ui/AiActionCard";
import { VoiceRecordingBar } from "@/components/ui/VoiceRecordingBar";
import { useToast } from "@/components/ui/Toast";
import { compressImageForOcr } from "@/lib/upload";
import type { AiDailySummaryResult } from "@/types/daily-summary";

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

export type AiHubTab = "chat" | "daily_summary" | "vision" | "topics";

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
    <div className="my-2 rounded-2xl bg-gradient-to-br from-blue-50/80 via-indigo-50/40 to-sky-50/30 border border-blue-200/70 p-2.5 space-y-2 text-xs animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-bold text-blue-900 text-xs">
          <Globe size={13} className="text-blue-600 animate-pulse" />
          <span>权威联网佐证与引用来源（{results.length} 篇）</span>
        </div>
        {results.length > 2 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] font-medium text-blue-600 hover:text-blue-800 flex items-center gap-0.5 cursor-pointer btn-press"
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
              className="block p-2 rounded-xl bg-white/90 hover:bg-white border border-blue-100/80 shadow-2xs transition-all hover:border-blue-300 hover:shadow-xs card-hover-lift group"
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
  images?: string[];
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
      "刚才喝了120ml奶粉，记一下",
      "下午1点半睡到3点，帮我记录",
      "今天这个月龄最需要注意什么？",
      "宝宝体温多少度算发烧？怎么物理降温？",
    ],
    placeholder: "随时提问、发照片或一句话记账（如'喝了120ml奶'）...",
  },
};

const TOPIC_PRESETS = [
  {
    category: "喂养与胀气",
    icon: Droplets,
    color: "from-sky-500 to-blue-500",
    contextType: "feeding" as AiContextType,
    prompts: [
      "当前月龄每日科学奶量标准是多少？分几次喂最合适？",
      "宝宝吃完奶频繁吐奶溢奶，有什么防吐奶和深度拍嗝技巧？",
      "宝宝肚子胀气鼓鼓、蹬腿哭闹，怎么做排气操与腹部按摩？",
      "母乳亲喂与配方奶混合喂养，该如何合理安排节奏？",
    ],
  },
  {
    category: "睡眠与作息",
    icon: Moon,
    color: "from-purple-500 to-indigo-500",
    contextType: "sleep" as AiContextType,
    prompts: [
      "当前月龄最合理的清醒间隔和作息时间表是怎样的？",
      "宝宝白天短睡30分钟就醒，怎么科学接觉延长睡眠？",
      "落地醒、必须要抱睡或含乳睡，如何温和培养自主入睡？",
      "夜醒频繁（每隔1-2小时醒一次），常见原因与排查步骤是什么？",
    ],
  },
  {
    category: "辅食与营养",
    icon: UtensilsCrossed,
    color: "from-amber-500 to-orange-500",
    contextType: "food" as AiContextType,
    prompts: [
      "当前月龄可以引入哪些新食材？制作辅食有哪些质地要求？",
      "宝宝吃辅食出现轻微红疹或便便变稀，如何排查食物过敏？",
      "如何科学补充维生素D、铁剂和钙？复合补剂该怎么吃？",
      "宝宝抗拒辅食、闭嘴不吃，有什么温和引导进食的方法？",
    ],
  },
  {
    category: "生长与发育",
    icon: TrendingUp,
    color: "from-pink-500 to-rose-500",
    contextType: "growth" as AiContextType,
    prompts: [
      "如何根据 WHO 生长曲线看懂宝宝的身长和体重百分位？",
      "宝宝体重增长稍微放缓，需要加奶或调整营养摄入吗？",
      "当前月龄大运动（翻身/坐立/爬行/站立）家庭训练方法有哪些？",
      "有哪些需要警惕的发育红旗信号（Red Flags）？",
    ],
  },
  {
    category: "医学与化验单",
    icon: FileText,
    color: "from-blue-600 to-cyan-600",
    contextType: "medical" as AiContextType,
    prompts: [
      "血常规化验单上的白细胞、中性粒细胞和CRP偏高代表什么？",
      "宝宝发烧到了多少度需要吃退烧药（美林/泰诺林）？怎么交替？",
      "微量元素化验单缺铁性贫血该如何正确补铁？",
      "出现哪些伴随症状时必须立刻去儿科急诊？",
    ],
  },
  {
    category: "疫苗与疾病",
    icon: ShieldCheck,
    color: "from-emerald-500 to-teal-500",
    contextType: "vaccine" as AiContextType,
    prompts: [
      "13价肺炎、轮状病毒、流感等自费二类疫苗推荐接种吗？",
      "打完疫苗后发热、接种部位红肿硬结该如何护理？",
      "宝宝轻微流鼻涕或咳嗽，可以正常如期去接种疫苗吗？",
      "幼儿急疹和普通感冒发热在发病过程上有什么区别？",
    ],
  },
];

function extractActionsAndCleanMarkdown(content: string): { cleanText: string; actions: ActionCardData[] } {
  const closedRegex = /```(?:json:action|action)\s*([\s\S]*?)\s*```/g;
  const actions: ActionCardData[] = [];
  let cleanText = content;

  const matches = [...content.matchAll(closedRegex)];
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (actions.length < 6) actions.push(parsed);
    } catch {}
  }
  if (matches.length > 0) {
    cleanText = content.replace(closedRegex, "").trim();
    return { cleanText, actions };
  }

  const unclosedRegex = /```(?:json:action|action)[\s\S]*$/;
  if (unclosedRegex.test(content)) {
    return { cleanText: content.replace(unclosedRegex, "").trim(), actions: [] };
  }

  return { cleanText: content, actions: [] };
}

export const QuickAiModal: React.FC<QuickAiModalProps> = ({
  isOpen,
  onClose,
  contextType: initialContextType,
  contextTitle,
  contextDetail,
  initialPrompt,
}) => {
  const router = useRouter();
  const baby = useBabyStore((s) => s.baby);
  const age = baby ? calculateAge(baby.birthDate) : { months: 0, days: 0, label: "0月0天" };

  const [activeTab, setActiveTab] = useState<AiHubTab>("chat");
  const [currentContextType, setCurrentContextType] = useState<AiContextType>(initialContextType || "general");

  const meta = CONTEXT_META[currentContextType] || CONTEXT_META.general;
  const displayTitle = contextTitle || meta.title;

  const [messages, setMessages] = useState<Message[]>([]);
  const { showToast } = useToast();

  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset > 120 ? inset : 0);
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
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = sessionId;

  const [showHistory, setShowHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"all" | "current">("all");
  const [sessionList, setSessionList] = useState<SessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const [dailySummaryData, setDailySummaryData] = useState<AiDailySummaryResult | null>(null);
  const [loadingDailySummary, setLoadingDailySummary] = useState(false);

  const fetchDailySummaryInline = useCallback(async (force = false) => {
    if (!baby?.id) return;
    setLoadingDailySummary(true);
    try {
      const url = `/api/ai/daily-summary?babyId=${baby.id}${force ? "&force=true" : ""}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setDailySummaryData(data.summary);
      }
    } catch {
      // ignore
    } finally {
      setLoadingDailySummary(false);
    }
  }, [baby?.id]);

  useEffect(() => {
    if (activeTab === "daily_summary" && !dailySummaryData) {
      fetchDailySummaryInline();
    }
  }, [activeTab, dailySummaryData, fetchDailySummaryInline]);

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
    if (summary && summary.contextType) {
      setCurrentContextType(summary.contextType as AiContextType);
    }
    try {
      const query = new URLSearchParams();
      if (baby?.id) query.set("babyId", baby.id);
      query.set("contextType", summary?.contextType || currentContextType);
      const res = await fetch(`/api/ai/sessions/${targetId}?${query.toString()}`);
      if (!res.ok) throw new Error("加载历史对话失败");
      const data = await res.json();
      const s = data.session;
      setSessionId(s.id);
      setSessionTitle(s.title);
      if (s.messages && s.messages.length > 0) {
        setMessages(
          s.messages.map((m: any) => {
            let imgs: string[] = [];
            if (Array.isArray(m.images)) {
              imgs = m.images;
            } else if (m.image) {
              if (m.image.startsWith("[")) {
                try {
                  const parsed = JSON.parse(m.image);
                  if (Array.isArray(parsed)) imgs = parsed;
                } catch {
                  imgs = [m.image];
                }
              } else {
                imgs = [m.image];
              }
            }
            return {
              id: m.id,
              role: m.role,
              content: m.content,
              image: m.image || undefined,
              images: imgs.length > 0 ? imgs : undefined,
              timestamp: new Date(m.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
              tools: Array.isArray(m.tools) ? m.tools : [],
            };
          })
        );
      }
      setShowHistory(false);
      setActiveTab("chat");
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
      content: `你好！我是 **${baby?.nickname || "宝宝"}**（${age.label}）的专属 **${displayTitle}** ✨\n\n你可以一句话快捷录入（如“喝了150ml奶”）、拍照上传单据，或选择上方专科专题与我交流：`,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages([welcome]);
    setShowHistory(false);
    setActiveTab("chat");
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
  const visionInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  const inputTextRef = useRef(inputText);
  inputTextRef.current = inputText;
  const selectedImagesRef = useRef<string[]>(selectedImages);
  selectedImagesRef.current = selectedImages;

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopRecording = React.useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === "recording") mr.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecordingStream(null);
    setRecording(false);
  }, []);

  const cancelRecording = React.useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === "recording") {
      mr.onstop = null;
      mr.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecordingStream(null);
    setRecording(false);
    showToast("已取消录音");
  }, [showToast]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setRecordingStream(stream);
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
        setRecordingStream(null);
        try {
          const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
          if (blob.size < 800) throw new Error("录音太短");
          const fd = new FormData();
          fd.append("audio", blob, `voice${mime.includes("mp4") ? ".m4a" : ".webm"}`);
          const res = await fetch("/api/asr/transcribe", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || "识别失败");
          showToast(`已识别：${String(data.text).slice(0, 30)}${data.text.length > 30 ? "…" : ""}`);
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
    async (textToSend?: string, imagesOverride?: string[] | string, customContext?: AiContextType) => {
      const query = (textToSend || inputTextRef.current).trim();
      const currentImgs: string[] = Array.isArray(imagesOverride)
        ? imagesOverride
        : typeof imagesOverride === "string" && imagesOverride
          ? [imagesOverride]
          : selectedImagesRef.current;

      if ((!query && currentImgs.length === 0) || loadingRef.current) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const targetContext = customContext || currentContextType;

      const userMsg: Message = {
        id: `user_${Date.now()}`,
        role: "user",
        content: query || (currentImgs.length > 1 ? `请帮我同时对比和解读这 ${currentImgs.length} 张图片/单据` : "请帮我结构化识别这张单据并提供儿科解读"),
        image: currentImgs.length === 1 ? currentImgs[0] : undefined,
        images: currentImgs.length > 0 ? currentImgs : undefined,
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
      setSelectedImages([]);
      setLoading(true);
      setActiveTab("chat");

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
                content: query || (currentImgs.length > 1 ? `请帮我同时对比和解读这 ${currentImgs.length} 张图片/单据` : "请帮我结构化识别这张单据并提供儿科解读"),
              },
            ],
            contextType: targetContext,
            contextDetail,
            babyId: baby?.id,
            images: currentImgs,
            image: currentImgs.length === 1 ? currentImgs[0] : undefined,
            sessionId: sessionIdRef.current || undefined,
          }),
        });

        if (!res.body) throw new Error("No response stream");

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

            if (trimmed === "data: [DONE]") break;

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
              } catch {}
            }
          }
        }

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
    [currentContextType, contextDetail, baby?.id]
  );

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const prevScopeRef = useRef<{ contextType: string; babyId: string | null }>({
    contextType: initialContextType,
    babyId: baby?.id ?? null,
  });

  useEffect(() => {
    if (isOpen) {
      const previousScope = prevScopeRef.current;
      const isScopeChanged =
        previousScope.contextType !== initialContextType ||
        previousScope.babyId !== (baby?.id ?? null);
      prevScopeRef.current = {
        contextType: initialContextType,
        babyId: baby?.id ?? null,
      };

      if (isScopeChanged) {
        setSessionId(null);
        sessionIdRef.current = null;
        setSessionTitle(null);
        setSelectedImages([]);
        setCurrentContextType(initialContextType || "general");
      }

      fetchSessions();

      if (messages.length === 0 || isScopeChanged) {
        const welcome: Message = {
          id: "welcome",
          role: "assistant",
          content: `你好！我是 **${baby?.nickname || "宝宝"}**（${age.label}）的专属 **${displayTitle}** ✨\n\n你可以一句话快捷录入（如“刚才喂了120ml奶”）、拍照上传单据，或选择上方【专科题库】与【今日复盘】深度了解宝宝状态：`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages([welcome]);

        if (initialPrompt) {
          handleSend(initialPrompt);
        }
      }
      setTimeout(() => inputRef.current?.focus(), 150);
    } else {
      useBabyStore.getState().refreshAll().catch(() => {});
    }
  }, [isOpen, initialContextType, initialPrompt, displayTitle, baby?.id, baby?.nickname, age.label, messages.length, handleSend, fetchSessions]);

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
    if (isOpen && activeTab === "chat") {
      scrollToBottom();
    }
  }, [messages, loading, isOpen, activeTab]);

  const handleImageSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
    autoSendPrompt?: string,
    targetContext?: AiContextType
  ) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const maxAllowed = 6;
    const currentCount = selectedImagesRef.current.length;
    const availableSlots = maxAllowed - currentCount;

    if (availableSlots <= 0) {
      showToast(`一次最多支持附加 ${maxAllowed} 张图片`);
      if (e.target) e.target.value = "";
      return;
    }

    const filesToProcess = files.slice(0, availableSlots);
    if (files.length > availableSlots) {
      showToast(`单次最多 ${maxAllowed} 张，已自动选择前 ${availableSlots} 张`);
    }

    setUploadingImage(true);
    try {
      const uploadPromises = filesToProcess.map(async (file) => {
        const compressed = await compressImageForOcr(file);
        const formData = new FormData();
        formData.append("file", compressed);
        const res = await fetch("/api/medical/upload", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "上传图片失败");
        }
        const data = await res.json();
        return data.imageUrl as string;
      });

      const uploadedUrls = await Promise.all(uploadPromises);
      const updatedImages = [...selectedImagesRef.current, ...uploadedUrls];
      setSelectedImages(updatedImages);

      if (autoSendPrompt) {
        handleSend(autoSendPrompt, updatedImages, targetContext);
      }
    } catch (err: any) {
      showToast(err?.message || "部分图片上传失败，请重试");
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (visionInputRef.current) visionInputRef.current.value = "";
    }
  };

  const handleRemoveImage = (indexToRemove: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== indexToRemove));
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSelectTopicPrompt = (prompt: string, topicContext: AiContextType) => {
    setCurrentContextType(topicContext);
    handleSend(prompt, undefined, topicContext);
  };

  const [visionMode, setVisionMode] = useState<string>("medical");

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-ai-title"
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-xs transition-opacity duration-200"
        onClick={onClose}
      />

      {/* Drawer Container (Mobile: iOS-style bottom drawer sheet; Desktop: smooth rising sheet) */}
      <div className="relative w-full max-w-full sm:max-w-4xl lg:max-w-5xl bg-card h-[92vh] sm:h-[740px] lg:h-[800px] max-h-[92vh] rounded-t-[28px] sm:rounded-[28px] shadow-2xl overflow-hidden flex flex-col sm:flex-row border-t sm:border border-primary/20 animate-drawer-bottom z-10">
        
        {/* Mobile Drawer Grab Handle */}
        <div className="w-12 h-1.5 rounded-full bg-primary/25 dark:bg-white/20 mx-auto mt-2.5 mb-1 sm:hidden shrink-0" />

        {/* ===== Desktop/iPad History Sidebar ===== */}
        <div className="w-72 border-r border-primary/10 hidden md:flex flex-col bg-white/50 dark:bg-card/50 shrink-0 select-none">
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
              className="px-2.5 py-1 rounded-xl bg-gradient-to-r from-primary to-pink-500 text-white text-xs font-bold shadow-xs hover:opacity-95 flex items-center gap-1 cursor-pointer btn-spring"
              title="新建会话"
            >
              <Plus size={13} />
              <span>新对话</span>
            </button>
          </div>

          {/* Sidebar Filter Chips */}
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
              当前领域 ({sessionList.filter((s) => s.contextType === currentContextType).length})
            </button>
          </div>

          {/* Session List */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2 scrollbar-thin">
            {loadingSessions ? (
              <div className="flex flex-col items-center justify-center py-12 text-text-muted gap-2">
                <Loader2 size={20} className="animate-spin text-primary" />
                <span className="text-[11px]">加载历史中...</span>
              </div>
            ) : sessionList.filter((s) => (historyFilter === "current" ? s.contextType === currentContextType : true)).length === 0 ? (
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
                .filter((s) => (historyFilter === "current" ? s.contextType === currentContextType : true))
                .map((s) => {
                  const sMeta = CONTEXT_META[s.contextType as AiContextType] || CONTEXT_META.general;
                  const isCurrentActive = s.id === sessionId;

                  return (
                    <div
                      key={s.id}
                      onClick={() => loadSessionDetail(s.id)}
                      className={`p-2.5 rounded-2xl border transition-all cursor-pointer group flex items-start justify-between gap-2 card-hover-lift ${
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

        {/* ===== Right Main Area with Unified Tabs ===== */}
        <div className="flex-1 flex flex-col min-w-0 h-full relative">
          
          {/* 1. Header with Unified Hub Tab Navigation */}
          <div className="px-4 py-2.5 pt-[max(12px,env(safe-area-inset-top))] bg-white/95 dark:bg-card/95 backdrop-blur-md border-b border-primary/10 shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                <div className="w-8 h-8 rounded-2xl bg-gradient-to-br from-primary to-pink-500 text-white flex items-center justify-center text-base shadow-sm shadow-primary/25 shrink-0 animate-float">
                  <Sparkles size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 id="quick-ai-title" className="font-bold text-text-primary text-sm sm:text-base truncate">
                      AI 育儿智能中枢
                    </h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-soft/50 text-primary font-bold">
                      {baby?.nickname || "宝宝"}·{age.label}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowHistory(true);
                    fetchSessions();
                  }}
                  className="md:hidden w-8 h-8 rounded-full bg-primary-soft/40 hover:bg-primary-soft text-text-muted hover:text-primary flex items-center justify-center transition-colors cursor-pointer btn-press"
                  title="历史对话记录"
                  aria-label="历史对话记录"
                >
                  <History size={16} />
                </button>
                <button
                  type="button"
                  onClick={startNewSession}
                  className="w-8 h-8 rounded-full bg-primary-soft/40 hover:bg-primary-soft text-text-muted hover:text-primary flex items-center justify-center transition-colors cursor-pointer btn-press"
                  title="新建对话"
                  aria-label="新建对话"
                >
                  <Plus size={16} />
                </button>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-full bg-primary-soft/40 hover:bg-primary-soft text-text-muted hover:text-text-primary flex items-center justify-center transition-colors cursor-pointer btn-press"
                  title="关闭 (Esc)"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Hub Navigation Tabs Bar */}
            <div className="flex items-center gap-1.5 p-1 bg-primary-light/40 dark:bg-card/70 rounded-2xl border border-primary/15 overflow-x-auto scrollbar-hide">
              <button
                type="button"
                onClick={() => setActiveTab("chat")}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
                  activeTab === "chat"
                    ? "bg-primary text-white shadow-xs scale-102"
                    : "text-text-secondary hover:text-primary hover:bg-primary-light/60"
                }`}
              >
                <MessageSquare size={13} />
                <span>智能对话与录入</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("daily_summary")}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
                  activeTab === "daily_summary"
                    ? "bg-primary text-white shadow-xs scale-102"
                    : "text-text-secondary hover:text-primary hover:bg-primary-light/60"
                }`}
              >
                <Activity size={13} />
                <span>今日复盘</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("vision")}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
                  activeTab === "vision"
                    ? "bg-primary text-white shadow-xs scale-102"
                    : "text-text-secondary hover:text-primary hover:bg-primary-light/60"
                }`}
              >
                <Camera size={13} />
                <span>拍照识别中枢</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("topics")}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
                  activeTab === "topics"
                    ? "bg-primary text-white shadow-xs scale-102"
                    : "text-text-secondary hover:text-primary hover:bg-primary-light/60"
                }`}
              >
                <Lightbulb size={13} />
                <span>专科题库</span>
              </button>
            </div>
          </div>

          {/* 移动端历史抽屉浮层 */}
          {showHistory && (
            <div className="absolute inset-0 bg-card z-30 flex flex-col md:hidden animate-slide-in-right">
              <div className="flex items-center justify-between px-4 py-3 pt-[max(12px,env(safe-area-inset-top))] bg-white/95 backdrop-blur-md border-b border-primary/10 shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowHistory(false)}
                    className="w-8 h-8 rounded-full bg-primary-soft/40 hover:bg-primary-soft text-text-muted hover:text-text-primary flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div>
                    <h3 className="font-bold text-text-primary text-sm sm:text-base">历史对话记录</h3>
                    <p className="text-[11px] text-text-muted">随时查看与续聊</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={startNewSession}
                  className="px-3 py-1.5 rounded-full bg-gradient-to-r from-primary to-pink-500 text-white text-xs font-bold shadow-xs hover:opacity-95 flex items-center gap-1 cursor-pointer btn-spring"
                >
                  <Plus size={14} />
                  <span>新对话</span>
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-2.5">
                {sessionList.map((s) => {
                  const sMeta = CONTEXT_META[s.contextType as AiContextType] || CONTEXT_META.general;
                  return (
                    <div
                      key={s.id}
                      onClick={() => loadSessionDetail(s.id)}
                      className="p-3 rounded-2xl border border-primary/10 bg-card shadow-2xs card-hover-lift cursor-pointer flex items-start justify-between gap-2.5"
                    >
                      <div className="flex items-start gap-2.5 flex-1 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-primary-soft/50 text-base flex items-center justify-center shrink-0 mt-0.5">
                          {sMeta.emoji}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <h4 className="font-bold text-xs sm:text-sm text-text-primary truncate">
                            {s.title}
                          </h4>
                          {s.lastMessage && (
                            <p className="text-[11px] text-text-muted truncate">
                              {s.lastMessage.role === "user" ? "家长：" : "AI："}{s.lastMessage.content}
                            </p>
                          )}
                          <div className="flex items-center gap-2 text-[10px] text-text-muted">
                            <Clock size={10} />
                            <span>{new Date(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            <span>·</span>
                            <span>{s.messageCount} 条</span>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(e, s.id)}
                        className="p-1.5 text-text-muted hover:text-red-500 rounded-lg transition-colors shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ===== TAB 1: 智能对话与录入 ===== */}
          {activeTab === "chat" && (
            <div className="flex-1 flex flex-col min-h-0 animate-fade-in">
              {/* Context Specific Chips Bar */}
              <div className="px-3.5 py-2 bg-white/70 dark:bg-card/70 border-b border-primary/10 overflow-x-auto scrollbar-hide flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-bold text-text-muted shrink-0 uppercase tracking-wider">快捷提问:</span>
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
                    className="text-xs bg-card text-text-secondary hover:text-primary hover:bg-primary-light/50 border border-primary/15 rounded-full px-3 py-1 shrink-0 shadow-xs transition-all card-hover-lift active:scale-95 text-left flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    <Sparkles size={11} className="text-primary shrink-0" />
                    <span>{chip}</span>
                  </button>
                ))}
              </div>

              {/* Message Scroll Area */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-transparent to-primary-light/10">
                {messages.map((m, mIdx) => {
                  const isUser = m.role === "user";
                  const isThinking =
                    !isUser && m.isStreaming && !m.content && !(m.tools && m.tools.length);
                  const { cleanText, actions } = !isUser
                    ? extractActionsAndCleanMarkdown(m.content)
                    : { cleanText: m.content, actions: [] as ActionCardData[] };

                  return (
                    <div
                      key={m.id}
                      className={`flex gap-2.5 ${isUser ? "justify-end" : "justify-start"} animate-slide-up`}
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
                        {isThinking ? (
                          <div className="flex items-center gap-2 text-xs text-text-secondary py-1">
                            <div className="flex gap-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" />
                            </div>
                            <span className="text-[11px] text-text-muted">结合宝宝月龄与医学数据库思考中...</span>
                          </div>
                        ) : isUser ? (
                          <div className="space-y-2">
                            {(() => {
                              const imgs = m.images && m.images.length > 0 ? m.images : m.image ? [m.image] : [];
                              if (imgs.length === 0) return null;
                              if (imgs.length === 1) {
                                return (
                                  <div
                                    className="rounded-xl overflow-hidden max-w-[220px] border border-white/30 shadow-xs cursor-pointer hover:opacity-95"
                                    onClick={() => window.open(imgs[0], "_blank")}
                                  >
                                    <img src={imgs[0]} alt="上传单据" className="w-full h-auto max-h-48 object-cover" />
                                  </div>
                                );
                              }
                              return (
                                <div className={`grid ${imgs.length === 2 ? "grid-cols-2" : "grid-cols-3"} gap-1.5 rounded-xl overflow-hidden max-w-[280px] border border-white/30 shadow-xs p-1 bg-black/10`}>
                                  {imgs.map((imgUrl, i) => (
                                    <div
                                      key={i}
                                      className="aspect-square rounded-lg overflow-hidden cursor-pointer hover:opacity-90 bg-black/20"
                                      onClick={() => window.open(imgUrl, "_blank")}
                                    >
                                      <img src={imgUrl} alt={`图片 ${i + 1}`} className="w-full h-full object-cover" />
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                            <div className="whitespace-pre-wrap">{m.content}</div>
                          </div>
                        ) : (
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
                                  code: ({ children }) => (
                                    <code className="bg-primary-light/40 text-primary px-1.5 py-0.5 rounded text-[11px] font-mono">
                                      {children}
                                    </code>
                                  ),
                                }}
                              >
                                {cleanText}
                              </ReactMarkdown>

                              {m.isStreaming && (
                                <span className="inline-block w-1.5 h-3.5 bg-primary ml-0.5 animate-pulse align-middle" />
                              )}
                            </div>

                            {actions.map((a, i) => (
                              <div key={`${a.type}-${i}`} className={i > 0 ? "mt-2.5" : ""}>
                                <AiActionCard action={a} />
                              </div>
                            ))}
                          </div>
                        )}

                        <div
                          className={`flex items-center justify-between gap-3 mt-2 text-[10px] ${
                            isUser ? "text-white/75" : "text-text-muted"
                          }`}
                        >
                          <span>{m.timestamp}</span>
                          {!isUser && m.id !== "welcome" && !m.isStreaming && cleanText && (
                            <button
                              onClick={() => handleCopy(m.id, cleanText)}
                              className="hover:text-primary transition-colors flex items-center gap-0.5 cursor-pointer btn-press"
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

              {/* Bottom Input Area */}
              <div
                className="p-3 pb-[max(14px,env(safe-area-inset-bottom))] relative bg-card border-t border-primary/15 flex flex-col gap-2 shrink-0 z-30"
                style={{
                  transform: keyboardInset > 0 ? `translateY(-${keyboardInset}px)` : undefined,
                  paddingBottom: keyboardInset > 0 ? 12 : undefined,
                  transition: "transform 0.15s ease-out",
                }}
              >
                {keyboardInset > 0 && (
                  <div aria-hidden className="absolute left-0 right-0 top-full h-[40vh] bg-card pointer-events-none" />
                )}
                
                {selectedImages.length > 0 && (
                  <div className="flex items-center gap-2 overflow-x-auto py-1 px-1 max-w-full animate-fade-in no-scrollbar">
                    <span className="text-[11px] font-bold text-primary px-2.5 py-1.5 rounded-xl bg-primary-light/60 shrink-0 flex items-center gap-1.5 border border-primary/20">
                      <ImageIcon size={13} />
                      <span>已选 {selectedImages.length} 张图片</span>
                    </span>
                    {selectedImages.map((imgUrl, idx) => (
                      <div key={idx} className="relative group shrink-0 w-11 h-11 rounded-xl overflow-hidden border-2 border-primary/30 shadow-2xs">
                        <img src={imgUrl} alt={`图片 ${idx + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => handleRemoveImage(idx)}
                          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center text-[10px] hover:bg-red-500 transition-colors cursor-pointer"
                          title="移除此图片"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                    {selectedImages.length < 6 && (
                      <button
                        type="button"
                        disabled={uploadingImage}
                        onClick={() => fileInputRef.current?.click()}
                        className="w-11 h-11 rounded-xl border-2 border-dashed border-primary/40 hover:border-primary text-primary flex flex-col items-center justify-center shrink-0 hover:bg-primary-light/30 transition-all cursor-pointer"
                        title="继续添加图片（最多6张）"
                      >
                        <Plus size={14} />
                        <span className="text-[8px] font-bold">{selectedImages.length}/6</span>
                      </button>
                    )}
                  </div>
                )}

                {recording || transcribing ? (
                  <VoiceRecordingBar
                    recording={recording}
                    transcribing={transcribing}
                    stream={recordingStream}
                    onStop={stopRecording}
                    onCancel={cancelRecording}
                    hint="正在倾听中... 说出记录如'喝了150ml奶粉'或'睡了1小时'"
                  />
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend();
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => handleImageSelect(e)}
                    />

                    <button
                      type="button"
                      disabled={loading || uploadingImage}
                      onClick={() => fileInputRef.current?.click()}
                      className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-card hover:bg-primary-light text-text-secondary hover:text-primary flex items-center justify-center border border-primary/15 transition-all shrink-0 active:scale-95 cursor-pointer disabled:opacity-40 btn-press relative"
                      title="拍照 / 上传化验单或图片（支持一次选择多张）"
                    >
                      {uploadingImage ? (
                        <Loader2 size={16} className="animate-spin text-primary" />
                      ) : (
                        <>
                          <ImageIcon size={18} />
                          {selectedImages.length > 0 && (
                            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center shadow-xs">
                              {selectedImages.length}
                            </span>
                          )}
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={loading || transcribing}
                      onClick={() => (recording ? stopRecording() : startRecording())}
                      className="w-10 h-10 rounded-2xl flex items-center justify-center border transition-all shrink-0 active:scale-95 cursor-pointer disabled:opacity-40 btn-spring bg-slate-100 dark:bg-card hover:bg-primary-light text-text-secondary hover:text-primary border-primary/15 hover:border-primary/40 hover:shadow-xs group"
                      title="按一下说话，自动转成文字并分析"
                    >
                      <Mic size={18} className="group-hover:scale-110 transition-transform" />
                    </button>

                    <input
                      ref={inputRef}
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder={selectedImages.length > 0 ? `已附加 ${selectedImages.length} 张图片，可输入说明或直接发送...` : meta.placeholder}
                      disabled={loading}
                      className="flex-1 px-4 py-2.5 bg-slate-50/90 hover:bg-white focus:bg-white dark:bg-card rounded-2xl text-xs sm:text-sm text-text-primary font-medium border-2 border-primary/20 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-text-muted/70 shadow-2xs"
                    />

                    <button
                      type="submit"
                      disabled={(!inputText.trim() && selectedImages.length === 0) || loading}
                      className="w-10 h-10 rounded-2xl bg-gradient-to-r from-primary to-pink-500 text-white flex items-center justify-center shadow-button hover:opacity-95 disabled:opacity-35 transition-all shrink-0 active:scale-95 cursor-pointer btn-spring"
                      title="发送提问或一句话记账"
                    >
                      <Send size={15} />
                    </button>
                  </form>
                )}

                <p className="text-[10px] text-text-muted/70 text-center flex items-center justify-center gap-1">
                  <AlertCircle size={10} className="text-amber-500/70 shrink-0" />
                  支持自然语言一句话记账、拍照化验单解读 · 医疗指导仅供参考
                </p>
              </div>
            </div>
          )}

          {/* ===== TAB 2: 今日综合复盘 (AI Daily Summary Inline) ===== */}
          {activeTab === "daily_summary" && (
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-transparent to-primary-light/10 animate-fade-in">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-text-primary flex items-center gap-1.5">
                    <Activity size={16} className="text-primary" />
                    <span>今日 AI 综合复盘与全维点评</span>
                  </h4>
                  <p className="text-[11px] text-text-muted">多维度汇聚今日喂养、睡眠、排便与生长状态</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fetchDailySummaryInline(true)}
                    disabled={loadingDailySummary}
                    className="text-xs px-2.5 py-1 rounded-xl bg-primary-light text-primary font-bold hover:bg-primary-soft flex items-center gap-1 transition-all cursor-pointer btn-press"
                  >
                    <RefreshCw size={12} className={loadingDailySummary ? "animate-spin" : ""} />
                    <span>重新生成</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      router.push("/daily-summary");
                    }}
                    className="text-xs px-2.5 py-1 rounded-xl bg-primary text-white font-bold hover:opacity-90 flex items-center gap-1 transition-all cursor-pointer btn-spring"
                  >
                    <span>完整日报页</span>
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>

              {loadingDailySummary ? (
                <div className="py-20 flex flex-col items-center justify-center text-text-muted gap-3">
                  <Loader2 size={28} className="animate-spin text-primary" />
                  <p className="text-xs">AI 正在汇总今日全部数据并生成复盘中...</p>
                </div>
              ) : dailySummaryData ? (
                <div className="space-y-4 animate-slide-up">
                  {/* Score & Headline Card */}
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-primary-light via-pink-50/60 to-lavender/20 border border-primary/20 shadow-soft">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-[10px] font-bold text-primary uppercase tracking-wider">今日状态评分</span>
                        <div className="text-xl font-black text-primary mt-0.5 flex items-baseline gap-1.5">
                          <span>{dailySummaryData.overallScore}</span>
                          <span className="text-xs font-normal text-text-muted">（{dailySummaryData.overallRating} / 5星）</span>
                        </div>
                      </div>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-primary/15 text-primary font-bold">
                        {dailySummaryData.isPreterm ? "已按矫正月龄对标" : "按生理月龄对标"}
                      </span>
                    </div>
                    <h5 className="font-bold text-sm text-text-primary mt-2">{dailySummaryData.headline}</h5>
                  </div>

                  {/* Highlights Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {dailySummaryData.highlights.map((h, i) => (
                      <div key={i} className="p-3 rounded-2xl bg-card border border-primary/10 shadow-xs flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <p className="text-xs text-text-primary leading-relaxed">{h}</p>
                      </div>
                    ))}
                  </div>

                  {/* Detailed Sections Evaluation */}
                  <div className="space-y-2.5">
                    <h5 className="text-xs font-bold text-text-secondary uppercase tracking-wider">分项儿科评估</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      <div className="p-3.5 rounded-2xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/60">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-xs text-sky-900 flex items-center gap-1.5">
                            <Droplets size={14} className="text-sky-500" />
                            <span>喂养与奶量摄入</span>
                          </span>
                          <span className="text-[10px] font-bold text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full">
                            {dailySummaryData.metrics.totalFeedingMl}ml / {dailySummaryData.metrics.feedingCount}次
                          </span>
                        </div>
                        <p className="text-xs text-sky-950 leading-relaxed">{dailySummaryData.sections.feeding}</p>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200/60">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-xs text-purple-900 flex items-center gap-1.5">
                            <Moon size={14} className="text-purple-500" />
                            <span>睡眠与作息节律</span>
                          </span>
                          <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                            {Math.floor(dailySummaryData.metrics.totalSleepMinutes / 60)}h{dailySummaryData.metrics.totalSleepMinutes % 60}m
                          </span>
                        </div>
                        <p className="text-xs text-purple-950 leading-relaxed">{dailySummaryData.sections.sleep}</p>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/60">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-xs text-emerald-900 flex items-center gap-1.5">
                            <Wind size={14} className="text-emerald-500" />
                            <span>大小便与肠胃舒适</span>
                          </span>
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                            {dailySummaryData.metrics.diaperCount}次尿布
                          </span>
                        </div>
                        <p className="text-xs text-emerald-950 leading-relaxed">{dailySummaryData.sections.diaper}</p>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-xs text-amber-900 flex items-center gap-1.5">
                            <Sparkles size={14} className="text-amber-500" />
                            <span>生长与补剂守护</span>
                          </span>
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                            {dailySummaryData.metrics.supplementsCount}次补剂
                          </span>
                        </div>
                        <p className="text-xs text-amber-950 leading-relaxed">{dailySummaryData.sections.growthAndCare}</p>
                      </div>
                    </div>
                  </div>

                  {/* Pediatric Tomorrow Advice */}
                  <div className="p-4 rounded-2xl bg-card border border-primary/20 shadow-soft space-y-2">
                    <h5 className="font-bold text-xs text-text-primary flex items-center gap-1.5">
                      <ShieldCheck size={15} className="text-primary" />
                      <span>明日照护建议与早教互动</span>
                    </h5>
                    <p className="text-xs text-text-primary leading-relaxed">{dailySummaryData.sections.tomorrowTips}</p>
                  </div>
                </div>
              ) : (
                <div className="py-16 text-center space-y-2">
                  <p className="text-3xl">📊</p>
                  <p className="text-xs text-text-muted">点击上方「重新生成」获取今日综合复盘</p>
                </div>
              )}
            </div>
          )}

          {/* ===== TAB 3: 视觉识别中枢 (AI Vision Center) ===== */}
          {activeTab === "vision" && (
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-transparent to-primary-light/10 animate-fade-in">
              <input
                ref={visionInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  let promptText = "请帮我解读这张单据并提取结构化指标";
                  let targetCtx: AiContextType = "medical";
                  if (visionMode === "formula") {
                    promptText = "请帮我识别这张配方奶粉或补剂的营养成分表，提取每100g各营养素含量及冲调比例";
                    targetCtx = "feeding";
                  } else if (visionMode === "food") {
                    promptText = "请识别这张辅食/餐盘照片中的食材，评估当前月龄过敏风险与营养搭配";
                    targetCtx = "food";
                  } else if (visionMode === "skin") {
                    promptText = "请帮我观察这张皮肤/便便/身体照片，给出初步护理建议与就医指引";
                    targetCtx = "medical";
                  }
                  handleImageSelect(e, promptText, targetCtx);
                }}
              />

              <div>
                <h4 className="text-sm font-bold text-text-primary flex items-center gap-1.5">
                  <Camera size={16} className="text-primary" />
                  <span>多模态视觉识别中枢</span>
                </h4>
                <p className="text-[11px] text-text-muted">选择识别类型，拍照或从相册上传，AI 自动提取入库并给出临床指导</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* 1. Medical Report */}
                <div
                  onClick={() => {
                    setVisionMode("medical");
                    visionInputRef.current?.click();
                  }}
                  className="p-4 rounded-2xl bg-gradient-to-br from-blue-50/80 to-sky-50/40 border border-blue-200/70 shadow-xs card-hover-lift cursor-pointer space-y-2.5 group"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 rounded-2xl bg-blue-500 text-white flex items-center justify-center shadow-xs group-hover:scale-110 transition-transform">
                      <FileText size={20} />
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold">
                      化验单 OCR
                    </span>
                  </div>
                  <div>
                    <h5 className="font-bold text-sm text-blue-950 group-hover:text-blue-600 transition-colors">
                      血常规 / 微量元素 / 体检单
                    </h5>
                    <p className="text-xs text-blue-900/80 mt-1 leading-relaxed">
                      智能识别白细胞、CRP、血红蛋白、铁蛋白等30+指标并一键存入健康档案
                    </p>
                  </div>
                  <div className="pt-2 border-t border-blue-100 flex items-center justify-between text-xs font-bold text-blue-600">
                    <span>📷 拍照或上传化验单</span>
                    <ArrowRight size={14} />
                  </div>
                </div>

                {/* 2. Formula & Supplement Nutrition Facts */}
                <div
                  onClick={() => {
                    setVisionMode("formula");
                    visionInputRef.current?.click();
                  }}
                  className="p-4 rounded-2xl bg-gradient-to-br from-pink-50/80 to-rose-50/40 border border-pink-200/70 shadow-xs card-hover-lift cursor-pointer space-y-2.5 group"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 rounded-2xl bg-pink-500 text-white flex items-center justify-center shadow-xs group-hover:scale-110 transition-transform">
                      <Droplets size={20} />
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-100 text-pink-800 font-bold">
                      营养成分表
                    </span>
                  </div>
                  <div>
                    <h5 className="font-bold text-sm text-pink-950 group-hover:text-primary transition-colors">
                      配方奶粉 / 补剂包装表
                    </h5>
                    <p className="text-xs text-pink-900/80 mt-1 leading-relaxed">
                      识别奶粉或D3液体钙包装成分表，自动折算浓度与每日安全摄入上限 (UL)
                    </p>
                  </div>
                  <div className="pt-2 border-t border-pink-100 flex items-center justify-between text-xs font-bold text-primary">
                    <span>📷 拍照包装成分表</span>
                    <ArrowRight size={14} />
                  </div>
                </div>

                {/* 3. Food Plate & Ingredients */}
                <div
                  onClick={() => {
                    setVisionMode("food");
                    visionInputRef.current?.click();
                  }}
                  className="p-4 rounded-2xl bg-gradient-to-br from-amber-50/80 to-orange-50/40 border border-amber-200/70 shadow-xs card-hover-lift cursor-pointer space-y-2.5 group"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-xs group-hover:scale-110 transition-transform">
                      <UtensilsCrossed size={20} />
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">
                      辅食识别
                    </span>
                  </div>
                  <div>
                    <h5 className="font-bold text-sm text-amber-950 group-hover:text-amber-600 transition-colors">
                      辅食餐盘 / 食材性状识别
                    </h5>
                    <p className="text-xs text-amber-900/80 mt-1 leading-relaxed">
                      拍照宝宝辅食泥或手指食物，评估颗粒粗细、营养搭配及新食材过敏风险
                    </p>
                  </div>
                  <div className="pt-2 border-t border-amber-100 flex items-center justify-between text-xs font-bold text-amber-700">
                    <span>📷 拍照辅食餐盘</span>
                    <ArrowRight size={14} />
                  </div>
                </div>

                {/* 4. Skin Rash / Diaper Triage */}
                <div
                  onClick={() => {
                    setVisionMode("skin");
                    visionInputRef.current?.click();
                  }}
                  className="p-4 rounded-2xl bg-gradient-to-br from-purple-50/80 to-indigo-50/40 border border-purple-200/70 shadow-xs card-hover-lift cursor-pointer space-y-2.5 group"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 rounded-2xl bg-purple-500 text-white flex items-center justify-center shadow-xs group-hover:scale-110 transition-transform">
                      <ShieldCheck size={20} />
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-bold">
                      分诊指引
                    </span>
                  </div>
                  <div>
                    <h5 className="font-bold text-sm text-purple-950 group-hover:text-purple-600 transition-colors">
                      便便性状 / 皮肤红疹观察
                    </h5>
                    <p className="text-xs text-purple-900/80 mt-1 leading-relaxed">
                      辅助辨识大便颜色、奶瓣、红屁屁或轻微皮疹，获取护理要点与就医预警
                    </p>
                  </div>
                  <div className="pt-2 border-t border-purple-100 flex items-center justify-between text-xs font-bold text-purple-700">
                    <span>📷 拍照辅助观察</span>
                    <ArrowRight size={14} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===== TAB 4: 专科题库与提示词 (Specialist Topics & Prompt Library) ===== */}
          {activeTab === "topics" && (
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-transparent to-primary-light/10 animate-fade-in">
              <div>
                <h4 className="text-sm font-bold text-text-primary flex items-center gap-1.5">
                  <Lightbulb size={16} className="text-primary" />
                  <span>8 大专科临床问答锦囊</span>
                </h4>
                <p className="text-[11px] text-text-muted">点击任意问题，一键调取儿科专家深度解析与实操指导</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {TOPIC_PRESETS.map((t, idx) => {
                  const Icon = t.icon;
                  return (
                    <div key={idx} className="p-4 rounded-2xl bg-card border border-primary/15 shadow-xs space-y-2.5 card-hover-lift">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-xl bg-gradient-to-r ${t.color} text-white flex items-center justify-center shadow-xs`}>
                          <Icon size={15} />
                        </div>
                        <h5 className="font-bold text-xs sm:text-sm text-text-primary">{t.category}</h5>
                      </div>
                      <div className="space-y-1.5">
                        {t.prompts.map((p, pIdx) => (
                          <button
                            key={pIdx}
                            type="button"
                            onClick={() => handleSelectTopicPrompt(p, t.contextType)}
                            className="w-full text-left p-2 rounded-xl bg-primary-light/30 hover:bg-primary-light text-xs text-text-secondary hover:text-primary transition-all duration-150 flex items-start gap-1.5 group cursor-pointer btn-press"
                          >
                            <Sparkles size={12} className="text-primary shrink-0 mt-0.5 group-hover:scale-115 transition-transform" />
                            <span className="line-clamp-2 leading-relaxed">{p}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
