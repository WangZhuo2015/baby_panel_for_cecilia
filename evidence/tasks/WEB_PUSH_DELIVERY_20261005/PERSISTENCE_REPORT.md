# Web Push 注册持久化隔离回归

状态：`IMPLEMENTED_NOT_REVIEWED`。此报告验证订阅持久化、身份绑定与错误响应，不代表设备已收到通知或已部署。

## 验证方式

- `scripts/review/check-push-persistence.py` 复用只读导入的 iOS `scripts/test-cloud-parity.py` 本地资源管理器，创建本轮独占 PostgreSQL 18.6、Redis 8.10.1、Go API、临时数据库及非超级用户 `test_` role。
- 所有子进程从环境允许列表启动，测试账号、家庭、宝宝均带 `test_` 前缀。数据库连接固定 `127.0.0.1`、随机非生产端口，SQL 再核对 `current_database/current_user/rolsuper`。不加载生产 `.env` 或已有 `.env.test`。
- BFF 层使用独占 loopback Node HTTP shim 调用真正的 `/api/push/subscribe` 和 `/api/push/test` route handlers；实际注册、BFF session 交换、Bearer principal、订阅写入均通过真实 Go HTTP API 和 PostgreSQL，无身份或存储 mock。这个 shim 不覆盖 Next 框架运行时或浏览器行为。
- 唯一替换的外部副作用是 `web-push.sendNotification` 网关调用；只返回受控接受结果或 403。生成本轮虚拟 VAPID keys，不启动 Go worker。所有 `fetch` 请求由 origin guard 限于本轮 Go API 或 Node shim，公网推送请求为 0。

## 结果

在当前 worktree 根目录运行：

```sh
python3 scripts/review/check-push-persistence.py --baseline
python3 scripts/review/check-push-persistence.py
node_modules/.bin/tsc --noEmit --incremental false
```

- 基线使用 `git show HEAD:app/api/push/test/route.ts` 的临时副本，10 个检查中 5 个失败，退出码 1。完整订阅经测试接口覆写成 endpoint、跨站 Origin 被接受、缺订阅返回 200、缺配置模拟成功、网关 403 模拟成功均已复现。临时基线文件在 `finally` 删除。
- 修复后的最终脚本 10/10 通过，退出码 0；TypeScript 检查退出码 0。
- 真正创建并登录 `test_` 账号，先保存完整 `{ endpoint, expirationTime, keys }` 订阅，再调用测试接口，SQL 确认 token 仍为完整 JSON，归属仍为真实 session 的 user。未登录/未知 session 无法写入，未携带 Bearer 的 Go 注册失败，客户端提交他人 userId 不改变注册归属。
- 配置缺失返回 503，缺订阅返回 400，外部 Origin 返回 403，受控网关 403 返回 502；这些响应不会伪称模拟成功。

主要机器可读证据：

- 基线失败：`backend-c9e672bde99b/persistence-report.json`、`route-result.json`。
- 最终通过：`backend-0167a521c0c8/persistence-report.json`、`route-result.json`；该运行的 route SHA-256 对应最终接口源码。
- 各运行 `backend-cleanup.json` 均记录 `status=cleaned`、`privateDirectoryRemoved=true`；密码文件、私有 manifest、数据库 cluster 和所建 Go/Redis 进程已清理。只保留脱敏报告，原始基础设施日志已移除。

前两次启动曾被 S3 bucket guard 拒绝（run ID 下划线导致 bucket 名无效），所建资源均已清理；改用资源管理器要求的 12 位十六进制 ID 后通过，未放宽 guard。

## 基线业务事件缺口与后续修复

这次额外创建真实 `test_` 家庭与另一位照护者，完成家庭加入、宝宝授权和照护者的完整推送订阅，再由本人通过实际 HTTP 提交喂养记录。SQL 观察到：

```json
{
  "recordCommitted": true,
  "recipientSubscriptionPresent": true,
  "familyChangeDelta": 1,
  "notificationDelta": 0,
  "pushTaskDelta": 0,
  "missingEventObserved": true
}
```

这是修复家庭通知生产者之前对 Go 业务链缺口的实测观察，不能把该观察检查通过解读成家庭推送功能通过验收。对应基线源码：`internal/backend/record_mutation.go:138-185` 的 `publishRecordChange` 只写 timeline/change/receipt；`internal/backend/native_processors.go:326-375` 的通知生产者只为 AI 任务结果写通知并挑选 `input.UserID` 的设备；`internal/backend/native_push.go:217-271` 已存在真正的 WebPush 发送适配器。

这个订阅持久化测试未扩展后端通知生产者。随后单独实现的家庭照护记录事件、事务 outbox、实际 worker 与隔离加密接收验证见 [FAMILY_RECORD_PUSH_20261005 报告](/Users/wangzhuo/Documents/GitHub/growdesk-server/evidence/tasks/FAMILY_RECORD_PUSH_20261005/REPORT.md)。定时日程提醒、真实公网推送网关、物理设备接收、部署和生产配置仍未验证。Next 页面的受控浏览器回归见同目录主报告。
