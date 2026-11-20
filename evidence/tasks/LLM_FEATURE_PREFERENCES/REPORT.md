# LLM_FEATURE_PREFERENCES — Web 实现与验证

状态：`IMPLEMENTED_NOT_REVIEWED`。未提交、未部署；当前线上服务未切换。

## 范围与保留内容

基线 HEAD：`7a781995e3aee62e82fe45dd0db691a7e6be622f`，分支 `codex/llm-feature-preferences`。已读本仓库 AGENTS 与已安装 Next route/server-client 文档，沿用现有骨架。

本任务开始时，`.gitignore`、README、chat route、notifications、QuickAiModal、agent run/session-runner、bridge-policy、package.json、growdesk-ai-repair test 已有未提交改动；ChatGPTPlanControls、ChatGPT routes/core/docs/tests 等为用户已有未追踪骨架。它们均被保留。未读取或纳入环境备份、真实 LLM profiles/凭据、业务数据库、归档及 backups 内容。

[diff.patch](diff.patch) 仅列本任务触及的代码，文件哈希见 [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json)。对已有脏文件，HEAD diff 同时包含用户此前的骨架；它是审阅材料，不能直接当作仅含本任务的独立 commit patch。未改的 ChatGPT 实现与其原有 tests/docs 不纳入该 diff。

## 使用方式与行为

打开 AI 对话窗口的模型来源设置。聊天可以保存 ChatGPT 或 API profile，以及其已配置的文本/视觉模型；“其他功能的模型配置”可分别保存每日日报、育儿建议、记录解析、营养识别、生长 OCR、医疗 OCR、语音整理的 API profile/model。视觉功能只接受该 profile 的视觉模型；ChatGPT 当前仅适用于聊天。搜索当前直接调用搜索引擎，不提供 LLM 选择。

选择按登录用户和功能持久化。共享模式经 BFF 存入 GrowDesk PostgreSQL；旧模式存为权限 600 的 `.data/llm-preferences.json`（可由 LLM_PREFERENCES_FILE 覆盖），原子 rename/fsync。服务重新创建后仍能恢复。没有保存单项选择时沿用现有默认 profile。配置失效会明确报错，普通日报统计 GET 仍能读取。

请求通过 AsyncLocalStorage 绑定用户、功能和 profile，既有 provider/model/key/headers 读取跟随该请求；并发请求不改进程级 active profile。客户端只得到安全目录和配置 ID。日报缓存按用户/功能/选择隔离并保留生成当时的模型。

模型标注覆盖聊天气泡/历史、日报与导出海报、首页建议、营养/生长/医疗 OCR、医疗保存摘要和语音解析结果。优先记录供应商返回的 model，缺少回显时保留本次请求型号；自动 fallback 记录实际成功的候选模型。旧历史显示“模型未知”；规则统计显示“未调用模型”。ASR 与 TTS 单独标记其配置型号，不混称为 LLM。缓存结果继续显示生成当时的型号。

## 对话错误与重试

- 消费实际 lazy stream 后判断错误：429、暂时网络/服务错误有上限重试；401 不自动重试。候选各自绑定自己的 key/headers。
- 每个模型阶段先完整读取再交付成功事件，丢弃失败尝试的半截文字和工具调用；因此首字延迟可能增加。已经完成的工具结果保留在上下文中。
- UI 预创建 session/turn；断线查询执行状态并重连，避免再次提交同一轮。稳定 UUID 加共享后端原子 claim 保证相同轮次/attempt 只有一个执行者。
- 仅明确失败且没有启动写工具的轮次开放整轮重试。未知中断状态、写入已开始、持久化结果不明确时拒绝自动重放。
- 历史 marker 保存原始 contextDetail（上限 128 KiB），重开窗口仍能重试同一上下文；超限的历史失败消息明确说明无法安全恢复，不提供重试按钮。不会重复创建用户消息。
- 模型回复保存失败是可见终态错误，不显示成功，也不会为了补存储而再次调用模型。超时旧执行尚未结束时不提前宣告可重试。

## 验证与证据

| 检查 | 结果 |
| --- | --- |
| affected Web runtime suites（下方完整命令） | **115/115**，0 fail/skip/cancel；[affected-tests.log](affected-tests.log) |
| `npx tsc --noEmit --incremental false` | exit 0；[typecheck.log](typecheck.log) 为空表示无诊断 |
| changed-source `npx oxlint ...` | exit 0；存在 any/原有 unused warnings；[lint.log](lint.log) |
| `tests/ai/decoupled-session.test.ts` 隔离运行 | **7/7**，由对话子代理执行并记录于 [REVIEW.md](REVIEW.md) |
| `tests/unit/voice-fast-path.test.ts` 旧模式隔离运行 | **2/2**；[legacy-voice.log](legacy-voice.log) |
| `git diff --check` | 通过 |

```bash
timeout 120s env NODE_ENV=test node --import tsx --test \
  tests/unit/llm-*.test.ts tests/unit/glm-retry.test.ts \
  tests/unit/growdesk-ai-repair.test.ts tests/unit/growdesk-ai-entrypoints.test.ts \
  tests/unit/growdesk-ai-jobs.test.ts tests/unit/chatgpt-agent.test.ts \
  tests/unit/chatgpt-plan-routes.test.ts tests/unit/chat-retry-context.test.ts \
  tests/unit/agent-backend-credentials.test.ts

timeout 60s env NODE_ENV=test GROWDESK_ENABLED=false DATABASE_URL=file:./dev_test.db \
  LLM_PREFERENCES_FILE=/tmp/growdesk-llm-voice-test-preferences-unused.json \
  node --import tsx --test tests/unit/voice-fast-path.test.ts
```

新测试覆盖文件恢复/同用户多功能/不同用户隔离、受控 profile 目录、并发 ALS/凭据/缓存、鉴权/CSRF/限流与共享故障拒绝回退、实际 lazy stream 的失败及模型切换、SSE 错误/截断解析、模型与 turn marker、持久化失败、写工具后禁止重放、同 turn 在途复用和超时状态、历史上下文恢复。

测试期间修复了既有 voice test 直接 dotenv 默认加载配置的问题，改用中央 test 配置，并将宝宝改为明确 test_ 前缀。隔离 voice fastpath 只调用确定性统计，创建的独立 test_ 租户在 finally 清理；未使用 prod.db/dev.db 或 3088。一次误用继承的共享模式被 guard 拒绝，改成明确旧测试模式后 2/2 通过。最终回归还补全了鉴权 fixture 的新增视觉依赖，未删除或放宽原断言。

全量 tsc 原先会扫描 backups 内旧 .next 类型，现将 backups 排除。没有删除备份或跳过本项目源代码。所有模型测试使用虚拟 key/可控 provider，未发生外部计费或真实推送。

独立 Luna max 复核未发现剩余高置信 P1/P2，见 [REVIEW.md](REVIEW.md)。没有运行完整业务 API/E2E、浏览器交互或真实付费 LLM smoke。发布需要先迁移共享 PG，并配套后端 claim/preferences 契约；旧模式文件锁限于单个进程，多实例使用共享 PG。服务端证据见 growdesk-server 同名任务报告。
