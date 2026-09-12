# Gemini 长程执行：完成 Web / iOS 共用后端

日期：2026-09-12。用户已确认可长程推进。本文件替代旧提示词中“每完成一个小任务必须等用户review才能继续”的人工等待要求；09中的技术约束、隔离测试和正式切换门槛仍有效。

## 1. 这次完成什么

连续完成 **R0修正SH-00 → SH-01至SH-12实现和隔离验收 → SH-13上线材料准备**。最终交付可独立部署/联调、迁移演练通过的新后端、适配后的Web和iOS云同步实现。现有旧Web界面及iOS仅本机模式保留。

本轮默认不切230生产写权威、不执行新的真实数据导入、不停止现有服务、不改线上nginx/DNS、不启用付费外部调用。生产切换是最终独立发布动作；把具体提交、证据、部署命令、差异及恢复方案准备好供用户review。用户若后续明确授权具体发布范围，再按该范围执行，无需重复索要同一授权。

**长程不等于一个巨型提交**：按09的小任务边做边验证、边提交；不需要每次提交后询问用户是否继续。

## 2. 首先修正SH-00（R0，不能跳过）

输入：[Codex复核](../../evidence/tasks/SH-00/REVIEW_CODEX.md)。原be71f9c的ACCEPTED已失效。通过的是73文件/128方法路由集合，其他语义不能直接沿用。

完成以下修复并提交 `docs(compat): correct SH-00 semantic inventory and evidence`：

- 从route→service校验→Prisma→stores逐字段重建映射。尤其喂养使用timestamp/amountMl/leftMinutes/rightMinutes/formulaProductId/notes等真实字段；不得凭空引入喂养endTime、spitUpSeverity、临床程度或新的单位。旧响应、空值、201/错误/删除已不存在等行为同样登记。
- 同样逐字段复核尿布、睡眠、辅食、成长等全部领域。旧睡眠POST要求非空endTime，新合同的活动睡眠必须作为新增能力单列；保留type/nightWakingCount/notes真实语义。补成长PATCH与growth-chart，避免只修喂养后沿用其他错误表。
- 对每个CSV method核对auth/helper读写/副作用/callers；补stores；MCP标OAuth Bearer，OPTIONS单列。目标operationId标PROPOSED，不能将旧128方法机械复制成128个新业务端点。
- 从实际注册和模型重建writer清单，移除不存在的AiDailySummary/AiTip/OAuthToken表和错误MCP工具名。不能用文件存在或方法名猜全部调用链；无法确定的线上启用状态标UNKNOWN。
- 修正capability的源码路径、占位退出码（实际为2）、身份表与历史档案的schema区别。给每条VERIFIED附可追溯日志/提交/日期；没执行的标NOT_RUN或引用HISTORICAL结果。
- 使用已修正的冻结/最终对账要求，不再把WAL checkpoint当写锁，也不只比较行数/最大时间戳。
- 运行 `python3 scripts/review/check-sh00-inventory.py`；另交付字段/文件/模型存在性及语义抽查证据。128/128只证明路由集合，不证明内容准确。
- 更新SH-00报告和复核状态，列每个发现的修复位置、复验方法和残留项。历史报告保留，状态清晰；不得自己冒充原独立review者重写其结论。

R0实际通过后直接进入L1，不等待用户再发“继续”。

## 3. 长程批次和退出条件

逐批执行，批内仍按09每个SH小任务分别提交。允许提前做与阻塞无关的工作，不允许绕过前置给出假实现。

| 批次 | 任务范围 | 必须留下的可运行结果 | 通过后自动继续 |
|---|---|---|---|
| L1：第一条真实链路 | SH-01、SH-02A/B、SH-03A/B/C/D、SH-04F、SH-05 | 真正OpenAPI导出/check、PG增量迁移、会话/宝宝权限/UnitOfWork、Web登录及喂养增改删恢复、版本冲突；隔离PG+BFF E2E通过 | L2 |
| L2：全部数据领域 | SH-04D/S/FO/N/G、SH-06及所需静态reference | 尿布/睡眠/辅食/产品补剂/成长/报告/疫苗和私有附件；旧字段保真、权限、分页、事务和hash验证 | L3 |
| L3：后台与Web全覆盖 | SH-07A/B/C/D、SH-08 | 持久任务、AI/SSE、OCR/语音/日报、通知、MCP/OAuth/PAT、其他Web功能；所有运行入口退出旧DB直连 | L4 |
| L4：iOS共享数据 | SH-09、SH-10 | 固定契约Swift客户端、账号/Keychain、绑定/初次导入、快照/feed、冲突/暂停/撤权/切账号；双端交叉写读 | L5 |
| L5：迁移与容量 | SH-11A/B/C/D、SH-12 | typed mapper/promotion receipt、新增更新删除reconcile、文件归属/hash、隔离演练、失败恢复、性能runner和可用环境下的实测 | L6 |
| L6：发布候选 | SH-13准备工作 | 精确release commits/digests、迁移顺序、冻结/排空清单、数据差异、应用回滚兼容矩阵、备份恢复证据和发布手册 | 交用户做最终review，不自动切生产 |

L2某领域需要任务基础时可提前完成SH-07A；L4需要S3和snapshot worker，不用假快照绕过。L5 ETL代码可在相应模型冻结后提前并行；最终演练必须使用完整且一致版本。

## 4. 自动推进和检查规则

1. 不等待逐卡人工确认。每张小卡实现后先跑规定的正向、失败、隔离、并发测试，再提交。
2. 环境支持独立子agent时，用只读review agent检查固定diff、关键权限/事务和契约；修完问题再继续。子agent不能同时编辑公共schema/契约，主执行者负责集成。
3. 环境不支持独立review时，自己做明确标记的自检，交付 `IMPLEMENTED_VERIFIED_REVIEW_PENDING`，可以继续开发依赖任务；不能标独立ACCEPTED。最终所有关键安全/事务/迁移门槛仍需独立review后才能上线。
4. 技术失败必须先修：测试红、字段来源不明、越权、丢数据、幂等不成立、契约漂移不能靠跳过/删测试/返回假200解决。只完成一个子任务不能把整个阶段打勾。
5. 每个任务报告包含基线/提交、命令/退出码、测试环境归属、实现与未实现、代码证据、独立review或自检性质。CI未执行、真机未测、供应商未调、迁移未演练分别标记。
6. 实际执行命令后再写日志。测试路径存在不是测试通过；历史测试结果不是本次绿灯。禁止编造模型、路径、工具名、端点状态或输出。
7. 用户明确要求及时提交：完成一个可验证的小单元就提交；只stage本轮文件，不一口气add全部工作区，不自动push。

## 5. 跨仓库权限与版本

- **Web**：`/Users/wangzhuo/Documents/GitHub/baby_panel_for_cecilia`。R0、compat和BFF在这里。
- **服务端**：`/Users/wangzhuo/Documents/GitHub/growdesk-server`。schema、domain/repository、API/worker/scheduler、ETL和部署材料在这里。
- **iOS**：`/Users/wangzhuo/Documents/GitHub/growdesk-ios`。原生网络/会话/同步在这里。

本长程任务允许按任务卡修改三个仓库的实现代码；不把后端嵌进Web仓库。每次进入仓库先读取AGENTS、记录HEAD/dirty，并且遵守对应工具链说明。

已有未提交内容不自动属于本任务：服务端Migration.Dockerfile、LEGACY_IMPORT证据、ios_backup转换器；iOS project.pbxproj和design-mockups。先保存差异摘要/哈希。确需接续某项时先核对实现、验证、单独提交并写明接续范围；不用reset/clean掩盖来源。

共享schema与生成客户端使用服务端正式快照。跨库报告记录source commit和SHA256；不要手改OpenAPI生成文件、复制目录替代契约，或用相邻仓库软链接让CI依赖本机布局。

## 6. 不能省略的架构要求

- Next BFF不持有PG账号；所有业务走统一API和授权UnitOfWork。API失败不写回SQLite。
- 用户—宝宝显式多对多，FamilyMember与BabyMember共同约束；不找“第一个宝宝”充当授权。新成员不自动继承整个家庭宝宝。
- 记录/TimelineEntry/change/receipt/outbox同事务；cursor按提交顺序；重复请求同键、不自动换幂等键；unknown结果先对账。
- BFF opaque cookie、canonical Origin+CSRF、服务端加密凭据托管、跨实例refresh single-flight；浏览器不接收refresh token，旧cookie不直接获得新权限。
- 存量身份快照与业务档案区分；已应用的migration不能改。当前初始importer不支持目标非空增量，必须新增reconcile，不删除保护。
- iOS本地空间与云绑定分开；登录不会上传。共享云数据与Web一致，本地备份不等于云授权。
- 所有人工/自动测试租户使用test_/e2e_，真实家庭不得作为演示/压测资料。生产快照只用于明确授权的数据迁移/校验，不能成为一般自动测试fixture。
- 230是共享主机，容量压测使用独立环境；不因“有独立数据库”就占满旧服务CPU/内存。没有容量环境时交runner和smoke结果，容量门槛标未验证。

## 7. 外部阻塞和长程恢复

只有以下情况需要用户或外部输入：缺少确实必须的密钥/账号/域名/存储供应商配置、不可自动裁决的真实数据冲突、超出已授权范围的生产或收费操作、已有修改无法判断归属且必须覆盖。列具体问题和已完成证据，继续其他不依赖它的任务。

缺外部条件时：适配层和合成fixture可以完成，但不能将mock标为真实联调。最终未完成项进入阻塞清单，不写“全部完成”。禁止在真实资料里填演示记录解决缺数据。

维护Web仓库 `evidence/long-run/PROGRESS.md`，每个任务完成、异常恢复和上下文交接前更新：

```text
当前批次/小任务：
三仓库基线、最新提交、尚未提交文件：
契约/迁移/客户端快照版本：
已验证的任务及报告链接：
正在执行的命令/进程归属及是否需要清理：
失败与修复、外部阻塞：
下一条准确操作（含workdir）：
生产/外部操作：未执行 / 明确的已授权记录
```

上下文缩减或重启后先读此文件、核对git和实际进程，继续未完成步骤，不从头重做、不重复导入、不把旧日志当新结果。

## 8. 可以直接复制给 Gemini

```text
请继续这个长程任务，按 /Users/wangzhuo/Documents/GitHub/baby_panel_for_cecilia/docs/plan/GEMINI_LONG_RUN_HANDOFF.md 执行。

先读 evidence/tasks/SH-00/REVIEW_CODEX.md。原SH-00的ACCEPTED不能沿用：路由覆盖128/128通过，但字段映射、MCP鉴权、writer清单和测试证据存在实质错误。先完成R0修正并验证，再连续执行L1至L6。

本轮允许按任务卡修改 baby_panel_for_cecilia、growdesk-server、growdesk-ios；每库先读AGENTS、保留已有dirty内容。持续推进，不要每完成一个小阶段就问我是否继续。每个可验收小单元都先验证、单独提交、更新PROGRESS，再继续下一项。

全部按09及服务端02/03/07/08的技术约束实施。可用独立子agent做review；没有独立review就诚实标自检/REVIEW_PENDING，不能伪称ACCEPTED。失败测试、权限/事务问题和契约不一致必须修，不得绕过。

完成正式迁移演练、Web/iOS/MCP联调和发布候选材料；当前不直接切230生产、不执行新的真实数据导入、不使用真实家庭做测试、不自动push或发生外部费用。缺外部条件时报告具体阻塞并继续其他可做工作。

最终交付各仓库提交列表、功能矩阵、实际测试/演练证据、剩余阻塞及完整生产切换和恢复方案，我会再安排最终review。
```
