# 2026-09-16 分支归并记录

本轮按用户明确指示合并 Web PR #19 与后端 PR #4，不部署生产。

原有 Web 历史开发分支逐一核对后清理：e2e-prod-verification、feature-parity、identity-offline、nutrition-parity、medical-books、mcp-oauth、ai-jobs、notifications-cron、wip-growdesk-web-integration、merge-readiness，以及内容等价的 migration-e2e。

所有删除均校验预期尖端、开放 PR 和主干包含关系。唯一不属于主干祖先的旧 migration-e2e 分支，其三个修改文件与主干 blob/mode 完全相同，且先归档为 archive/20260916/migration-e2e。归档指向 81b9ac521f097b56711d6e5395cc5916c6e64ac6；没有重写历史或覆盖标签。

保留的清理工作流只对已审查的固定名单操作；尖端改变、有开放 PR 或不能证明已归并时保留分支。本轮临时开发分支仅在合入 main 后且无开放 PR 时才会被清理。用于本轮源码读取的临时导出工作流已删除。

本次 Web 新增提交只包含维护记录与分支清理，不宣称新增 AI 业务功能。后端本轮已验证的四类照护分页/作用域修复见 growdesk-server PR #5。尚未完成的 AI 持久化、语音/日报、全链路验收及迁移门禁见 growdesk-server Issue #6。

历史本地会话文件、生产配置、生产数据库与部署均未修改。
