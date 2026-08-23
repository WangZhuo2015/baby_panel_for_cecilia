"use client";

import React, { useState, useEffect, useRef } from "react";
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
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import { useBabyStore } from "@/stores/useBabyStore";
import { calculateAge } from "@/lib/age";
import { AiActionCard, ActionCardData } from "@/components/ui/AiActionCard";

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

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string;
  timestamp: string;
  isStreaming?: boolean;
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
function extractActionAndCleanMarkdown(content: string): { cleanText: string; action: ActionCardData | null } {
  const actionRegex = /```(?:json:action|action)\s*([\s\S]*?)\s*```/;
  const match = content.match(actionRegex);

  if (!match) {
    return { cleanText: content, action: null };
  }

  const rawJson = match[1].trim();
  let action: ActionCardData | null = null;
  try {
    action = JSON.parse(rawJson);
  } catch {
    // If incomplete JSON during streaming, ignore
  }

  // Remove the action code block from visible markdown
  const cleanText = content.replace(actionRegex, "").trim();
  return { cleanText, action };
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
  const [inputText, setInputText] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      if (messages.length === 0) {
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
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, loading, isOpen]);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      alert("图片大小不能超过 15MB");
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
      if (!res.ok) throw new Error("上传失败");
      const data = await res.json();
      setSelectedImage(data.imageUrl);
    } catch {
      // Fallback to local data URL
      const reader = new FileReader();
      reader.onload = () => setSelectedImage(reader.result as string);
      reader.readAsDataURL(file);
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || inputText).trim();
    const currentImg = selectedImage;
    if ((!query && !currentImg) || loading) return;

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
      const history = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    } catch (e: any) {
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
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      {/* Backdrop with soft blur */}
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Sheet / Modal Container - Full screen on mobile, elegant dialog on desktop */}
      <div className="relative w-full max-w-lg bg-gradient-to-b from-white via-[#FAF7F5] to-[#F5F0EB] h-[100dvh] sm:h-[680px] max-h-[100dvh] sm:max-h-[90vh] rounded-none sm:rounded-[28px] shadow-2xl overflow-hidden flex flex-col border-0 sm:border sm:border-primary/15 animate-in slide-in-from-bottom-6 duration-200 z-10">
        
        {/* Header - Frosted pastel navbar with notch safe area */}
        <div className="flex items-center justify-between px-4 py-3 pt-[max(12px,env(safe-area-inset-top))] bg-white/95 backdrop-blur-md border-b border-primary/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-primary to-pink-500 text-white flex items-center justify-center text-lg shadow-sm shadow-primary/25">
              {meta.emoji}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-text-primary text-sm sm:text-base">
                  {displayTitle}
                </h3>
                <span className="text-[10px] bg-primary-light text-primary px-2 py-0.5 rounded-full font-semibold">
                  Hermes 多模态 AI
                </span>
              </div>
              <p className="text-[11px] text-text-muted flex items-center gap-1 mt-0.5">
                <span className="font-medium text-text-secondary">{baby?.nickname || "宝宝"}</span>
                <span>·</span>
                <span>{age.label}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-primary-soft/40 hover:bg-primary-soft text-text-muted hover:text-text-primary flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

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
              className="text-xs bg-white text-text-secondary hover:text-primary hover:bg-primary-light/50 border border-primary/15 rounded-full px-3 py-1.5 shrink-0 shadow-xs transition-all active:scale-95 text-left flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
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
            const isThinking = !isUser && m.isStreaming && !m.content;
            const { cleanText, action } = !isUser ? extractActionAndCleanMarkdown(m.content) : { cleanText: m.content, action: null };

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
                      ? "bg-gradient-to-r from-primary to-pink-500 text-white rounded-tr-xs shadow-primary/20"
                      : "bg-white text-text-primary rounded-tl-xs border border-primary/10 shadow-slate-200/50"
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
                    /* Assistant Rich Markdown Rendering + Action Card */
                    <div className="space-y-2">
                      <div className="markdown-content space-y-2">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
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

                      {/* Interactive Action Card if extracted */}
                      {action && <AiActionCard action={action} />}
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
        <div className="p-3 pb-[max(14px,env(safe-area-inset-bottom))] bg-white border-t border-primary/15 flex flex-col gap-2 shrink-0 shadow-[0_-4px_16px_rgba(0,0,0,0.04)] z-20">
          
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
                className="w-5 h-5 rounded-full bg-primary/20 text-primary hover:bg-primary/30 flex items-center justify-center cursor-pointer"
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
  );
};
