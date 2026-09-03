"use client";

import React, { useState } from "react";
import {
  Baby,
  TrendingUp,
  UtensilsCrossed,
  ShieldCheck,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Volume2,
  Clock,
  HeartHandshake,
} from "lucide-react";

export interface FeatureTourItem {
  id: string;
  badge: string;
  badgeColor: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accentColor: string;
  points: {
    title: string;
    desc: string;
    icon?: React.ComponentType<{ size?: number; className?: string }>;
  }[];
  tip?: string;
}

export const TOUR_FEATURES: FeatureTourItem[] = [
  {
    id: "daily_records",
    badge: "极速就地记录",
    badgeColor: "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
    title: "高频育儿事件，随时随手秒记",
    subtitle: "针对母乳、配方奶、睡眠与换尿布深度优化，支持长辈语音与抽屉快速录入",
    icon: Baby,
    accentColor: "from-blue-500/20 to-sky-500/10",
    points: [
      {
        title: "专业喂养细分",
        desc: "支持母乳左右计时、瓶喂母乳、配方奶智能浓度折算与防呛吐奶标记。",
        icon: Clock,
      },
      {
        title: "实时睡眠与尿布记录",
        desc: "一键睡眠计时或醒后补记，排泄便便性状、颜色与健康异常提示。",
        icon: CheckCircle2,
      },
      {
        title: "双模响应与误触撤回",
        desc: "手机端极简大按钮；iPad/电脑宽屏抽屉录入；误记可就地编辑与快照恢复。",
        icon: HeartHandshake,
      },
    ],
    tip: "小技巧：抱娃单手不便时，点底部 AI 助手直接说「喂了100ml奶」即可自动入库。",
  },
  {
    id: "who_growth",
    badge: "权威健康标准",
    badgeColor: "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
    title: "WHO 儿童生长曲线 & 纠正月龄",
    subtitle: "拒绝同龄盲目比较与盲目焦虑，科学掌握宝宝的专属成长轨迹",
    icon: TrendingUp,
    accentColor: "from-emerald-500/20 to-teal-500/10",
    points: [
      {
        title: "WHO 国际标准对标",
        desc: "身高、体重、头围、BMI 对标 WHO P3~P97 百分位区间与 Z 评分。",
        icon: CheckCircle2,
      },
      {
        title: "早产儿纠正月龄自适应",
        desc: "早产宝宝（<37周）系统基于出生孕周自动换算纠正月龄与发育里程碑。",
        icon: Clock,
      },
      {
        title: "动态生长轨迹",
        desc: "每次体检或家测数据生成平滑曲线，精准识别追赶生长与发育偏移。",
        icon: Sparkles,
      },
    ],
    tip: "科学育儿：只要宝宝沿着自己的百分位曲线稳步增长，就是最好的发育节奏。",
  },
  {
    id: "food_nutrition",
    badge: "科学营养引擎",
    badgeColor: "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
    title: "阶梯辅食排敏与 DRIs 全量营养",
    subtitle: "从第一口高铁米粉到全营养平衡，对标国家卫健委 WS/T 578 标准",
    icon: UtensilsCrossed,
    accentColor: "from-amber-500/20 to-orange-500/10",
    points: [
      {
        title: "阶梯辅食库与防呛噎",
        desc: "按月龄提供辅食引入次序、性状处理指南、过敏源排查日记与安全食谱。",
        icon: CheckCircle2,
      },
      {
        title: "DRIs 全量营养素计算",
        desc: "将配方奶成分 + 辅食营养 + 维生素D3/钙铁锌等补剂全量聚合核算。",
        icon: Sparkles,
      },
      {
        title: "防过量冲突守护",
        desc: "实时对比推荐摄入量（RNI/AI），超过可耐受最高摄入量（UL）时主动警报。",
        icon: HeartHandshake,
      },
    ],
    tip: "营养安全：补剂与不同品牌奶粉的维生素叠加会自动核算，防止重叠超标。",
  },
  {
    id: "vaccines_ai",
    badge: "全天候守护",
    badgeColor: "bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800",
    title: "0-3岁疫苗日程 & AI 验单识别",
    subtitle: "一类免费与二类自费全覆盖，多模态拍照读取医院化验单",
    icon: ShieldCheck,
    accentColor: "from-purple-500/20 to-pink-500/10",
    points: [
      {
        title: "智能疫苗日历",
        desc: "依实际生日推算一类与二类疫苗窗口期，打针前禁忌提醒与接种后反应记录。",
        icon: Clock,
      },
      {
        title: "多模态 OCR 验单识别",
        desc: "拍照上传医院血常规、微量元素、尿常规，AI 智能提取指标并标注参考区间。",
        icon: Sparkles,
      },
      {
        title: "晚间 AI 复盘日报",
        desc: "每晚结合今日摄入、睡眠与活动，自动生成温暖的育儿总结与专属照护提示。",
        icon: Volume2,
      },
    ],
    tip: "家庭共享：全家多人设备实时同步，宝爸、爷爷奶奶、姥姥姥爷随时查看最新动态。",
  },
];

interface FeatureTourCardsProps {
  onComplete?: () => void;
  showCompleteButton?: boolean;
  completeButtonText?: string;
}

export function FeatureTourCards({
  onComplete,
  showCompleteButton = false,
  completeButtonText = "开始使用",
}: FeatureTourCardsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const current = TOUR_FEATURES[currentIndex];
  const Icon = current.icon;

  const handleNext = () => {
    if (currentIndex < TOUR_FEATURES.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else if (onComplete) {
      onComplete();
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  return (
    <div className="flex flex-col h-full select-none">
      {/* 顶部标签切换器（带横向滑动视觉渐变提示） */}
      <div className="relative mb-2">
        <div className="flex items-center gap-1.5 pb-2.5 border-b border-divider/60 overflow-x-auto no-scrollbar pr-6">
          {TOUR_FEATURES.map((item, idx) => {
            const isActive = idx === currentIndex;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCurrentIndex(idx)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap cursor-pointer shrink-0 ${
                  isActive
                    ? "bg-primary text-white shadow-soft font-bold scale-[1.02]"
                    : "bg-gray-100 text-text-secondary hover:bg-gray-200 dark:bg-card dark:text-gray-300"
                }`}
              >
                {idx + 1}. {item.badge}
              </button>
            );
          })}
        </div>
        <div className="pointer-events-none absolute right-0 top-0 bottom-2.5 w-6 bg-gradient-to-l from-white dark:from-[#1E171E] to-transparent opacity-90" />
      </div>


      {/* 主卡片内容区 */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-4">
        {/* 卡片头部 */}
        <div className={`p-4 rounded-3xl bg-gradient-to-br ${current.accentColor} border border-divider/40`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className={`inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full border mb-1.5 ${current.badgeColor}`}>
                {current.badge}
              </span>
              <h3 className="text-base font-bold text-text-primary">
                {current.title}
              </h3>
              <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                {current.subtitle}
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-white dark:bg-card shadow-soft flex items-center justify-center text-primary shrink-0">
              <Icon size={26} />
            </div>
          </div>
        </div>

        {/* 亮点条目清单 */}
        <div className="space-y-2.5">
          {current.points.map((pt, i) => {
            const PtIcon = pt.icon || CheckCircle2;
            return (
              <div
                key={i}
                className="p-3 rounded-2xl bg-gray-50 dark:bg-card/70 border border-divider/60 flex items-start gap-3 transition-colors hover:bg-white dark:hover:bg-card"
              >
                <div className="w-7 h-7 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0 mt-0.5">
                  <PtIcon size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-bold text-text-primary">
                    {pt.title}
                  </h4>
                  <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed">
                    {pt.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* 贴心提示 */}
        {current.tip && (
          <div className="p-3 rounded-2xl bg-primary-soft/40 border border-primary/20 text-xs text-primary leading-relaxed flex items-start gap-2">
            <Sparkles size={15} className="shrink-0 mt-0.5 text-primary" />
            <span>{current.tip}</span>
          </div>
        )}
      </div>

      {/* 底部导航控制器 */}
      <div className="pt-4 mt-2 border-t border-divider flex items-center justify-between">
        {/* 指示圆点 */}
        <div className="flex items-center gap-1.5">
          {TOUR_FEATURES.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentIndex(idx)}
              className={`h-2 rounded-full transition-all duration-300 ${
                idx === currentIndex
                  ? "w-6 bg-primary"
                  : "w-2 bg-divider hover:bg-text-muted"
              }`}
              aria-label={`切换到第 ${idx + 1} 页`}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          {currentIndex > 0 && (
            <button
              type="button"
              onClick={handlePrev}
              className="p-2 rounded-xl border border-divider hover:bg-gray-100 dark:hover:bg-card text-text-secondary cursor-pointer"
              aria-label="上一页"
            >
              <ChevronLeft size={18} />
            </button>
          )}

          {currentIndex < TOUR_FEATURES.length - 1 ? (
            <button
              type="button"
              onClick={handleNext}
              className="flex items-center gap-1 px-4 py-2 rounded-xl bg-primary text-white font-bold text-xs shadow-soft hover:opacity-95 active:scale-95 transition-all cursor-pointer"
            >
              <span>下一页</span>
              <ChevronRight size={15} />
            </button>
          ) : showCompleteButton ? (
            <button
              type="button"
              onClick={onComplete}
              className="flex items-center gap-1 px-5 py-2 rounded-xl bg-primary text-white font-bold text-xs shadow-button hover:opacity-95 active:scale-95 transition-all cursor-pointer"
            >
              <span>{completeButtonText}</span>
              <Sparkles size={14} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
