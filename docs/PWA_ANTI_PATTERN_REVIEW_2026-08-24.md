# PWA 反模式全面审查报告

**日期**: 2026-08-24
**基线**: `main` @ `827f15b`（时间轴触屏操作面板）
**审查方式**: 5 路并行红队子代理——① Manifest/安装流/iOS ② Service Worker 本体逐行 ③ 离线体验与数据完整性 ④ 更新流程与版本管理 ⑤ 移动端性能与触控
**技术事实**: 手写 sw.js（无 workbox/next-pwa）· Next.js 16 standalone · API Network-Only · 无 IndexedDB/persist/Background Sync
**总体结论**: 安装能力做满了（manifest/SW/push 齐全），但 **离线数据链路完全缺位、更新链路自毁式、缓存治理缺位**。共 **28 项反模式**，其中 5 项直击"凌晨喂奶随手记"核心场景。

---

## 目录

1. [P0 —— 直击核心价值（5 项）](#p0--直击核心价值)
2. [P1 —— 高优先级（10 项）](#p1--高优先级)
3. [P2 —— 体验债（13 项）](#p2--体验债)
4. [确认做对了的（重构时保留）](#确认做对了的)
5. [修复路线图](#修复路线图)

---

## P0 —— 直击核心价值

### P0-1 断网提交 = 数据永久丢失，且用户以为保存成功了

- **位置**: `public/sw.js:61`（POST 绕过 SW）、`stores/useBabyStore.ts:650-668`（addFeedingRecord await 失败仅 rethrow）、全库无 outbox/IndexedDB/Background Sync
- **最恶毒细节**: `components/ui/Toast.tsx:30-50` 关键词检测只认中文 → `Failed to fetch` 以 **绿色 success 样式** 呈现 2.4 秒后消失。父母锁屏后这条奶量记录就没了。
- **场景**: 凌晨 3 点地库里断网，填完 120ml 点保存 → fetch 直接 reject，无暂存无重试队列。
- **修复**:
  1. 客户端生成 `clientId: crypto.randomUUID()` 随 POST 提交；
  2. `lib/outbox.ts`: 写前落 IndexedDB(store:outbox)，成功后删除；
  3. sw.js 增加 `sync` 事件重放 + 页面监听 `online` flush;
  4. UI pending 记录显示"⏳ 待同步"角标。

### P0-2 自毁式更新链：部署瞬间强刷所有在线用户

- **位置**: `sw.js:31`(install 即 skipWaiting) + `sw.js:51`(activate 即 clients.claim) + `ServiceWorkerRegistrar.tsx:59-66`(controllerchange → 无条件 location.reload())
- **后果**: 填一半的表单蒸发；POST 半途中断且乐观插入随 reload 丢弃；**首次访问者也挨一记闪刷**（claim 使 controller null→有值触发 controllerchange）；SKIP_WAITING 消息协议因 install 已自带成为死代码。
- **修复**: 删除 install 中那行 `self.skipWaiting()` → Registrar 改 toast"发现新版本，点击更新"再 postMessage SKIP_WAITING；controllerchange 仅在非 dirty 时刷新；补 beforeunload 脏检查。

### P0-3 冷启动离线 = 假登出 + 全零统计冒充"实时统计"

- **位置**: `useBabyStore.ts:258-260`(fetchUser 失败清空 user → 渲染登录页，cookie 明明有效)；`app/(main)/page.tsx:267`(summary fallback 全零) + `:407`("实时统计"标签)；`Timeline.tsx:26`(空数组 return null 整块消失)
- **场景**: 奶奶在老家没信号，看着 6 小时前的"今日奶量 480ml·实时统计"以为宝宝吃够了不再补喂——**陈旧带"实时"外观比空白更危险**。
- **修复**: zustand persist 持久化 user/baby/summary/timeline；零值 fallback 显示 "--"+ 离线标注；全局 OfflineBanner + useLastUpdated 指示器。

### P0-4 缓存无限增长 + quota 满时把成功响应变成硬失败

- **位置**: MEDIA_CACHE(sw.js:113-128)/IMMUTABLE_CACHE(sw.js:80-92) 零上限零 LRU 零过期；清理仅在 activate 按版本名整体重建
- **推演**: 忘 bump 版本时旧哈希 chunk 永久堆积，一年 ≈ **50-150MB 死缓存**；Safari 配额压力下可能整站驱逐（连坐 IndexedDB）。
- **隐藏 bug**: `sw.js:115-122` cache.put 在 then 内抛错(quota 满) → catch 回 cachedResponse=undefined(miss 路径) → **respondWith(undefined)**：网络明明成功却返回硬失败；`:87` 的 put 是无 catch 悬空 promise。
- **修复**:
  ```js
  async function putAndTrim(cacheName, request, response, maxEntries = 200) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
    const keys = await cache.keys();
    if (keys.length > maxEntries) await cache.delete(keys[0]); // FIFO
  }
  // 所有 put 补 .catch(() => {}) 隔离 quota 失败
  ```

### P0-5 iOS 主力用户的推送形同虚设

- **位置**: `app/notifications/page.tsx:102-153`——只检查 `"Notification" in window`
- **现状**: iOS Safari 普通标签页没有该 API（16.4+ 仅限主屏 standalone），未安装用户点"开启推送"得到错误文案「您的浏览器不支持推送通知」，无任何"先添加到主屏幕"引导；而 `InstallGuideModal.tsx:110-112` 还拿"喂养提醒/疫苗通知"当安装卖点——转化路径断裂。
- **修复**:
  ```tsx
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (isIos && !isStandalone) {
    showToast("iOS 需先「添加到主屏幕」，从桌面图标打开才能开启推送");
    // 并直接打开 InstallGuideModal
    return;
  }
  ```

---

## P1 —— 高优先级

| # | 反模式 | 位置 | 说明与修法 |
|---|--------|------|-----------|
| P1-6 | 同源校验用 `startsWith` 子串匹配 | `sw.js:64` | `https://baby.zwang.fun.evil.com/a.jpg`.startsWith(origin)===true → 恶意域响应写入自有 MEDIA_CACHE（投毒面）。改 `const url=new URL(request.url); if(url.origin!==self.location.origin) return;` |
| P1-7 | diaper/food 表单零防重复点击 + 服务端无幂等约束 | `diaper/page.tsx:56-76`、`food/log/page.tsx:91-114`、POST 直 create 无唯一约束 | 手抖双击 = 两条相同记录污染当日统计。统一 useRecordSubmit 守卫；记录表加 `clientId + @@unique([babyId, clientId])` 改 upsert（P0-1 outbox 重放的幂等前提） |
| P1-8 | 版本号三处手抄、CI 零校验 | `package.json:4` / `lib/version.ts:1` / `sw.js:2` | 排障信息必然失真 + 孤儿 chunk 堆积。CI 加一个 node 校验 step 对比三处；或构建期从 package.json 生成 |
| P1-9 | 更新发现仅页面 load 时一次 + 无 kill-switch | `Registrar.tsx:23`；全库 grep unregister 0 命中 | 用户停留 8h 永跑旧版；坏版本无法收敛。加 setInterval(60min)+visibilitychange 触发 update()；新增 `/api/app-config` 返回 swDisabled 时 unregister+清缓存 |
| P1-10 | Range/206 响应入库（潜伏） | `sw.js:84-90,115-122` | `response.ok` 对 206 也为 true；未来引入视频/分段加载后残片当整图缓存永久损坏。入口加 `if(request.headers.has('range')||res.status===206) return res;` |
| P1-11 | notificationclick 盲信 payload.url + focus 用 includes | `sw.js:197,202` | 推送诱导打开任意相对路径页；`client.url.includes()` 会 focus 到 `/settings/notifications-x` 这类错误窗口。强制 `new URL(raw, origin)` 同源断言 + pathname 精确比较 |
| P1-12 | 秒表/计时器每秒整页重渲染 | `feeding/page.tsx:53-63`(452行页)、`sleep/page.tsx:75-85`(462行页)、`(main)/page.tsx:165`(5s) | 抱娃单手点按钮正撞重渲染帧。interval 下沉到 `<LiveDuration>` 叶子组件 |
| P1-13 | react-markdown 52KB gzip 打进全部 10 页首屏 | `QuickAiButton.tsx:5` → QuickAiModal 同步 import | 不点 AI 也付流量+解析成本。`dynamic(()=>import("./QuickAiModal"),{ssr:false})` 一行解决 |
| P1-14 | 触控目标集群 <36px | `QuickAiModal.tsx:720`(20px AI删图钮)、`HeartRating.tsx:29-33`(24-32px 相邻 gap-1)、`SegmentControl.tsx:41`(34px)、`RecordActionSheet.tsx:46`(28px 关闭钮)、首页家庭钮36px、food/library 分类chip≈30px、CuteButton sm 36px | "明明点了没反应"。伪元素扩热区：`before:absolute before:-inset-2 before:content-['']` 或 min-h/min-w-[44px] |
| P1-15 | overscroll-behavior 全库零配置 | globals.css 仅 touch-action:manipulation 一处 | 刷时间轴到顶惯性续拉 → 浏览器整页刷新白屏；QuickAiModal 长对话滚到底背景跟着跑。`html{overscroll-behavior-y:contain}` + 弹窗滚动容器 contain |

## P1 补充细节

- **P1-12 渲染节律全景**: feeding 秒表每秒 reconcile 整棵表单树（类型分段/剂量加减/备注/AI按钮）；sleep 夜间模式挂一整晚每秒刷一行字；首页 5s tick 株连 Timeline/StatCard。三处统一模式：叶子组件内持 interval，父级零重渲染。
- **P1-13 构建实证**: `.next/static/chunks/06kb4j0u4ud1i.js` 176KB raw/52KB gzip（micromark/remark 全家桶）出现在 `(main)/page` client-reference-manifest。recharts 反而已正确 dynamic 分割（growth/page.tsx:12-19）——照抄即可。lucide-react/recharts 已在 Next 默认 optimizePackageImports 列表，无需配置。

---

## P2 —— 体验债

| # | 反模式 | 位置 | 说明 |
|---|--------|------|------|
| P2-16 | theme_color 双标 + 富安装字段缺失 | `manifest.json:9`(#FF6F9F 粉) vs `layout.tsx:30`(#FFF9FB 近白)；缺 lang/dir/categories/screenshots | Android 安装标题栏突兀粉红 vs 浏览器近白割裂；Chromium 富安装卡不触发 |
| P2-17 | capability meta 双份注入 + 废弃 API | `layout.tsx:42-46` 手写 head 与 metadata.appleWebApp/icons.apple 重复生成 mobile-web-app-capable/apple-touch-icon/status-bar-style/title 各两份；apple-mobile-web-app-capable 已废弃 | 删手动 head 块，仅留 `<meta name="mobile-web-app-capable">` |
| P2-18 | 时间轴 stagger `idx*60ms`：40 条最后一条延迟 2.4s 才淡入；全库不尊重 prefers-reduced-motion（grep 0 命中） | `Timeline.tsx:64,77` | 封顶 `Math.min(idx*60,600)`；globals.css 加 reduce 媒体查询全局关动画 |
| P2-19 | 安装横幅每次访问必弹 | `InstallGuideBanner.tsx:12-36` | 只在主动关闭后冷却 5 天，多次拒绝不延长、无总上限、无 appinstalled 监听。改递增冷却 5/10/20/40/90 天 + 硬上限 5 次 + appinstalled/display-mode 变化即隐 |
| P2-20 | maskable 图标复用普通 512 | `manifest.json:24-29` | 圆形裁切下圆角卡片贴边被切；专用 maskable 内容缩至 80%（409px 内）背景延展全画布 |
| P2-21 | offline.html 虚假承诺 + 不自动回站 | `offline.html:68-69` | 文案"数据将在恢复连接后自动同步"不实（系统无同步机制）；无 online 事件自动回站；网关 502/503 实体页不触发 fetch reject 落不到 fallback。加 `addEventListener('online',()=>location.replace('/'))`；sw 导航分支对 !res.ok 也走 fallback |
| P2-22 | 表单草稿零保护（睡眠计时除外） | 喂养双侧秒表 leftSeconds/rightSeconds(feeding:37-38) 计时中被杀归零；尿布/辅食 useState 内存态 | 通用 useDraftForm(key) 防抖写 sessionStorage，提交成功清除；喂养秒表照抄 sleep 的 localStorage 模式 |
| P2-23 | 多标签 last-write-wins + 删已删记录报错 | PUT 无乐观锁(feeding:214-224)；DELETE 404 → `(main)/page.tsx:447` 弹"删除失败"（实为幂等成功） | updatedAt 条件更新冲突 409；DELETE 对 404 返回 alreadyDeleted:true；BroadcastChannel 跨标签失效广播 |
| P2-24 | standalone 冷启动深链按返回键被困 | `AppHeader.tsx:15-17` history.back() 空栈无响应 | `history.length>1 && document.referrer ? back() : router.push('/')` |
| P2-25 | 化验单 2-5MB 相机原图直接当 h-36 缩略图 + eager | `health/medical/page.tsx:273-277,412-416` | 上传时产出 400px 缩略变体；列表 img 加 loading=lazy decoding=async |
| P2-26 | fixed 底栏 × 搜索键盘冲突 | `BottomNav.tsx:24`；food/library:149、books:118 含搜索框仍带 fixed nav | focusin/focusout 监听键盘收起导航或 translate-y-full 过渡 |
| P2-27 | manifest 锁 portrait | `manifest.json:10` | iPad 横屏被强竖屏；可接受但建议知悉 |
| P2-28 | InstallGuideModal desktop 分支复用安卓文案 | `InstallGuideModal.tsx:199-238` | 有 deferredPrompt 一键安装兜底，纯文案问题 |

---

## 确认做对了的（重构时保留）

| 决策 | 位置 |
|------|------|
| API Network-Only 从不缓存响应 | `sw.js:132-145` |
| `/uploads/*` 排除缓存（儿童影像隐私） | `sw.js:97-109` |
| sw.js 三层 no-cache 保险（headers + updateViaCache:none + load 时 update） | `next.config.ts:61-66`、`Registrar.tsx:19,23` |
| recharts 已 dynamic 分割（9.6MB 库只进成长曲线异步 chunk） | `growth/page.tsx:12-19` |
| 系统字体栈零网络字体（中文最优解，无 FOIT/FOUT） | `globals.css:47` |
| BottomNav 触控热区 ≈76×55px 达标 | `BottomNav.tsx:34` |
| 上传文件名 Date.now+randomBytes 防碰撞 | 四上传路由 |
| 睡眠计时 localStorage 持久化（全库唯一草稿保护样板） | `sleep/page.tsx:60-72` |
| manifest start_url/id 干净、name 长度合适、icons any/maskable 分条声明 | `manifest.json:2-29` |
| 安装检测双覆盖（matchMedia + navigator.standalone） | `InstallGuideBanner.tsx:14-16` |

---

## 修复路线图

| 阶段 | 内容 | 工作量 |
|------|------|--------|
| **止血包**（半天） | P0-2 删一行 skipWaiting+授权式更新 · P1-6 origin 精确比较 · P1-10 Range 守卫 · P1-11 同源断言+pathname 比较 · P0-4 putAndTrim+put.catch · P1-8 CI 版本校验 step | 全部几行的改动，消掉 6 个最尖锐项 |
| **数据安全周**（2-3 天） | P0-1 outbox+clientId 幂等（连带 P1-7）· P0-3 persist+OfflineBanner+useLastUpdated · P1-9 周期 update+kill-switch | 核心 |
| **体验周** | P0-5 iOS push 门控 · P1-12 计时器下沉叶子 · P1-13 markdown 动态导入 · P1-14 触控热区 · P1-15 overscroll · P2-16/17/18 manifest/meta/动画清理 | 中等 |
| **长尾按需** | P2-19~28 | 低优先 |

---

*生成: 2026-08-24 · 5 路并行红队子代理（SW 本体 / Manifest+iOS / 离线完整性 / 更新流程 / 性能触控）· 证据均含 文件:行号 与构建产物实测*
