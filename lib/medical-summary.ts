export interface SummaryItem {
  name?: string;
  value?: string | number;
  unit?: string;
  referenceRange?: string;
  status?: string;
  interpretation?: string;
}

const ABNORMAL = new Set(["high", "low", "abnormal", "positive"]);
const DISCLAIMER =
  "以上分析仅供家长参考，不能替代医生面诊；如宝宝有发热、精神差等症状请及时就医。";

/** If the model left aiSummary empty, stitch Markdown from item interpretations. */
export function composeMedicalAiSummary(items: SummaryItem[]): string {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return "";

  const unknown = list.filter(i=>!i.status || i.status === "unknown");
  const abnormal = list.filter((i) => ABNORMAL.has(String(i.status || "")));
  const bullets = (abnormal.length ? abnormal : []).map((i) => {
    const interp = String(i.interpretation || "").trim();
    const value = `${i.value ?? ""}${i.unit ? String(i.unit) : ""}`.trim();
    const range = i.referenceRange || "—";
    const head = `**${i.name || "指标"}** \`${value}\`（参考 ${range}）`;
    return interp ? `- ${head}：${interp}` : `- ${head}`;
  });

  const lines = [
    "## 总体印象",
    abnormal.length > 0
      ? `本次共识别 **${list.length}** 项，其中 **${abnormal.length}** 项相对单据参考区间有偏离，优先结合月龄与症状理解，不必单独看到箭头就紧张。`
      : unknown.length > 0 ? `本次共识别 **${list.length}** 项，其中 **${unknown.length}** 项的印刷标记或参考范围尚未确认，不能据此判断正常或异常。` : `本次共识别 **${list.length}** 项，相对单据印刷参考区间未见明显偏离。`,
  ];

  if (bullets.length > 0) {
    lines.push("", "## 需要关注", ...bullets);
  }

  lines.push("", "## 复查与就医", DISCLAIMER);
  return lines.join("\n");
}
