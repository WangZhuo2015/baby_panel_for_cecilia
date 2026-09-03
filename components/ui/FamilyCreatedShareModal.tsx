"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles,
  Copy,
  Check,
  Link as LinkIcon,
  Share2,
  Users,
  ArrowRight,
  BellRing,
} from "lucide-react";
import { CuteButton } from "./CuteButton";
import { useToast } from "./Toast";
import { NotificationPromptCard } from "@/components/onboarding/NotificationPromptCard";

interface FamilyCreatedShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  babyName: string;
  familyName?: string;
  inviteCode?: string;
}

export function FamilyCreatedShareModal({
  isOpen,
  onClose,
  babyName,
  familyName,
  inviteCode,
}: FamilyCreatedShareModalProps) {
  const { showToast } = useToast();
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);

  if (!isOpen) return null;

  const getInviteUrl = () => {
    if (typeof window === "undefined" || !inviteCode) return "";
    return `${window.location.origin}/register?invite=${inviteCode}`;
  };

  const handleCopyLink = () => {
    const url = getInviteUrl();
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    showToast("专属加入链接已复制 ✨ 发给家人点击即可加入", "success");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyText = () => {
    const url = getInviteUrl();
    if (!url) return;
    const text = `🍼 快来加入【${babyName || "宝宝"}】的家庭育儿空间！点击专属链接直接加入，全家一起记录喂奶、睡眠与成长健康：\n${url}`;
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    showToast("邀请文案已复制 💌 可直接发送到家庭微信群", "success");
    setTimeout(() => setCopiedText(false), 2000);
  };

  const handleCopyCode = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    setCopiedCode(true);
    showToast("6 位邀请码已复制 📋", "success");
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const modalContent = (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[999] flex items-center justify-center p-4 animate-fade-in select-none">
      <div
        className="bg-white dark:bg-[#1E171E] text-text-primary dark:text-gray-100 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-slide-up border border-primary/20 p-5 space-y-3.5 text-center max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-primary to-pink-500 text-white mx-auto flex items-center justify-center shadow-button">
          <Users size={26} />
        </div>

        <div>
          <h3 className="text-base font-bold text-text-primary flex items-center justify-center gap-1.5">
            家庭育儿空间创建成功！
            <Sparkles size={16} className="text-primary" />
          </h3>
          <p className="text-xs text-text-secondary mt-0.5">
            已为【{babyName || "宝宝"}】建档完毕，快邀请其他家长一起协同
          </p>
        </div>

        {/* 专属链接与邀请码卡片 */}
        <div className="bg-primary-soft/40 dark:bg-card/80 rounded-2xl p-3 border border-primary/20 text-left space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-secondary font-medium">家庭专属邀请码</span>
            <button
              type="button"
              onClick={handleCopyCode}
              className="text-xs font-mono font-bold text-primary flex items-center gap-1 hover:underline cursor-pointer"
            >
              <span>{inviteCode || "------"}</span>
              {copiedCode ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>

          <div className="pt-2 border-t border-divider/60 space-y-2">
            <CuteButton
              size="sm"
              variant="primary"
              onClick={handleCopyLink}
              className="w-full justify-center text-xs"
            >
              {copiedLink ? <Check size={14} className="mr-1.5" /> : <LinkIcon size={14} className="mr-1.5" />}
              {copiedLink ? "专属链接已复制" : "复制专属邀请链接"}
            </CuteButton>

            <CuteButton
              size="sm"
              variant="secondary"
              onClick={handleCopyText}
              className="w-full justify-center text-xs"
            >
              {copiedText ? <Check size={14} className="mr-1.5" /> : <Share2 size={14} className="mr-1.5" />}
              {copiedText ? "邀请文案已复制" : "复制微信邀请文案"}
            </CuteButton>

          </div>
        </div>

        {/* 推荐开启通知组件 */}
        <NotificationPromptCard />

        <div className="pt-1">
          <CuteButton
            size="md"
            variant="secondary"
            onClick={onClose}
            className="w-full justify-center font-bold text-xs"
          >
            <span>进入今日看板开始记录</span>
            <ArrowRight size={14} className="ml-1" />
          </CuteButton>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : null;
}
