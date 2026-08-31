"use client";

import React, { useCallback, useRef, useState } from "react";
import { Loader2, Mic, Square, X } from "lucide-react";
import { AiActionCard, type ActionCardData } from "@/components/ui/AiActionCard";
import { useToast } from "@/components/ui/Toast";
import { useBabyStore } from "@/stores/useBabyStore";

interface VoiceConfirmEntryProps {
  contextType: "feeding" | "sleep" | "diaper" | "food" | "growth" | "medical";
}

export function VoiceConfirmEntry({ contextType }: VoiceConfirmEntryProps) {
  const { showToast } = useToast();
  const baby = useBabyStore((s) => s.baby);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<"transcribe" | "parse" | null>(null);
  const [transcript, setTranscript] = useState("");
  const [actions, setActions] = useState<ActionCardData[]>([]);
  const [open, setOpen] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === "recording") mr.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
  }, []);

  const parseText = async (text: string) => {
    setBusy("parse");
    try {
      const res = await fetch("/api/ai/parse-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, contextType, babyId: baby?.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "整理失败");
      const list = Array.isArray(data.actions) ? data.actions : [];
      setTranscript(text);
      setActions(list);
      setOpen(true);
      if (list.length === 0) {
        showToast("听清了，但没整理出可保存的记录，请手动填写");
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "整理记录失败");
    } finally {
      setBusy(null);
    }
  };

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
        setBusy("transcribe");
        try {
          const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
          if (blob.size < 800) throw new Error("录音太短");
          const fd = new FormData();
          fd.append("audio", blob, `voice${mime.includes("mp4") ? ".m4a" : ".webm"}`);
          const res = await fetch("/api/asr/transcribe", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || "识别失败");
          await parseText(String(data.text || "").trim());
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : "语音识别失败");
          setBusy(null);
        }
      };
      mr.start(250);
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {
      showToast("无法访问麦克风，请检查权限");
    }
  };

  const toggle = () => {
    if (busy) return;
    if (recording) stopRecording();
    else void startRecording();
  };

  const close = () => {
    setOpen(false);
    setActions([]);
    setTranscript("");
  };

  const busyLabel =
    busy === "transcribe" ? "正在听写…" : busy === "parse" ? "正在整理成记录…" : null;

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={Boolean(busy)}
        className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl border shadow-2xs text-left transition-colors ${
          recording
            ? "bg-red-50 border-red-200 text-red-700"
            : "bg-white/70 border-primary/20 text-text-primary"
        }`}
      >
        <span
          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
            recording ? "bg-red-500 text-white animate-pulse" : "bg-primary-soft text-primary"
          }`}
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : recording ? <Square size={16} /> : <Mic size={18} />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">
            {recording ? "正在听… 再点一下结束" : busyLabel || "语音录入"}
          </span>
          <span className="block text-[11px] text-text-muted mt-0.5">
            说完后会弹出卡片，确认才写入档案
          </span>
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="确认语音记录"
        >
          <div
            className="w-full max-w-md bg-white dark:bg-[#1E171E] text-text-primary dark:text-gray-100 rounded-t-3xl sm:rounded-3xl max-h-[85vh] overflow-y-auto p-4 pb-[max(16px,env(safe-area-inset-bottom))] shadow-2xl border border-primary/20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-text-primary">确认后保存</p>
                {transcript && (
                  <p className="text-xs text-text-muted mt-1 leading-relaxed">「{transcript}」</p>
                )}
              </div>
              <button
                type="button"
                onClick={close}
                className="w-8 h-8 rounded-full bg-primary-soft/40 text-text-muted flex items-center justify-center shrink-0"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>
            {actions.length === 0 ? (
              <p className="text-xs text-text-muted py-6 text-center">没有可确认的记录，请改用下方表单手动填写。</p>
            ) : (
              actions.map((action, i) => (
                <AiActionCard key={`${action.type}-${i}`} action={action} />
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
