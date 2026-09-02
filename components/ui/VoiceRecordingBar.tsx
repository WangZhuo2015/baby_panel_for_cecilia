"use client";

import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, X, Sparkles, Loader2 } from "lucide-react";

interface VoiceRecordingBarProps {
  recording: boolean;
  transcribing: boolean;
  stream: MediaStream | null;
  onStop: () => void;
  onCancel: () => void;
  hint?: string;
}

export const VoiceRecordingBar: React.FC<VoiceRecordingBarProps> = ({
  recording,
  transcribing,
  stream,
  onStop,
  onCancel,
  hint = "正在聆听中... 说完点击完成",
}) => {
  const [duration, setDuration] = useState(0);
  const [volumes, setVolumes] = useState<number[]>([0.2, 0.4, 0.6, 0.5, 0.7, 0.3, 0.5]);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // 录音计时器
  useEffect(() => {
    if (!recording) {
      setDuration(0);
      return;
    }
    const timer = setInterval(() => {
      setDuration((d) => d + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [recording]);

  // Web Audio 实时声波频谱采集
  useEffect(() => {
    if (!recording || !stream) {
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
      audioContextRef.current = null;
      analyserRef.current = null;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateWave = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        // 提取 7 个频段的能量值 (0.1 ~ 1.0)
        const step = Math.floor(bufferLength / 7) || 1;
        const newVolumes: number[] = [];
        for (let i = 0; i < 7; i++) {
          const raw = dataArray[i * step] || 0;
          // 平滑归一化并给基础高度
          const norm = Math.max(0.15, Math.min(1.0, raw / 180));
          newVolumes.push(norm);
        }
        setVolumes(newVolumes);
        animationFrameRef.current = requestAnimationFrame(updateWave);
      };

      updateWave();
    } catch {
      // AudioContext 失败时使用 CSS 自驱动 fallback
    }

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [recording, stream]);

  if (!recording && !transcribing) return null;

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="w-full flex items-center justify-between px-3.5 py-2.5 bg-gradient-to-r from-primary/10 via-pink-500/10 to-purple-500/10 dark:from-primary/20 dark:via-pink-500/20 dark:to-purple-500/20 backdrop-blur-md rounded-2xl border-2 border-primary/30 shadow-md animate-scale-in transition-all">
      {/* 左侧：录音状态 / 转写状态 */}
      <div className="flex items-center gap-2.5 min-w-0">
        {recording ? (
          <div className="relative flex items-center justify-center w-8 h-8 shrink-0">
            <div className="absolute inset-0 rounded-full bg-red-500/30 animate-[voiceRipple_1.5s_ease-out_infinite]" />
            <div className="w-3.5 h-3.5 rounded-full bg-red-500 shadow-sm animate-pulse" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-purple-500 flex items-center justify-center text-white shrink-0 shadow-xs animate-spin">
            <Sparkles size={16} />
          </div>
        )}

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-text-primary tracking-wide">
              {recording ? "语音录入中" : "AI 正在识别与解析"}
            </span>
            {recording && (
              <span className="px-1.5 py-0.5 rounded-md bg-red-100 dark:bg-red-950/50 text-[10px] font-mono font-bold text-red-600 dark:text-red-400">
                {formatTime(duration)}
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-muted truncate max-w-[170px] sm:max-w-xs">
            {recording ? hint : "正在高精转写并提取结构化指标…"}
          </p>
        </div>
      </div>

      {/* 中间：7 频段实时声波动效 (Equalizer Spectrum) */}
      {recording ? (
        <div className="flex items-center gap-1 px-2 h-7 shrink-0">
          {volumes.map((vol, idx) => {
            const heightPx = Math.round(vol * 24);
            return (
              <div
                key={idx}
                className="w-1 rounded-full bg-gradient-to-t from-primary via-pink-400 to-purple-400 transition-all duration-75"
                style={{
                  height: `${Math.max(4, heightPx)}px`,
                  opacity: Math.max(0.4, vol),
                }}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-xs text-primary font-medium shrink-0 animate-pulse px-2">
          <Loader2 size={14} className="animate-spin" />
          <span>处理中</span>
        </div>
      )}

      {/* 右侧：操作按钮组 */}
      <div className="flex items-center gap-1.5 shrink-0">
        {recording && (
          <>
            <button
              type="button"
              onClick={onCancel}
              className="p-1.5 rounded-xl text-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all cursor-pointer"
              title="取消录音"
            >
              <X size={16} />
            </button>
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-primary to-pink-500 text-white text-xs font-bold shadow-button hover:opacity-95 active:scale-95 transition-all cursor-pointer btn-spring"
              title="完成并识别"
            >
              <Square size={12} className="fill-white" />
              <span>完成</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
