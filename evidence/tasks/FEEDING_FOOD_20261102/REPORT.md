# 奶量与常吃菜改进

任务：FEEDING_FOOD_20261102。实现登记：`IMPLEMENTED_NOT_REVIEWED`。
独立复核范围和结果见 REVIEW.md。合并与部署结果单独记录，不标记整个产品 ACCEPTED。

用户授权：完成奶量 5 ml 进位、常吃菜分类、更多肉类/海鲜及多选，合入 main 并部署。

## 改动

- 配方奶、瓶喂母乳、混合喂养的配方部分和亲喂手动修正每次增减 5 ml。
  保存的历史数值不取整，0 ml 可以正确回显，微调范围为 0–3000 ml。
- 新增九类常吃菜：谷物主食、薯类根茎、肉禽、鱼虾海鲜、蛋豆、蔬菜菌菇、
  水果、乳制品、辅食油。包括鳕鱼、鲈鱼、黄花鱼、虾、羊肉和鸭肉等。
- 同一餐可跨分类、同分类多选，每项可单独调整克数或移除；自定义食材可选品类。
  点选公共菜品只选择本餐，不会写入“已尝试”。自定义添加沿用显式入库行为。
- 保留线上已有滚轮和克数；编辑旧记录不追加默认菜品，不丢未知菜名、多项同类
  components、历史份量。按名称保持滚轮选择，避免异步食材库加载后错选。
- 补齐 main 尚缺的线上滚轮、组件类型和克数持久化前置；foods 优先于组件回退，
  使无克数的旧菜名可以与带克数组件共存。使用原 notes envelope，无数据库迁移。

## 基线与隔离

Web 原工作区：`/home/ubuntu/Github/baby_panel_for_cecilia`，
`codex/llm-feature-preferences`，HEAD `7a781995e3aee62e82fe45dd0db691a7e6be622f`。
其大量既有未提交文件保持原样。服务端原工作区也保留原有未提交内容。

功能 worktree：`/tmp/growdesk-feeding-food-20261102`，
`codex/feeding-food-options-20261102`，基于最新 origin/main
`ac498ea1bca6ac98d8006f5d873fb7230dd991d6`。

线上源码与 main 原先并不完全一致。发布候选从上次已部署的公开源码哈希清单
建立，只覆盖 source-manifest.json 中七个明确 donor；保留现网其他功能。
将合并的干净代码树和实际发布候选分别完整构建，不将两者冒充为同一棵源码树。

未读取生产环境文件、profile 或密钥；未测试连接生产数据库、旧 SQLite 或真实家庭；
无外部付费调用、真实推送和合成生产记录。浏览器使用内存 test_ 账号/家庭/宝宝与
实际 React 表单，只在 127.0.0.2:3089 监听；未占用原有 127.0.0.1:3089。
AI 弹窗在组件 harness 中未加载；这不是 AI、事务或授权的验收。

## 验证

- 最终类型检查通过；42/42 菜品定向回归通过，0 skip。
- 真实组件浏览器交互通过：各模式 5 ml、零值/边界、九类跨类多选、克数/取消、
  自定义 category、旧多组件/未知名称、异步目录插入和重排、超限阻止提交。
- 变更文件 lint exit 0；存在继承代码的 any/Fast Refresh/hook 依赖警告。
- 发布 helper 在真实临时目录拒绝私有环境文件、产物篡改和逃逸链接；不涉及服务变更。
- 最终 main/release 完整 Next webpack 构建均通过，见 main-build-clean-deps.json
  与 release-build-verified.json；实际冻结包另做隔离 standalone 启动检查。

失败证据保留：最初类型检查发现隐式 any；早期 browser 运行遇到已占用测试地址和
未匹配的浏览器默认路径，改用独立 loopback 和主机已安装 Chromium。早期表单测试
发现旧版 edit 丢失多项，随后修复并完整重跑。main 的一次缓存构建出现 Next 相对模块
解析错误，改用同版本已验证的独立依赖副本并清理本任务 .next 后完整通过；发布候选首次构建发现另存清单的三个既有 OAuth
公开路由未复制，按精确哈希补齐后重建。没有跳过类型检查、吞掉失败或用 mock
替代正在验证的事务/权限行为。

冻结包审计拒绝了依赖根绝对链接；将依赖物化到包内。旧线上 Turbopack 的运行时
不足以运行本次 webpack 构建，隔离启动检查在发布前发现并阻止，补齐同版本公开
Next 运行时后重新检查。SDK 的两个 uploads 源文件采用上次冻结包的精确路径+哈希
例外；未知文件和修改过的 SDK 文件仍被拒绝。目录级放宽方案曾被自动审批拒绝，
没有执行，实际发布器保留原数据目录禁令。该例外不允许任何真实用户上传数据。

## 发布与回滚

发布器：scripts/deploy-feeding-food.py。冻结包仅含 standalone Web 和原公开 launcher；
新增本任务唯一的 baby-panel ExecStart drop-in，只重启 Web。API、MCP、日报 worker、
TTS 和 voice-control 六个服务的 PID 前后必须保持一致。

失败自动恢复旧 Web launcher；手动回滚使用同一 helper 的 rollback 命令，先检查
receipt 和文件哈希，不删除任何用户记录、数据库、备份或其他 drop-in。
具体合并 SHA、发布目录、Build ID、公网资源校验见 delivery.json 和部署证据。
