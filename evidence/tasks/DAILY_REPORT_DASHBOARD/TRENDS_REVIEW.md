# DAILY_REPORT_DASHBOARD 趋势看板审查

状态：**IMPLEMENTED_NOT_REVIEWED**

本记录只覆盖 Web 趋势统计/看板的独立静态审查和纯聚合测试。日报页、日报 API、GrowDesk Go 服务端实现和浏览器 UI smoke 由主代理/对应代理负责；本记录不代表整项任务已验收、部署或连接生产。

## 覆盖范围

- `lib/care-trends.ts`：按家庭 IANA 时区按日聚合奶量、喂养次数、亲喂分钟、睡眠和尿布。
- `app/api/records/trends/route.ts`：确认每类历史记录一批读取后再聚合，不按 7/30 天逐日重复请求；云端路径按 BFF session 和宝宝归属读取，旧路径按认证用户和宝宝归属读取。
- `app/(main)/dashboard/page.tsx`：确认宝宝、范围、结束日期进入请求 key；请求清理使用 `AbortController`，响应还校验 `babyId` 和天数，旧宝宝/旧范围响应不会覆盖当前视图；空记录日使用缺失值展示。
- 导航：桌面侧栏有 `/dashboard`；首页快捷记录标题旁有“奶量与照护趋势”入口，移动端可达；`BottomNav` 保持既有五格布局。
- `tests/unit/care-trends.test.ts`：仅使用 `test_` fixture 名称和内存输入，不启动服务、不读环境文件、不访问数据库或真实 API。

## 聚合契约核对

- 记录奶量只累加明确的 `amountMl`；亲喂左右分钟单独累计，亲喂没有毫升数时保持 `recordedMilkMl: null`。
- 没有记录的日期保持奶量/睡眠为 `null`；明确记录的 0 ml 保持为 0，`hasRecords` 仍为 true。
- 日期按家庭时区的半开区间 `[dayStart, nextDayStart)` 归属；跨日睡眠按天裁剪，重叠区间只计一次；进行中睡眠计到刷新时刻。
- 响应包含 `babyId`、`timeZone`、`startDate`、`endDate`、`today` 和逐日数组；页面支持 7/30 天和 `?endDate=YYYY-MM-DD`，日期选择器的 aria-label 为 `截至日期`。

## 验证证据

在当前共享工作树执行：

```text
npm run typecheck
exit 0

npx tsx --test tests/unit/care-trends.test.ts
6 passed, 0 failed, exit 0
```

单测覆盖：上海本地日界线、明确奶量与亲喂分钟分离、空日期 `null`/显式 0、跨日睡眠和重叠去重、America/New_York 25 小时 DST 日、7/30 天范围长度和起止日期。

未执行 API 集成测试、3088 服务测试、生产环境连接或真实用户数据写入；这些动作超出本次 Web 纯聚合审查边界。

## Smoke 对接提示

看板页面路径为 `/dashboard`。加载中使用 `role="status"` 和文本“正在加载趋势…”，加载完成标记为 `data-testid="care-trends-loaded"`。若浏览器 smoke 脚本使用 `dashboard-loading` 或 `dashboard-content`，应在脚本与页面之间统一稳定标记后再进行 UI 验收。

