# SH-00 独立复核与长程执行交接

日期：2026-09-12。固定审查范围：`4901731...be71f9c`（实现942a59f、报告157915f、原review be71f9c）。

结论：**CHANGES_REQUESTED。HTTP路由/方法覆盖通过；语义清单、字段映射、事实证据与迁移步骤不能按原ACCEPTED直接进入实现。** 当前报告优先于原REVIEW.md；原报告保留作为历史记录。

## Standards — 事实与证据标准

### S1 / P1：将未提供执行证据的能力写成已验证

`docs/compat/capability-status.md` §2大量列出VERIFIED和“测试全绿”，但SH-00执行报告只登记文档扫描与一个占位命令，没有对应测试日志/执行提交/退出码。代码存在、历史部署记录和本轮测试通过是三种证据。`packages/domain/src/baby-access.ts` 实际不存在，授权实现在服务端 `packages/domain/src/index.ts`。占位命令实际设置 `process.exitCode=2`，报告却写1，两个review对这点也不一致。

修正：逐项用源码路径和可追溯证据登记；没跑的测试标NOT_RUN/UNVERIFIED，引用旧结果必须标HISTORICAL并记录来源和时间。不能执行生成的假日志来补齐证据。

### S2 / P1：后台清单包含不存在的工具/表，不能作为停写清单

`docs/compat/production-writers.md` §2把 `AiDailySummary`、`AiTip`、`OAuthToken`列为实际表；旧schema不存在这些模型。`lib/ai-daily-summary.ts`实际通过 `AiArchive`缓存/归档，OAuth持久表包含OAuthRefreshToken等。`lib/agent/tools/medical.ts`不是实际路径；`lib/mcp/server.ts`声明的5个工具是get_baby_overview、record_baby_events、record_health_measurement、query_parenting_knowledge、web_search，和文档列出的record_event/manage_nutrition等不符。

修正：沿真实注册函数/分发链/helper追踪，行内引用实际文件/函数/模型，静态可达与线上启用分开。当前不能据“40项”认定覆盖完整。

### S3 / P1：原停写方案不能证明数据收敛

原§4用拦截非GET方法、终止AI job、WAL checkpoint及行数/最大时间戳作为冻结依据。GET生成日报/贴士、审计等仍可能有副作用；在途任务不能无条件强杀；WAL checkpoint不是写栅栏，行数相同仍可能有更新/删除变化。

处理：本轮已替换这一段危险指引，改为逐writer冻结/排空、冻结marker、最终一致快照、ID集合及内容hash/删除集合/附件对账；详细任务仍由长程R0补齐。

## Spec — SH-00交付要求

### F1 / P1：第一条喂养链路的输入字段和目标协议被编造

`docs/compat/web-api-mapping.md` 原§4.1/§5使用startTime、endTime、amount、leftDuration、formulaId、note和BOTTLE_BREAST/spitUpSeverity等定义。实际 `app/api/records/feeding/route.ts` POST读取timestamp、amountMl、leftMinutes、rightMinutes、formulaProductId、notes、clientId、source/sourceAgent；notes上限1000而非500。旧Prisma同样没有喂养startTime/endTime，02命令样例仍使用timestamp/type/formulaProductId。把spitUp=true认定MILD会凭空增加临床含义，改变source会丢来源。

修正：从route→service验证→schema→stores调用逐字段建立表；明确已确定的新合同和SH-01待定项，不新增未经权威schema定义的字段/enum/单位。旧测试向量必须真实符合旧输入；例如14:30+08:00对应06:30Z，不是14:30Z。

### F2 / P1：CSV关键语义错误会直接误导BFF鉴权和调用改造

CSV将/mcp及/api/mcp记为Cookie Session，实际 `app/mcp/route.ts` 使用OAuth Bearer principal；OPTIONS并非SSE业务调用。`stores/slices/records.ts`、`stores/slices/auth.ts`等真实浏览器调用遗漏，部分记录接口只列stdio脚本；`/api/baby`经helper读家庭/宝宝，不是db_read_models=none。

修正：覆盖数量不变时也需逐method核对caller、auth、helper隐式读写和副作用。新API不是机械创建128个同名端点：别名/预检/元数据可汇合，目标operationId先标PROPOSED，SH-01以权威契约冻结。

### F3 / P2：验收脚本未交付，原“通过”不能重现

报告引用scratch/analyze_routes.py、scratch/generate_csv.py，但本任务提交未提供可运行复查脚本。原review自己记录了MCP鉴权、callers和时区错误，却仍标ACCEPTED，不能作为后续自动放行凭证。

本轮新增 `scripts/review/check-sh00-inventory.py` 和 `CODEX_ROUTE_COVERAGE.json`，独立验证73个route、128个method/path、0漏项/额外项/重复项。该脚本明确只验证覆盖，不替代语义检查。

## 本轮验证范围

- 读取旧Web源码、服务端当前schema/契约和历史证据；未访问生产、未运行业务测试、未修改运行代码。
- `python3 scripts/review/check-sh00-inventory.py`：退出0，128/128。
- 手工核对实际喂养route、MCP注册/鉴权、stores调用、旧Prisma模型、日报缓存和占位脚本源。
- 原有工作区改动保留；其他仓库未修改。

## 放行方式

用户已允许Gemini长程推进，**无需每完成一个小任务都等用户确认**。先执行长程计划R0修正上述问题，提供可复查证据；随后在每个小任务自检、提交和独立子agent审查后继续SH-01至SH-12。不能以“不需要人工确认”为由忽略失败门禁、伪造ACCEPTED或直接切换生产。

下一入口：`docs/plan/GEMINI_LONG_RUN_HANDOFF.md`。
