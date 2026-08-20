"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Share,
  PlusSquare,
  Smartphone,
  X,
  Sparkles,
  Bell,
  Zap,
} from "lucide-react";
import { CuteButton } from "./CuteButton";

interface InstallGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InstallGuideModal: React.FC<InstallGuideModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [mounted, setMounted] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "wechat" | "desktop">("ios");
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    setMounted(true);
    const ua = navigator.userAgent.toLowerCase();
    const isWechat = /micromessenger/.test(ua);
    const isIos = /iphone|ipad|ipod/.test(ua);
    const isAndroid = /android/.test(ua);

    if (isWechat) {
      setPlatform("wechat");
    } else if (isIos) {
      setPlatform("ios");
    } else if (isAndroid) {
      setPlatform("android");
    } else {
      setPlatform("desktop");
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  if (!isOpen || !mounted) return null;

  const handleNativeInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
      onClose();
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[999] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-md rounded-t-[32px] sm:rounded-3xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden animate-slide-up pb-[max(12px,env(safe-area-inset-bottom,0px))]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-divider flex items-center justify-between bg-gradient-to-r from-pink-50 via-rose-50 to-purple-50">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-primary text-white flex items-center justify-center shadow-button shrink-0">
              <Smartphone size={22} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">保存为手机桌面 App</h3>
              <p className="text-[11px] text-text-secondary">无广告 · 沉浸全屏 · 随时一键打开</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/80 flex items-center justify-center text-text-secondary hover:bg-white cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto space-y-4">
          {/* App Benefits Card */}
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2.5 rounded-2xl bg-pink-50/70 border border-pink-100 text-center">
              <Sparkles size={16} className="text-primary mx-auto mb-1" />
              <p className="text-xs font-bold text-text-primary">沉浸全屏</p>
              <p className="text-[10px] text-text-muted mt-0.5">隐藏浏览器地址栏</p>
            </div>
            <div className="p-2.5 rounded-2xl bg-sky-50 border border-sky-100 text-center">
              <Zap size={16} className="text-sky-500 mx-auto mb-1" />
              <p className="text-xs font-bold text-text-primary">秒速启动</p>
              <p className="text-[10px] text-text-muted mt-0.5">桌面点击直达记录</p>
            </div>
            <div className="p-2.5 rounded-2xl bg-purple-50 border border-purple-100 text-center">
              <Bell size={16} className="text-purple-500 mx-auto mb-1" />
              <p className="text-xs font-bold text-text-primary">喂养提醒</p>
              <p className="text-[10px] text-text-muted mt-0.5">疫苗与作息通知</p>
            </div>
          </div>

          {/* Platform Instructions */}
          {platform === "wechat" ? (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-3">
              <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                <span>⚠️ 微信内置浏览器提示</span>
              </div>
              <p className="text-xs text-amber-800 leading-relaxed">
                微信环境不支持直接生成桌面图标。请按以下步骤在系统浏览器中打开：
              </p>
              <div className="space-y-2 text-xs text-amber-900">
                <div className="flex items-center gap-2 bg-white/80 p-2 rounded-xl">
                  <span className="w-5 h-5 rounded-full bg-amber-500 text-white font-bold text-[11px] flex items-center justify-center">1</span>
                  <span>点击屏幕右上角的 <strong>···</strong> 菜单</span>
                </div>
                <div className="flex items-center gap-2 bg-white/80 p-2 rounded-xl">
                  <span className="w-5 h-5 rounded-full bg-amber-500 text-white font-bold text-[11px] flex items-center justify-center">2</span>
                  <span>选择 <strong>在 Safari / 浏览器中打开</strong></span>
                </div>
                <div className="flex items-center gap-2 bg-white/80 p-2 rounded-xl">
                  <span className="w-5 h-5 rounded-full bg-amber-500 text-white font-bold text-[11px] flex items-center justify-center">3</span>
                  <span>然后在浏览器中点击「添加到主屏幕」即可</span>
                </div>
              </div>
            </div>
          ) : platform === "ios" ? (
            <div className="space-y-2.5">
              <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                苹果 iPhone / iPad (Safari 浏览器) 添加步骤
              </h4>

              <div className="space-y-2">
                {/* Step 1 */}
                <div className="p-3 rounded-2xl bg-gray-50 border border-divider flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-primary-soft text-primary font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </div>
                  <div>
                    <p className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                      点击底部栏的「分享」按钮
                      <span className="inline-flex items-center justify-center p-1 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
                        <Share size={12} />
                      </span>
                    </p>
                    <p className="text-[10px] text-text-muted mt-0.5">
                      在 Safari 浏览器屏幕底部中央，找到方框带向上箭头的分享图标
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="p-3 rounded-2xl bg-gray-50 border border-divider flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-primary-soft text-primary font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </div>
                  <div>
                    <p className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                      在分享菜单中点击「添加到主屏幕」
                      <span className="inline-flex items-center justify-center p-1 rounded-md bg-gray-100 text-text-primary border border-divider">
                        <PlusSquare size={12} />
                      </span>
                    </p>
                    <p className="text-[10px] text-text-muted mt-0.5">
                      向下轻扫菜单列表，找到带加号的「添加到主屏幕」选项
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="p-3 rounded-2xl bg-gray-50 border border-divider flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-primary-soft text-primary font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </div>
                  <div>
                    <p className="text-xs font-bold text-text-primary">
                      点击右上角「添加」完成！
                    </p>
                    <p className="text-[10px] text-text-muted mt-0.5">
                      手机桌面上会出现可爱的宝宝专属图标，点击即进入原生全屏模式
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                安卓 / Chrome 浏览器添加步骤
              </h4>

              {deferredPrompt ? (
                <div className="p-4 rounded-2xl bg-pink-50 border border-primary/20 text-center space-y-3">
                  <p className="text-xs font-bold text-text-primary">
                    已检测到支持一键快速安装
                  </p>
                  <CuteButton
                    variant="primary"
                    size="md"
                    fullWidth
                    onClick={handleNativeInstall}
                    className="flex items-center justify-center gap-1.5"
                  >
                    <PlusSquare size={16} /> 立即一键添加到桌面
                  </CuteButton>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="p-3 rounded-2xl bg-gray-50 border border-divider flex items-start gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-primary-soft text-primary font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">1</span>
                    <div>
                      <p className="text-xs font-bold text-text-primary">点击浏览器右上角 ··· 菜单</p>
                      <p className="text-[10px] text-text-muted mt-0.5">打开浏览器功能设置菜单</p>
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl bg-gray-50 border border-divider flex items-start gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-primary-soft text-primary font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">2</span>
                    <div>
                      <p className="text-xs font-bold text-text-primary">选择「加到主屏幕」或「安装应用」</p>
                      <p className="text-[10px] text-text-muted mt-0.5">系统将自动在手机桌面生成专属 App 图标</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-gray-50 border-t border-divider flex items-center justify-between">
          <p className="text-[10px] text-text-muted">
            家庭页面可随时再次查看指引
          </p>
          <CuteButton size="sm" variant="primary" onClick={onClose}>
            我知道了
          </CuteButton>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
