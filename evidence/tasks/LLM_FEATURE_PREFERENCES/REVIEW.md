# Web 子范围定向复核

本记录来自本次独立 Luna max reviewer 的只读复核，以及对话实现子代理的运行结果；任务总状态仍为 `IMPLEMENTED_NOT_REVIEWED`，不作 ACCEPTED/上线声明。

Reviewer 最终未发现剩余高置信 P1/P2。已复核并解决的两个 P2：

1. 历史失败消息必须恢复原请求 contextDetail；现按 turnId 从 user marker 恢复，上限 128 KiB，超限会禁用历史重试并显示原因。
2. 聊天 profile 必须允许文本/视觉两种已配置模型；新选择默认视觉模型，图片请求选择文本时在 claim/persist 前明确拒绝。其他 OCR 功能仍严格使用视觉模型。

额外核对：所选 profile 的 headers 经 model wrapper 传给 provider；UUID 验证支持合法版本/variant，stable ID 按 owner/session/turn/attempt 隔离；本地与 BFF 仅 created===true 的 claim 开始执行，共享后端竞争失败明确拒绝。

Reviewer 自写 `llm-chat-stream.test.ts` 与 `llm-chat-retry-metadata.test.ts` 运行 9/9，通过 scoped tsc。对话实现子代理最终 scoped runtime suite 26/26、隔离 `decoupled-session.test.ts` 7/7、typecheck/diff-check 通过。根代理随后执行 REPORT.md 所列 affected Web 115/115 与全量 tsc，并保存日志。

模型测试消费可控 lazy provider stream，验证失败尝试输出丢弃、401 不自动重试、429 有限重试、provider 切换的 key/headers 和最终模型；没有用源代码字符串断言冒充 retry runtime 证据。PG 原子 claim 由服务端真实隔离集成验证。
