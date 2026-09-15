/**
 * MCP Tools Chinese Label & Category Mapping
 * 用于在 AI 连接面板与访问审计日志中展示清晰、易懂的中文操作说明与分类
 */

export interface ToolMeta {
  label: string;
  category: "read" | "write" | "manage";
  description: string;
}

export const MCP_TOOL_METAS: Record<string, ToolMeta> = {
  // 基础档案与身份
  get_current_user: {
    label: "获取当前操作者身份",
    category: "read",
    description: "查询当前调用 AI 的家长姓名、家庭角色与操作权限",
  },
  get_baby_profile: {
    label: "获取宝宝档案与月龄",
    category: "read",
    description: "查询宝宝姓名、性别、出生日期、矫正月龄等基本信息",
  },
  get_daily_summary: {
    label: "获取当日育儿看板概览",
    category: "read",
    description: "获取宝宝今天的喂养、睡眠、尿布及辅食聚合统计数据",
  },

  // 喂养记录
  get_feeding_records: {
    label: "查询喂养记录",
    category: "read",
    description: "查询母乳亲喂、瓶喂奶粉或辅食的历史记录列表",
  },
  record_feeding: {
    label: "记录喂养",
    category: "write",
    description: "录入母乳、配方奶或辅食喂养记录",
  },

  // 睡眠记录
  get_sleep_records: {
    label: "查询睡眠记录",
    category: "read",
    description: "查询宝宝入睡时间、醒来时间及睡眠时长列表",
  },
  record_sleep: {
    label: "记录睡眠",
    category: "write",
    description: "录入宝宝一段睡眠或小睡记录",
  },

  // 换尿布记录
  get_diaper_records: {
    label: "查询换尿布记录",
    category: "read",
    description: "查询嘘嘘、便便及便便颜色性状的历史记录",
  },
  record_diaper: {
    label: "记录换尿布",
    category: "write",
    description: "录入一次换尿布记录（小便/大便/颜色/状态）",
  },

  // 辅食与计划
  get_food_records: {
    label: "查询辅食记录",
    category: "read",
    description: "查询宝宝每日辅食打卡与食材过敏反应记录",
  },
  record_food: {
    label: "记录辅食喂食",
    category: "write",
    description: "录入宝宝尝试新食材或辅食餐次记录",
  },
  get_food_plans: {
    label: "查询辅食排敏计划",
    category: "read",
    description: "查询宝宝的辅食引入规划与排敏阶段安排",
  },
  record_food_plan: {
    label: "记录辅食引入计划",
    category: "write",
    description: "为宝宝制定并添加新的辅食食材排敏计划",
  },

  // 别名兼容
  get_food_logs: {
    label: "查询辅食记录",
    category: "read",
    description: "查询宝宝每日辅食打卡与食材过敏反应记录",
  },
  record_food_log: {
    label: "记录辅食喂食",
    category: "write",
    description: "录入宝宝尝试新食材或辅食餐次记录",
  },
  create_food_plan: {
    label: "记录辅食引入计划",
    category: "write",
    description: "为宝宝制定并添加新的辅食食材排敏计划",
  },

  // 营养补充剂
  get_supplement_records: {
    label: "查询营养品补充记录",
    category: "read",
    description: "查询维生素 D3、AD、铁剂、DHA 等补充记录",
  },
  record_supplement: {
    label: "记录营养品补充",
    category: "write",
    description: "打卡录入一次维生素或营养补充剂喂服",
  },

  // 生长发育
  get_growth_records: {
    label: "查询生长测量与WHO曲线",
    category: "read",
    description: "查询宝宝身高、体重、头围等生长测量记录与百分位",
  },
  record_growth: {
    label: "记录身高体重测量",
    category: "write",
    description: "录入最新的身高、体重或头围测量数值",
  },
  get_developmental_milestones: {
    label: "查询发育里程碑",
    category: "read",
    description: "根据月龄查询大运动、精细动作、语言认知发育进度",
  },

  // 医疗与体检
  get_medical_reports: {
    label: "查询体检与医学化验单",
    category: "read",
    description: "查询儿科门诊病历、血常规等化验单及儿保体检表",
  },
  get_medical_report_detail: {
    label: "查询体检化验单详情",
    category: "read",
    description: "获取单份医学检验报告的具体检测项目与医生诊断",
  },
  record_medical_report: {
    label: "录入体检或化验单",
    category: "write",
    description: "录入儿保体检记录、血常规/微量元素等化验指标",
  },

  // 疫苗接种
  get_vaccine_records: {
    label: "查询疫苗接种记录",
    category: "read",
    description: "查询宝宝已完成接种的疫苗明细与针次",
  },
  get_vaccine_schedule: {
    label: "查询疫苗推荐接种计划",
    category: "read",
    description: "查询 0-3 岁一类/二类疫苗规划及待接种日程",
  },
  get_vaccine_schedules: {
    label: "查询疫苗推荐接种计划",
    category: "read",
    description: "查询 0-3 岁一类/二类疫苗规划及待接种日程",
  },
  record_vaccine: {
    label: "记录疫苗接种",
    category: "write",
    description: "标记并录入某针疫苗的接种完成信息",
  },
  record_vaccine_inoculation: {
    label: "记录疫苗接种",
    category: "write",
    description: "标记并录入某针疫苗的接种完成信息",
  },

  // 照片与多媒体
  get_baby_photos: {
    label: "查询宝宝照片与图集",
    category: "read",
    description: "获取宝宝生活照、体检化验单照片及生长曲线图",
  },

  // 早教与知识库查询
  query_food_item: {
    label: "查询食材与过敏安全库",
    category: "read",
    description: "查询单一食材月龄建议、营养成分与窒息/过敏风险",
  },
  query_book: {
    label: "查询适龄早教绘本",
    category: "read",
    description: "查询适龄儿童经典绘本、评分与亲子共读互动指引",
  },
  query_activity: {
    label: "查询早教游戏与亲子互动",
    category: "read",
    description: "查询适龄感统运动、语言认知游戏与发展建议",
  },
  web_search: {
    label: "联网检索权威儿科信息",
    category: "read",
    description: "在权威儿科与医学知识源中搜索最新育儿指南",
  },

  // 安全删除与快照恢复
  delete_record: {
    label: "安全删除记录 (备份快照)",
    category: "manage",
    description: "软删除指定记录，并在快照库自动保留完整备份以便回滚",
  },
  restore_record: {
    label: "从快照恢复记录",
    category: "manage",
    description: "根据快照 ID 一键撤销删除，原样恢复被误删的数据",
  },

  // 兼容旧版复合工具
  get_baby_overview: {
    label: "获取宝宝综合总览 (旧版)",
    category: "read",
    description: "旧版多维度聚合概览接口",
  },
  record_baby_events: {
    label: "批量记录育儿事件 (旧版)",
    category: "write",
    description: "旧版批量事件录入接口",
  },
  record_health_measurement: {
    label: "记录健康测量 (旧版)",
    category: "write",
    description: "旧版体温与生长测量录入接口",
  },
  query_parenting_knowledge: {
    label: "查询育儿科学知识库",
    category: "read",
    description: "查询权威儿科医学与育儿指南知识",
  },
};

/**
 * 获取工具的中文显示名称与分类
 */
export function getToolMeta(toolName?: string | null): ToolMeta {
  if (!toolName) {
    return {
      label: "未指定工具",
      category: "read",
      description: "未知工具调用",
    };
  }
  return (
    MCP_TOOL_METAS[toolName] || {
      label: toolName,
      category: toolName.startsWith("record_") || toolName.startsWith("create_") ? "write" : "read",
      description: `调用工具 ${toolName}`,
    }
  );
}

/**
 * 将 action 转换为可读中文
 */
export function getActionLabel(action: string): string {
  switch (action) {
    case "mcp_tool_call":
      return "调用 MCP 工具";
    case "token_issue":
      return "获取访问令牌 (Token)";
    case "token_refresh":
      return "刷新访问令牌";
    case "token_revoke":
      return "撤销访问令牌";
    case "authorize":
      return "授权 AI 客户端";
    case "client_register":
      return "注册 AI 客户端";
    default:
      return action;
  }
}
