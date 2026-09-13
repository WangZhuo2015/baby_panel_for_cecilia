# Web integration fix — 合并与验证

日期：2026-09-13。状态：IMPLEMENTED_VERIFIED_REVIEW_PENDING。

## 来源与合并范围

- 用户提供 `growdesk-integration-fix.zip`，SHA256：`cff8bf9fcc90c6a7e75b95bccc49fd46e7e9c0c5e6ff674f4989d94961f83fe8`。
- Web 基线 `71c1242a14c517ad60b9ce887cc1ca58c36d6498`；服务端配套基线 `a9430c82a07c940571f386e9d0854f3830cac521`。
- 25 个 Web 文件逐一通过原 Git blob SHA 和替换上下文校验后合并。包内发布、私有化与自动应用脚本未执行。包的历史测试结果未作为本次验收证据。
- 修复 BFF 登录与身份恢复、宝宝 DTO、喂养日期分页与 mixed 类型、客户端原版本传递、旧 Prisma 懒加载防护、按 method 拦截未迁移入口。
- 集成时额外修复：宝宝修改必须显式指定 ID，浏览器读/改携带选中宝宝；撤权后清理已失效宝宝；注销上游失败时保留页面会话供重试。
- CSRF 测试显式指定 canonical origin，补协议/端口/伪造 Host 拒绝用例。NextRequest 会将 127.0.0.1 规范化为 localhost，不能通过放宽生产校验来迁就测试。

## 本轮验证

| 命令 | 结果与范围 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run test:unit` | 241/241 PASS，按 .env.test 隔离执行 |
| `npm run lint` | 退出 0；项目仍有 warning，不代表零 warning |
| `npm run build` | PASS；使用 GROWDESK_ENABLED=true、dev_test.db 路径和测试 JWT 配置；未启动生产服务 |
| `node scripts/review/check-growdesk-runtime.mjs` | PASS：真实 Next HTTP 会话、宝宝与列表线路、CSRF、501、上游故障和注销；上游为合成 HTTP fixture，不是 PostgreSQL/浏览器 E2E |
| `node scripts/check-production-writers.mjs` | 静态扫描 PASS；不将其输出的“zero leak”当全路径运行证明 |
| `git diff --check` | PASS |

构建最初被本机截断的 SWC 原生文件阻断；从 npm 恢复同版本 `@next/swc-darwin-arm64@16.3.2` 后成功，未修改 package.json/lockfile 或升级技术栈。运行烟测日志见 [runtime-smoke.log](runtime-smoke.log)。

## 使用边界与下一步

1. 配套服务端须应用新增 mixed migration、更新 API/契约后再做共同预览；具体后端验证与提交见服务端同名 evidence 目录。
2. 本包是集成修复批次，未覆盖的注册、家庭管理、AI/MCP、附件等入口在 GrowDesk 模式返回 501；不能声称全站已接通。
3. 预览时显式配置 `GROWDESK_API_URL`、`GROWDESK_WEB_ORIGIN`，完整 origin 包括协议和端口。生产 Cookie 为 Secure/HttpOnly 的 `__Host-growdesk_web`，需要 HTTPS；开发 Cookie 为 growdesk_web。
4. 线上开关保持现状；本次没有部署、导入真实资料、改 nginx、推送 Git 或修改仓库可见性。
5. 浏览器 + 真实 PostgreSQL 的联合 E2E、旧数据/附件对账、完整功能迁移和正式切换不属于本报告已通过项。

独立只读代码复核正在进行，后续补充结论及配套提交。
