# Vue 3 智能工作台

[![Deploy to GitHub Pages](https://github.com/lihuazou1230/vue3-smart-workspace/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/lihuazou1230/vue3-smart-workspace/actions/workflows/deploy-pages.yml)
![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38bdf8?logo=tailwindcss&logoColor=white)
![Element Plus](https://img.shields.io/badge/Element%20Plus-2-409eff?logo=element&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)

一个集**任务管理、今日聚焦、子任务、批量操作、数据可视化、天气信息与外观自定义**于一体的个人效率仪表板，基于 Vue 3 + TypeScript + Tailwind CSS + Element Plus 构建。第五阶段接入 **Supabase**（Auth + Postgres RLS + Storage）后支持真实注册/登录与任务多设备同步；**不配置 Supabase 也能以「本地模式」完整使用**，不会把功能锁死。

> 当前进度：**第一 ~ 五阶段已完成**（基础建设 / 任务管理闭环 / 可视化与天气集成 / 体验优化与交付 / 用户系统与多设备同步）。

## 在线演示

- **线上地址**：<https://lihuazou1230.github.io/vue3-smart-workspace/>（GitHub Pages，由 `.github/workflows/deploy-pages.yml` 自动部署）
- **源码仓库**：<https://github.com/lihuazou1230/vue3-smart-workspace>

打开即用：任务管理、今日聚焦、子任务、批量操作、统计图表、热力图、赚钱秒表、每日格言、天气定位全部可用；
未配置 Supabase 时会自动进入**本地模式**（不登录、不云同步，其余功能完整）。

## 核心功能

- 👤 **用户系统**：邮箱密码注册/登录 + GitHub OAuth，刷新页面会话自动恢复（不闪跳登录页），未登录访问受保护页自动重定向并带原目标回跳
- ☁️ **多设备同步**：任务写进云端 Postgres（行级安全 RLS），离线改动进队列、联网自动补发，旧 localStorage 数据登录后**一次性迁移**
- 🖼️ **头像上传**：本地选图 → 圆形裁剪（cropperjs）→ 压成 256×256 WebP → 已登录传云端 Storage，未登录存 IndexedDB
- 📋 **任务管理闭环**：增删改查、状态筛选、优先级多选、关键字搜索、localStorage 持久化
- ↩️ **撤销删除**：软删除 + 1 分钟窗口内可撤销（Toast 倒计时）
- 📅 **截止日期**：今日/本周筛选、逾期标红、1天/1周/1月快捷调整
- 🎯 **今日聚焦（My Day）**：置顶 + 今日到期任务单独成列
- 📅 **迷你月历**：CSS Grid 自绘，有任务的日期标主题色圆点，点某天直接跳到任务页按那天筛选
- 🔥 **连续打卡 + 周目标**：连续 N 天（按 `completedAt` 聚合，纯函数 + 单测）、本周完成数、最佳日、周目标进度条（目标可直接在卡上改）
- 🧩 **可自定义仪表板**：默认是精调的三列 bento；点「编辑布局」切成等槽网格后可**拖拽换位**（复用任务列表同一套 SortableJS）、每卡可**隐藏**与调**大小三档**（小/中/大），顺序与显隐持久化，新增卡片不会破坏已存顺序
- 🔗 **快捷导航（LinkDock）**：图标卡片式链接管理 + 分组归类，favicon 自动抓取（google s2 → 站点 /favicon.ico → 首字母兜底），URL 自动补协议并拦截 `javascript:`/`data:`
- 🔍 **聚合搜索**：顶栏搜索一次给两条通道——任务结果（点一条跳过去）+ 网页跳转（百度/谷歌/必应一键切换，选择被记住）；`Ctrl/Cmd+K` 或 `/` 唤起
- ⏰ **任务提醒（三层降级）**：Web 没有常驻后台进程，所以提醒分三层——
  ① 系统通知（Notification API，点击通知聚焦并跳到任务）② 应用内兜底（顶栏铃铛红点 + 标签页标题显示待办数）
  ③ 重新打开时把错过的提醒汇总成「你错过了 N 条」；调度器 30 秒一轮 + 回前台立刻补扫，
  每条任务最多提醒 2 次（到期 + 超时 1 小时催办），已通知标记持久化防重复
- 💬 **微信推送（WxPusher）**：个人微信没有官方推送 API，走 WxPusher 公众号通道；
  用户扫码拿 UID 填在设置页（只存本地），应用 token 藏在 Supabase Edge Function 的 Secrets 里，
  前端只调代理；设置页有「发送测试消息」一键验证链路（部署说明见 `supabase/functions/README.md`）
- ⏳ **倒计时**：发薪日倒计时（按发薪日号，短月自动落到月末）+ 自定义纪念日（可每年重复，2/29 非闰年退 3/1）+ **法定节假日提醒**（内置假期与调休 JSON，来源为国办通知原文，每年初需更新）
- ☀️ **未来 3 日预报**：高德 `extensions=all` 免费档的 cast 列表直接渲染（以 3 天为上限），预报失败不影响当前天气卡
- 🖼️ **背景壁纸**：纯色/渐变预设 + 本地上传（IndexedDB 存 blob，与头像同方案），卡片是不透明白底所以不影响可读性
- ☑️ **子任务清单**：任务内嵌 checklist + 完成度进度条
- 🖱️ **批量操作**：列表多选，批量完成/取消/删除/改优先级/归档/召回
- 🏷️ **任务标签**：8 色标签（新建表单里就地创建或点选），列表按标签筛选；任务只存标签 id，**改名/改色全局即时生效**，删标签只摘引用、任务不删
- ✨ **AI 智能添加**：任务页用一句话描述（「明天下午3点提醒我交周报，高优先级」）→ 解析成结构化任务 → **预览确认后才入库**；BYOK（Key 只存本机 localStorage），未配置时入口隐藏并引导设置
- 🧩 **AI 任务拆解**：大目标一键拆成 3~6 条子任务建议 → 预览清单可勾选/编辑/删减 → 确认后写入子任务；整体放弃不产生写入
  - 两条链路共用同一套可靠性三件套：`response_format: json_object` 强制结构化 → schema 校验（失败把错误回灌**重试一次**）→ 仍失败降级回手动表单，**AI 永远是加速器不是阻塞点**
- 📦 **任务归档**：归档后主列表与统计（含热力图）不再计入，但 `completedAt` 保留所以历史不丢；「已归档」视图可恢复、可彻底删除（走撤销保护）
- 💤 **稍后再做（Snooze）**：一键藏到明天/后天/下周一或自定义日期，主列表与今日聚焦立即隐藏、到期自动回归；**不影响任何统计**，「已隐藏」视图可提前召回
- ✨ **拖拽排序**：按住行首把手拖动自定义顺序（SortableJS / VueUse `useSortable`，移动端同样可用；手动排序后不再自动重排）
- 💬 **每日格言**：按时段问候（早上好/下午好…）+ 每日一句（本地 JSON 按日期哈希取句，同一天不换）
- 💰 **赚钱秒表 Pro**：主指标实时跳动「今日已赚 ¥xxx.xx」精准到分（100ms tick / 可切 rAF），**数字逐位上滑滚动**（odometer）；**薪资三模式**（月薪/日薪/时薪，统一换算到日薪）、**自定义每周计薪日**（单休/轮休）、午休剔除、**跨零点夜班**（22:00 → 06:00 按次日算）；次指标「本月已赚」+ 较上月同期涨跌 + 达成进度条；**迷你折叠模式**（只留金额小条，状态记忆）；底部附诚实免责声明
- ✅ **今日完成度**：环形图 + 大数字展示「今日完成 ÷（今日完成 + 今日待办）」，附较昨日涨跌徽章
- 🎨 **外观自定义**：明暗模式（深色/浅色/跟随系统）、主题色（默认 emerald，预设色板含 lavender + 自定义取色器）、圆角、密度，实时生效并持久化（Element Plus CSS 变量 + ElConfigProvider）
- 📊 **数据可视化**：ECharts 优先级分布环形图 + 近 30 天完成趋势**圆角柱状图**（按需引入，柱子颜色跟随主题色）
- 🔥 **生产力热力图**：近 90 天每日完成数 GitHub 风格色阶图（纯 CSS Grid）
- 📍 **自动定位**：进站自动显示**当前位置**的天气，位置文案为「区 · 城市 · 省份」（直辖市为「区 · 城市」）
- ☀️ **天气卡片**：自动定位 + **手动切换城市**（国内数据源 · 高德地图），emoji 天气图标、体感温差徽章、加载骨架屏、错误重试、30 分钟本地缓存、三级降级链路、未配置 Key 引导

## 技术栈

- **Vue 3**（`<script setup>`）+ **TypeScript**
- **Vite** 构建，路径别名 `@` → `src`
- **Tailwind CSS v3.4**（`darkMode: 'class'` 与 Element Plus 深色共用 `html.dark`）
- **Element Plus**（unplugin 按需自动导入）
- **Pinia** 状态管理 / **Vue Router**（4 个页面按需懒加载 + 登录守卫 + keep-alive）
- **Supabase**（Auth 邮箱/GitHub OAuth · Postgres + RLS 任务存储 · Storage 头像 bucket）
- **cropperjs**（头像圆形裁剪）
- **ECharts**（`echarts/core` 按需注册图表类型）
- **Vitest** 单元测试 / ESLint + Prettier / Husky + commitlint

## 项目结构

```
src/
├── api/              # supabase 客户端 / auth 认证 / avatar 头像 Storage / todoRemote 任务云端读写 / weather 天气
├── assets/styles/    # Tailwind 入口、Element Plus 主题变量、卡片/数字滚动等纯 CSS
├── components/
│   ├── atoms/        # BaseButton / BaseInput / BaseBadge / BaseCheckbox / DigitRoll / TrendBadge
│   ├── molecules/    # TodoItem / SearchBar / ThemeToggle / RollingAmount
│   └── organisms/    # TodoList / TodoForm / MyDay / DailyGreeting / EarningsClock / TodayProgressCard /
│                     # WeatherWidget / SettingsPanel / SidebarNav / AvatarUpload / MobileBottomNav
├── composables/      # useTheme / useWeather / useEarnings / useECharts / useStatistics / useAvatar / useIndexedDb
├── data/             # quotes.json（每日格言，本地 JSON 轮换）
├── layouts/          # DefaultLayout（侧边栏 + 顶栏 + 内容区 + 移动端底部导航）
├── pages/            # Dashboard / Todos / Stats / Settings / Login
├── router/           # 路由表 + authGuard（登录守卫与回跳校验）
├── stores/           # todoStore（含云同步）/ themeStore / authStore
├── types/            # todo / weather / statistics / earnings / auth 类型定义
└── utils/            # 日期、优先级、校验、主题色、统计聚合、赚钱换算、每日格言、金额拆位、头像工具、同步差异
supabase/schema.sql   # 任务表 + RLS 策略 + 头像 bucket 策略（可重复执行）
```

## 🎨 视觉规范与主题系统

设计语言：**浅灰底 + 白底大圆角卡片 + 单一绿色强调 + 大数字排版**，几乎不用阴影，靠底色差分层。

| 元素         | 落地方式                                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 页面底色     | `body` 已是 `bg-slate-100` / `dark:bg-slate-950`（`main.css`）                                                                                                                     |
| 卡片         | `.card`（`custom.css`）：白底 / 暗色 `slate-900` + `border-radius: calc(var(--app-radius) + 8px)`，即**圆角设置 小/中/大 = 16/20/24px**                                            |
| C 位强调卡   | `.card-accent`：深绿渐变底 + 白色大数字（赚钱秒表卡，暗色模式下保持不变）                                                                                                          |
| 强调色       | **默认 emerald**，`themeStore` 预设新增 `lavender`；`element-theme.css` 给静态基准值，运行时由 `useTheme` 把用户选择写进 `--el-color-primary` 系列变量                             |
| 组件跟随主题 | `BaseButton`(primary) / `BaseInput`(focus) / `BaseBadge`(primary) / `BaseCheckbox` / 设置页选中态 / ECharts 柱子颜色**全部读 CSS 变量**，换主题色即刻全站生效（不再硬编码 indigo） |
| 大数字       | `text-4xl font-bold tabular-nums tracking-tight`（秒表、完成度）                                                                                                                   |
| 涨跌徽章     | `TrendBadge` 原子组件：↑ 绿 / ↓ 红 / — 持平，支持自定义后缀与无障碍描述                                                                                                            |
| 仪表板布局   | 三列 bento grid（`lg:grid-cols-3`）：赚钱秒表深绿卡跨 2 行占 C 位，右侧依次是今日完成度环形卡、天气卡、每日格言，下方今日聚焦 + 任务概览，再往下是任务区与可视化                   |
| Element Plus | `--el-border-radius-base: 12px` 与卡片圆角协调                                                                                                                                     |

> 侧边栏 240px（可折叠 icon rail）+ 顶栏全局搜索 + 4 页面路由拆分已在第五阶段落地：
> 桌面端 `layouts/DefaultLayout.vue` 承载骨架，移动端走 `MobileBottomNav`，页面组件一律懒加载。

## 三个"算得准"的实现细节

### 赚钱秒表（`useEarnings` + `utils/earnings.ts`）

- **主次两个指标**：主指标是**今日已赚**（大号字、实时跳动），次指标是**本月已赚**（同屏小字），
  两者共用同一个日薪基准，数字能对上账。
- **不累加，只重算**：`setInterval` 每秒只做一件事——把 `now` 换成最新时间戳，金额由纯函数按
  `月薪分 × 已计薪秒 ÷ (月计薪天数 × 每日计薪秒)` 重新算一遍。浏览器后台会把定时器节流到 1 次/分钟，
  累加式实现切回页面误差巨大；差值式实现任意时刻切回来都是准的（另有 `visibilitychange` / `focus`
  监听，切回瞬间立即补算，不必等下一个 tick）。
- **整数「分」运算**：金额内部全部以整数分参与运算，只在渲染时格式化成 `1,234.56`，避免浮点累加误差。
- **只在计薪时间内累计**：上班前 / 周末金额恒为 0（由数据层拦截，不只是 UI 隐藏）、午休冻结在午休开始时刻、
  下班后封顶到今日满勤金额；支持午休扣除（含午休跨出工时的部分重叠计算）与自定义月计薪天数。
- **本月已赚的算法**：`已完整计薪天数 × 日薪 + 今日已赚`，并**封顶在月薪**。「已完整计薪天数」逐日判定
  （开启「仅工作日计薪」时跳过周六周日），只数到今天为止；封顶是因为月计薪天数取的是月平均 21.75 天，
  而个别月份有 22~23 个工作日，按位累计会略超工资，实际发放额就是月薪。月末数字会正好停在月薪。
- **状态文案**：上班前「距离上班还有 X」、午休「距离下午上班还有 X」、工作中「距离午休/下班还有 X」、
  下班后显示今日总计；上班前与周末**不显示今日金额**（只给文案），但「本月已赚」是月度累计、始终展示。
- **数字逐位上滑滚动（odometer）**：金额按位拆成 `DigitRoll`（每个窗口高 1em + `overflow:hidden`，
  内部 0-9 纵向一列，用 `translateY(-n × 1em)` + `transition` 完成上滑），约 40 行纯 CSS、不引动画库。
  三个关键细节：
  1. **只让变化的位滚动**——未变化的位 `transform` 目标值不变，CSS 过渡自然不触发，不需要新旧逐位对比逻辑；
  2. **按「位序」而不是字符下标分配 key**（`utils/amountDigits.ts`：个位 i0、十位 i1、十分位 f0…）——
     否则 999.99 → 1,000.00 插入一个千分位逗号会让后面所有位"错位"整行重滚；
  3. **等宽防抖 + 无障碍**——`tabular-nums` 避免 1 与 0 宽度不同导致整行抖动；滚动列 `aria-hidden`，
     完整金额另用 `sr-only` 提供给读屏。`prefers-reduced-motion: reduce` 时关闭过渡，数字直接切换。

### 今日完成度（`useStatistics.ts` 的 `computeTodayProgress`）

- 口径一句话说清：`今日完成 ÷（今日完成 + 今日到期未完成）`——分母是"今天台面上的事"（做完的 + 该做没做的），
  既不重复计数，也不受历史任务量影响。
- 涨跌徽章对比**昨日完成数**；昨日为 0 而今日有产出记 +100%（避免除零与 Infinity）。
- 今天既无到期任务又无产出时 `hasTarget` 为 false，卡片换成"今日暂无到期任务"引导文案，不显示 0% 的空环。

### 每日格言（`utils/dailyQuote.ts` + `data/quotes.json`）

- 问候语按当前时段切换（凌晨/早上/中午/下午/晚上），日期标签为「9月10日 星期四」。
- 「每日一句」用 **FNV-1a 哈希日期键**取模选句：同一天永远同一句（刷新、重进都不换），换一天自然换一句，
  纯前端零请求、无需定时任务；每分钟与切回标签页时校准，跨零点后自动更新。

## 快速开始

```bash
# 安装依赖
pnpm install

# 配置天气 API Key（可选，未配置时天气卡给出引导）
cp .env.example .env.local   # 然后填入 VITE_AMAP_KEY（高德「Web服务」Key）

# 配置 Supabase（可选，未配置时以本地模式运行）
# 在 .env.local 追加 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，
# 并在 Supabase SQL Editor 执行 supabase/schema.sql

# 启动开发服务器
pnpm dev

# 类型检查 / 构建
pnpm typecheck
pnpm build

# 测试 / Lint
pnpm test
pnpm test:coverage   # 覆盖率报告（核心逻辑行覆盖目标 ≥ 80%）
pnpm lint
```

## 一键启动（Windows）

双击项目根目录的 **`启动.bat`**（或桌面快捷方式「启动智能工作台」）即可：

1. 自动切换到项目目录，检查 Node.js 与依赖
2. 启动开发服务器（`vite --open`）
3. 自动打开浏览器到 <http://localhost:5173/>

关闭黑窗口（或按 `Ctrl+C`）即停止服务。

> 说明：该批处理文件**只包含 ASCII 字符**。cmd.exe 解析 .bat 时按「字节」记录文件位置，文件中只要出现多字节字符（中文），后续行就会错位并报 `'xxx' is not recognized`；因此启动器刻意不使用中文提示。

## 🧪 测试与覆盖率

```bash
pnpm test            # 全量单测（Vitest + happy-dom，跑完即退出）
pnpm test:watch      # 开发时监听
pnpm test:coverage   # 带覆盖率（@vitest/coverage-v8），text 打到终端 + html 落到 coverage/
```

（npm 用户把 `pnpm` 换成 `npm run` 即可；PowerShell 下若 `npm` 被策略拦住，用 `npm.cmd run test:coverage`。）

**只统计核心逻辑**——`src/utils` / `src/composables` / `src/stores` / `src/api` 四层（见 `vite.config.ts`
的 `test.coverage.include`）。页面与组件数量多、行为依赖真实浏览器环境，交给集成/组件测试护航更划算；
把它们塞进分母只会稀释数字，让阈值失去约束力。

阈值写在 `vite.config.ts` 的 `test.coverage.thresholds`：低于阈值**直接退出码非 0**，所以它不是徽章上的装饰，
而是能把回归拦在提交前的一道闸。全局取规划口径，另给 `utils` 单独加严一档（纯函数是规划里「必须全测」的一层，
一个总阈值会让它被其它层的高分掩盖）：

| 指标       | 全局阈值 | `src/utils` 阈值 | 实测       |
| ---------- | -------- | ---------------- | ---------- |
| lines      | 80%      | 95%              | **99.79%** |
| statements | 80%      | 95%              | **99.55%** |
| functions  | 80%      | 95%              | **99.72%** |
| branches   | 70%      | 90%              | **98.95%** |

分层实测（`pnpm test:coverage`，97 个 spec 文件 / 1451 条用例）：

| 层级                  | 语句   | 分支   | 函数   | 行     |
| --------------------- | ------ | ------ | ------ | ------ |
| `src/utils`（纯函数） | 99.6%  | 99.09% | 100%   | 100%   |
| `src/composables`     | 99.2%  | 97.64% | 100%   | 99.8%  |
| `src/stores`          | 99.44% | 99.38% | 99.18% | 99.31% |
| `src/api`（请求层）   | 100%   | 99.37% | 100%   | 100%   |

覆盖口径的**诚实说明**：

- **单测覆盖**：纯函数（薪资三模式换算、跨零点夜班时间差、金额整数「分」运算、日期归一化、odometer
  拆位、节假日查询、壁纸样式、标签与排序索引、搜索 URL/深链）、composables 的核心分支（提醒扫描与
  防重复标记、`useLocalStorage` 序列化容错、天气「定位 → 记忆位置 → 默认城市」降级链、主题模式与系统
  偏好联动、ECharts 实例的 dispose）、stores 的状态流转（标签增删不影响任务本身、归档/恢复改变统计
  口径、snooze 到期自动回归、撤销删除窗口用 fake timers 推进）、请求层的异常分类（AbortController
  超时、非 2xx、JSON 解析失败、网络异常）。
- **集成 / 组件测试覆盖**（**不计入**上面的覆盖率分母）：整站挂载与路由守卫、登录/会话恢复流程、
  云同步多端合并与离线队列、仪表板拖拽排序、AI 添加任务与拆解（含降级）、头像上传链路、
  秒表三种模式的界面状态等。它们断言的是「用户看到什么」，不是「某一行执行过」。
- **仍然没覆盖到的**（`coverage/index.html` 里能看到具体行号，都是可解释的）：
  ① **当前调用路径不可达的纯防御性兜底**——`earnings.ts` 的几处默认/`?? 0` 分支、`linkHelper.ts` 的旧数据兼容分支、
  `useStatistics.ts` 的空值兜底、`useECharts.ts` 的 SSR 早退、`httpClient.ts` 里 `clearTimeout` 的「没有定时器」分支、
  `useWeather.ts` 中「抛出的不是 Error 时的通用文案」。它们是为将来接入新调用方留的保护，现在没有真实入口；
  ② **只在部署环境或真实浏览器成立的分支**——`import.meta.env.BASE_URL` 取到子路径、IndexedDB 真实配额耗尽、
  真实通知权限弹窗。这些在 happy-dom 下用桩件模拟其**可观测后果**（如「存储不可用 → 静默降级为内存态」），
  但不去伪造一个现实中不存在的场景只为点亮某一行。

纪律：**先保纯函数再保分支，不为凑数字写装饰性测试**。只断言「跑到了这一行」的用例一律不写；
剩下的未覆盖行若确属不可达的防御代码，宁可留着并注明原因，也不为了数字好看而造测试。

## 天气 API 配置（高德地图）

数据源为**高德地图 Web 服务 API**（国内直连、中文城市名、实测 ~80ms），实况天气每小时更新多次。

**① 申请 Key**

打开 <https://console.amap.com/dev/key/app> → 创建应用 → 添加 Key → **服务平台必须选「Web 服务」**
（选成 JS API / Android / iOS 会报 `infocode 10009`，无法调用天气接口）

**② 写入 `.env.local`**（项目根目录，已被 Git 忽略）

```
VITE_AMAP_KEY=你的Key
```

**③ 重启开发服务器**（`.env` 只在启动时读取，改完必须重启）

### 接口要点（实现细节）

| 项目     | 说明                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 天气接口 | `https://restapi.amap.com/v3/weather/weatherInfo?city=<adcode>&extensions=base`                                                                                                |
| 城市参数 | 要求 **adcode**；API 层兼容 6 位 adcode 与中文城市名（后者自动走地理编码换算），当前 UI 只用「定位得到的 adcode」与「回落的默认城市名」                                        |
| 本地快查 | 内置 6 个常见城市（北京/上海/广州/深圳/杭州/成都）的 adcode 快查表，命中时省掉地理编码请求，只发 1 次请求                                                                      |
| 错误处理 | 高德**失败时仍返回 HTTP 200**，错误在响应体 `status/info/infocode` 中，代码已显式判断并转成中文提示                                                                            |
| 限流重试 | 免费 Key 实测约 **≥1 秒 1 次**才不被限流；命中 `10004/10014/10019/10021` 会自动退避重试（1s、2s）                                                                              |
| 本地缓存 | `api/weatherCache.ts`：adcode 与天气数据各缓存一份，默认 **30 分钟** 有效，写入 localStorage（刷新页面仍有效）；命中缓存不发请求，界面显示「缓存」标记，可点「↻ 刷新」强制跳过 |
| 字段差异 | 高德无「体感温度/风速」，提供的是 `winddirection`（风向）与 `windpower`（风力级别），故 `WeatherData` 中相关字段为可选                                                         |
| 天气图标 | 高德不提供图标，改用中文天气现象 → emoji 的纯函数映射（`weatherIcon`），不依赖外部图片                                                                                         |

常见错误码：`10001` Key 无效 · `10009` Key 平台类型不对 · `10003` 超出日调用量 · `10004`/`10021` 请求过于频繁（会自动重试）。

### 自动定位（实现细节）

进站降级链路：**自动定位 → 上次定位到的位置（localStorage 记忆）→ 默认城市**，任何一步失败都不影响使用，且卡片内会说明当前展示的是哪一级结果。

| 项目       | 说明                                                                                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 定位来源   | 浏览器 `navigator.geolocation`（`useGeolocation`，Promise 化 + 8s 超时 + 兜底定时器，避免永远卡在「定位中」）                                                                                                                                         |
| 坐标转城市 | 高德**逆地理编码** `/v3/geocode/regeo`，返回**区级** adcode（如 360111 青山湖区），实测可直接用于天气查询                                                                                                                                             |
| 位置文案   | 行政区名只能取自逆地理编码（天气接口按区级 adcode 查询时 `city` 其实是**区名**）：普通城市 = **区 · 城市 · 省份**（「青山湖区 · 南昌市 · 江西省」）；直辖市 = **区 · 城市**（「黄浦区 · 上海市」，此时城市即 province）。见 `utils/placeFormatter.ts` |
| 参数顺序   | `location=经度,纬度`（经度在前！写反会定位到完全不同的地方）                                                                                                                                                                                          |
| 位置记忆   | 定位成功即把 `{ adcode, label }` 写入 `smart-workspace:last-place`；**定位被拒/失败时优先回退到它**（比默认城市更贴近用户），请求直接走 adcode，不再消耗一次逆地理编码                                                                                |
| 交互       | 卡片默认展示当前位置天气，另有「🏙 城市」手动切换（输入城市名或点常用城市快捷键）；「📍 定位」重新定位、「↻ 刷新」跳过缓存重取；手动切换的城市也会写入位置记忆                                                                                         |
| 权限被拒   | 记录标记，之后进站直接用记忆位置（无记忆则默认城市），并在卡片内说明「定位权限已被拒绝」                                                                                                                                                              |
| 坐标纠偏   | 浏览器给的是 WGS84、高德用 GCJ-02，差异仅几百米，对「查哪个城市」无影响，故不做纠偏以省一次请求                                                                                                                                                       |

> ⚠️ **必须用 `localhost` 或 `https` 打开**：浏览器只在安全上下文提供定位。用局域网 IP（`http://192.168.x.x`）访问会被直接拒绝定位（会提示「定位权限被拒绝」并回落到默认城市）。部署到 Vercel 后是 https，可正常定位。

> ⚠️ 实现上有个坑：限流错误必须在 `withRetry` **内部**判定。因为高德失败时 HTTP 仍是 200，若把校验放在重试之外，重试永远不会触发（本项目已修正并有用例覆盖）。

## 👤 用户系统与多设备同步（第五阶段）

### 为什么选 Supabase

| 方案                     | 成本   | 结论                                                             |
| ------------------------ | ------ | ---------------------------------------------------------------- |
| 本地多用户档案（假登录） | 半天   | ❌ 换设备数据不通，价值有限                                      |
| **Supabase Auth**        | 1~2 天 | ✅ **已选**：真注册/登录 + GitHub OAuth + 云同步，一次解决两件事 |
| 自建 JWT 后端            | 3~5 天 | ❌ 偏离前端项目重心，性价比低                                    |

权限下沉到数据库层：前端只带 anon（公开）key，越权读写由 **RLS 策略**拦住，所以 key 泄露 ≠ 数据泄露。

### 配置步骤

1. <https://supabase.com> 新建项目 → Project Settings → API 复制 **Project URL** 与 **anon public key**
2. 控制台 → SQL Editor → 粘贴执行 `supabase/schema.sql`（脚本幂等，可重复执行）
3. Authentication → Providers：打开 **Email**；需要 GitHub 登录再打开 **GitHub**，
   回调地址填 `https://<project>.supabase.co/auth/v1/callback`
4. 项目根 `.env.local` 写入：

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

> 留空时应用自动进入**本地模式**：功能全部可用、不强制登录、不做云同步，登录页只展示配置引导，
> 不会把用户锁在一个永远登不进去的页面上。

### 邮件通道（可选，开启「Confirm email」才需要）

Supabase 内置的发信服务**只给项目团队成员邮箱发信，且限速 2 封/小时**
（[官方说明](https://supabase.com/docs/guides/auth/auth-smtp)），所以注册用别的邮箱就会失败。
配置自定义 SMTP 后限制解除（本项目实测上限提到 30 封/小时）。以 QQ 邮箱为例：

| 字段                | 值                                                                     |
| ------------------- | ---------------------------------------------------------------------- |
| 发件人邮箱 / 用户名 | 同一个 QQ 邮箱（**必须一致**，QQ 会校验 From 与认证账号）              |
| 发信人姓名          | 任意                                                                   |
| 主机 / 端口         | `smtp.qq.com` / `465`（隐式 TLS；`587` STARTTLS 同样可用）             |
| 密码                | QQ 邮箱的 **SMTP 授权码**（不是登录密码），入口：账号与安全 → 安全设置 |

> ⚠️ **排查「Error sending confirmation email」的正确姿势**：这个错误最常见的病因不是 SMTP 配错，
> 而是**收件邮箱根本不存在**。QQ 的 SMTP 在 `RCPT` 阶段对任何地址都回 `250 OK`，
> 到 `DATA` 阶段才校验并拒收（`550 The recipient may contain a non-existent account`），
> GoTrue 于是统一报这个英文错误。本项目已把它翻译成可操作的中文提示（见 `describeAuthError`）。
> 想绕过邮件通道：把「Confirm email」关掉即可注册即登录。

### 数据模型（`supabase/schema.sql`）

```sql
create table public.todos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null default '',
  completed  boolean not null default false,
  payload    jsonb not null default '{}'::jsonb,  -- priority/dueDate/subtasks/pinned/createdAt
  sort_order integer not null default 0,          -- 拖拽排序的顺序位
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create policy "todos: own rows only" on public.todos
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- **结构化查询字段单独成列**（`title` / `completed` / `sort_order`），其余扩展字段进 `payload jsonb`——
  以后加字段不用改表
- **显式 GRANT**：脚本给 `authenticated` 授了表权限、并显式 `revoke` 掉 `anon`。
  原因是 RLS 只负责"过滤行"，**前提是角色先有表级权限**——创建项目时若按官方建议关掉
  「自动暴露新表」，Supabase 就不再自动授权新表，缺了这行会直接报 `42501 permission denied`
- 头像 bucket `avatars`：公开读，写入限本人目录 `user_id/avatar.webp`（策略校验路径第一段 = `auth.uid()`）

### 同步模型：云端为准 + 本地缓存 + 离线队列（`stores/todoStore.ts`）

| 场景              | 行为                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 未登录 / 本地模式 | 行为与以前完全一致，只写 localStorage                                                                                               |
| 登录              | `activateCloud(userId)`：拉取云端 → 覆盖本地（首次登录则把本地旧数据**一次性迁移**上去）                                            |
| 日常改动          | 每个动作结束后由一处 **deep watcher 算指纹差异**（`utils/todoSync.ts`），只推送真正变化的任务，新增业务动作不用记得"顺手写同步代码" |
| 断网              | 改动进**持久化队列**（localStorage），状态显示「离线」，`online` 事件或下次进入时自动补发                                           |
| 退出登录          | 先把队列尽力送出去，然后**清空本地任务缓存**——任务属于账号，不能留在浏览器里给下一个登录者看见                                      |

几个容易踩的点：

1. **一次性迁移**：按 `smart-workspace:migrated:<userId>` 标记隔离，同一账号只迁一次；
   迁移时**本地优先合并远端**（远端独有的任务保留），不做双写。
2. **本地缓存的账号归属**：缓存带 owner 标记（`smart-workspace:todos-owner`）。若本地缓存属于**另一个账号**，
   激活时直接丢弃——否则会把 A 的任务推进 B 的账号（数据串号，最危险的一类 bug）。
3. **激活期间让 watcher 让路**：拉云端是异步的，激活前积压的 watcher 回调会在错误的时间点执行
   （基准快照还是空的），把整份列表误判成新改动重复推送；激活结束再做一次"补差"即可两全。
4. **推送顺序**：删除与新增串行补发，避免同一条任务的新增/删除乱序落地。

> 「两台设备数据一致」有**自动化用例**（`stores/todoStore.multiDevice.spec.ts`）：用一个**有状态的假云端**
> 模拟两台设备（各一份 localStorage + 各一个 Pinia），覆盖 ① A 新增 → B 首次登录就看到 ② B 完成/新增 → A
> 重新打开后收敛一致 ③ A 真正删除 → B 也不再看到 ④ **两台设备各自离线改动后先后上线，两边改动都保留、互不覆盖**。

### 同步状态怎么告诉用户（`composables/useSyncNotifications.ts` + `utils/syncNotice.ts`）

| 时机           | 反馈                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| 跨入离线       | **Toast 警告**「当前处于离线模式：改动已保存在本地，恢复网络后自动同步」+ 侧边栏常驻徽章「云同步 · 离线」+ 设置页文案 |
| 网络恢复       | **Toast 成功**「网络已恢复，改动已同步到云端」（只有真离线过才提示，正常同步不打扰）                                  |
| 旧数据迁移完成 | **Toast 成功**「已把本地 N 条任务迁移到云端」（同一条只提示一次）                                                     |

三个实现细节：

1. **状态机而不是"看上一态"**：恢复路径是 `offline → syncing → synced`（补发前会先切成 syncing），
   只看上一态会漏掉这次恢复，所以用 `wasOffline` 标记跨过中间态（`decideSyncNotice` 是纯函数，可单测）。
2. **不刷屏**：只在**跨入**离线时提示一次，而不是每次推送失败都弹一个 Toast；登出（回到 `local`）复位标记，
   下次登录再断网会重新提示。
3. **提示器可注入**：组合式函数不依赖 Element Plus（`App.vue` 传 `ElMessage`），单测注入假实现断言"弹了什么"；
   Toast 自身抛错也会被吞掉——UI 层异常不该冒泡回同步流程把补发链路带崩。

### 路由与守卫（`router/` + `router/authGuard.ts`）

- **页面拆分**：`/` 仪表板、`/todos` 任务、`/stats` 统计、`/settings` 设置、`/login` 登录（不套布局）；
  页面组件一律 `() => import()` 懒加载，构建后每页独立 chunk，首屏只加载仪表板
- **会话恢复不能闪跳**：`authStore` 初始状态是 `loading`，守卫 `await ensureReady()` 后再判定——
  刷新页面时 `getSession()` 还没回来就判"未登录"，已登录用户会被踢到登录页再弹回来
- **回跳参数只认站内路径**：`parseRedirect` 拒绝 `//evil.com`、`https://…`、相对路径，挡开放重定向
- **未配置 Supabase 直接放行**：没有云配置就没有"登录"这回事，本地模式下所有页面照常访问
- 未登录访问受保护页 → `/login?redirect=<原目标>`，登录成功后回跳；已登录访问 `/login` → 回仪表板
- **端到端接线有测试**：`router/authFlow.spec.ts` 用**真实路由表 + 真实守卫 + 真实 authStore + 真实环境判定**
  跑完整链路（重定向 → 登录 → 回跳 → 登出再拦 → 会话恢复放行）——守卫单独测、登录页单独测，
  都发现不了"守卫没装上 / store 没先恢复会话 / redirect 参数名不一致"这类接线错误
- **顶栏搜索是全局入口**：列表只在 `/todos` 渲染，所以在其他页面一输入就把用户带到任务页
  （否则是"输入了却什么都看不到"）；已在任务页时不跳转、清空关键字也不跳转

### 头像链路（`AvatarUpload.vue` + `composables/useAvatar.ts`）

1. **前置校验**：类型白名单（jpg/png/webp）+ 原图 ≤ 5MB 在浏览器端先拦（不白白上传一张 20MB 相机原图）
2. **圆形裁剪**：cropperjs 正方形裁剪框（`aspect-ratio="1"`）+ 圆形遮罩引导，支持拖拽与滚轮缩放
3. **压缩导出**：`$toCanvas(256×256)` → `toBlob('image/webp', 0.9)`，几百 KB 内
4. **分级存储**：已登录 → Supabase Storage `avatars/{user_id}/avatar.webp`（覆盖上传 + `?v=` 版本号做缓存失效）
   → URL 写回 `user_metadata.avatar_url` 跨设备可见；未登录 → **IndexedDB 存 blob**
5. **为什么不用 localStorage 存头像**：base64 塞进 localStorage，5MB 配额几下就爆，而且读写同步、阻塞主线程；
   IndexedDB 能原样存 Blob，异步且容量大
6. **一个隐藏的坑**：裁剪结果是 `Blob`，**必须用 `shallowRef` 而不是 `ref`**——
   普通 `ref` 会把对象包成响应式 Proxy，而 `Blob` 的方法依赖内部槽，
   Proxy 包装后在浏览器里调用 `upload/arrayBuffer` 会直接抛 `Illegal invocation`（已被用例覆盖）

## 在线部署

> **注册被手机验证挡住？** Vercel 对新账号强制手机验证，而 **+86 号码经常收不到验证码**（平台风控问题，与项目无关，官方没有跳过选项）。
> 本项目是纯静态 SPA，**下面三个平台都不要手机号**，仓库里已经把配置都备好了，哪边顺利走哪边即可。

| 平台                 | 登录方式             | 仓库内已备配置文件                             | 构建设置                                 |
| -------------------- | -------------------- | ---------------------------------------------- | ---------------------------------------- |
| **Vercel**           | GitHub               | `vercel.json`                                  | `pnpm build` → `dist`                    |
| **Cloudflare Pages** | GitHub（不要手机号） | `public/_redirects`                            | `pnpm build` → `dist`，`NODE_VERSION=22` |
| **Netlify**          | GitHub（不要手机号） | `netlify.toml` + `public/_redirects`           | 已写在 `netlify.toml`，导入即用          |
| **GitHub Pages**     | 就用现有 GitHub 账号 | `.github/workflows/deploy-pages.yml`（已备好） | 工作流里写死：测试 → `pnpm build` → 发布 |

四个平台的行为一致：**SPA 回退**（刷新 `/todos`、`/stats` 不 404）+ **构建期注入 `VITE_*` 环境变量**。
所以下面的环境变量表与自检清单一套通用。

> **国内可访问性**：`*.vercel.app`、`*.pages.dev`、`*.netlify.app` 这几个默认域名在国内并不稳定；
> `*.github.io` 一般可以直接打开。要给面试官看的话，GitHub Pages 最省心，或给上面任一平台绑自己的域名。

### 环境变量（必须，构建期注入）

Vite 的 `VITE_*` 是**构建时内联**的，所以变量要在平台里配好再构建（改完要重新 Deploy 才生效）：

| 变量                     | 用途                     | 不配的后果                                           |
| ------------------------ | ------------------------ | ---------------------------------------------------- |
| `VITE_AMAP_KEY`          | 高德「Web 服务」Key      | 天气卡显示"未配置 Key"的引导                         |
| `VITE_SUPABASE_URL`      | Supabase Project URL     | 应用进入**本地模式**（不登录、不同步，其余功能照常） |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key | 同上（anon key 是公开的，真正的权限在数据库 RLS）    |

### 步骤（Vercel）

仓库里已提供 `vercel.json`（SPA 重写 + 构建配置），**根目录就是仓库根**，不需要 Root Directory 设置：

```json
{
  "framework": "vite",
  "buildCommand": "pnpm build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Node 版本由 `package.json` 的 `engines.node`（`>=22.12.0`）声明——Vite 8 要求 `^20.19.0 || >=22.12.0`，
Vercel 会自动挑满足条件的版本；不使用 `packageManager` 字段，Vercel 依据 `pnpm-lock.yaml`（lockfileVersion 9.0）自动选 pnpm。

1. 把仓库推到 GitHub（本仓库根即 `vue3-smart-workspace/`），Vercel → **Add New → Project → Import** 该仓库
2. Framework 会自动识别为 Vite；确认 Build Command = `pnpm build`、Output Directory = `dist`
3. 展开 **Environment Variables**，把上表三个变量填进去（Production / Preview 都勾上更省事）
4. **Deploy**，等 1~2 分钟拿到 `https://<项目名>.vercel.app`
5. 回到 **Supabase → Authentication → URL Configuration**：Site URL 填 Vercel 域名，Redirect URLs 加上
   `https://<项目名>.vercel.app/**` 与 `http://localhost:5173/**`（GitHub OAuth 与邮箱验证/重置链接都靠它回跳）

> 不想接 GitHub 也可以走 CLI：`pnpm dlx vercel`（首次会引导登录并创建项目）→ `pnpm dlx vercel --prod`，
> 环境变量用 `pnpm dlx vercel env add VITE_AMAP_KEY` 逐个添加。代价是每次更新都要本地手动发一次。

### 步骤（Cloudflare Pages / Netlify）

两者都不用手机号，导入 GitHub 仓库后按下表填（配置大部分已在仓库里）：

| 项目                   | Cloudflare Pages                           | Netlify                                    |
| ---------------------- | ------------------------------------------ | ------------------------------------------ |
| Build command          | `pnpm build`                               | 读 `netlify.toml`（`pnpm build`）          |
| Build output directory | `dist`                                     | 读 `netlify.toml`（`dist`）                |
| Node 版本              | 环境变量 `NODE_VERSION=22`                 | `netlify.toml` 里已写 `NODE_VERSION=22`    |
| SPA 回退               | `public/_redirects`（构建时复制到 `dist`） | `netlify.toml` 的 redirects + `_redirects` |
| 环境变量               | Settings → Environment variables           | Site settings → Environment variables      |

部署完拿到的是 `https://<项目名>.pages.dev` 或 `https://<项目名>.netlify.app`，
**同样要回 Supabase 把这两个域名加进 Redirect URLs**（否则登录回跳会失败）。

### 步骤（GitHub Pages）

工作流已经写好在 `.github/workflows/deploy-pages.yml`（推送到 `main` 就自动跑，也可在 Actions 页面手动触发），
你只需要在 GitHub 网页上做**三件一次性设置**：

1. **开启 Pages 的 Actions 来源**：仓库 **Settings → Pages → Build and deployment → Source 选 `GitHub Actions`**
   （工作流里带了 `enablement: true`，多数情况下会**自动开启**、无需手动设置；若首次运行报
   "Get Pages site failed"，就回这里手动选一次 "GitHub Actions" 再重跑）
2. **加三条 Secrets**：仓库 **Settings → Secrets and variables → Actions → New repository secret**
   - `VITE_AMAP_KEY`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`
   - 必须走 Secrets（加密存储）：写进仓库文件会公开泄露高德 Key
   - 三条都不加也能部署成功，只是应用跑在**本地模式**：无登录/云同步、天气卡显示配置引导
3. **Supabase 加回跳域名**：Authentication → URL Configuration 的 Site URL 与 Redirect URLs 加上
   `https://<用户名>.github.io/<仓库名>/**`（否则 GitHub 登录与邮件链接会跳回 localhost）

站点地址形如 `https://lihuazou1230.github.io/vue3-smart-workspace/`。工作流里已处理两个 Pages 特有的坑：

| 坑                                                 | 处理方式                                                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 项目站点部署在 `/<仓库名>/` 子路径，绝对路径会 404 | 构建时注入 `BASE_PATH=/<仓库名>/`（`vite.config.ts` 读它），路由用的 `createWebHistory(import.meta.env.BASE_URL)` 会自动跟随 |
| Pages 对未知路径返回 404，刷新 `/todos` 会白屏     | 构建后 `cp dist/index.html dist/404.html`，让 404 页也是应用入口；另加 `.nojekyll` 防止 `_` 开头的产物被 Jekyll 丢掉         |

> 本地想验一遍子路径构建：`$env:BASE_PATH='/vue3-smart-workspace/'; pnpm build; pnpm preview`，
> 然后访问 `http://localhost:4173/vue3-smart-workspace/todos`——应为 200 且资源路径都带子路径前缀。

**踩坑记录：部署报 `status 400 … due to in progress deployment`**

GitHub 的已知问题（[actions/deploy-pages#22](https://github.com/actions/deploy-pages/issues/22)，96 条同类反馈）：
某次部署被中断/取消后，Pages 会残留一条 `in progress` 的部署记录，**之后每次部署都被直接拒绝**，
报 `Please cancel <sha> first or wait for it to complete`；而仓库 Deployments 列表里那条显示的是 `failure`
（两套账，很容易白查半天）。GitHub 官方在该 Issue 里确认已修复，但**已被锁住的记录最长要 1 小时才自动解除**。

工作流的「清理陈旧的部署记录」步骤会在部署前，用 Deployments API 把非 `success` 的历史部署标为
`inactive` 并删除（删的是记录，不影响已发布的内容），因此流水线能自愈、不用手工干预。

### 上线后的自检清单

- [ ] 首页仪表板能出数字（秒表在计薪时间内会跳动、今日完成度环形图有渲染）
- [ ] 刷新 `/todos`、`/stats`、`/settings` 这些子路由**不 404**（Vercel 靠 `vercel.json` 的 rewrite；
      Cloudflare / Netlify 靠 `_redirects`；GitHub Pages 靠 `404.html`）
- [ ] 天气卡能显示当前位置（必须 HTTPS，浏览器才给定位权限；`http://局域网 IP` 会直接被拒）
- [ ] 未登录访问 `/todos` 会跳到 `/login`，登录后回到 `/todos`（配了 Supabase 才有登录环节）
- [ ] 换一台设备／无痕窗口登录同一账号，任务数据一致
- [ ] 头像上传后侧边栏与设置页都显示圆形头像

本地也可以先验一遍"路由能不能直接访问"：`pnpm build && pnpm preview`，然后直接请求 `/`、`/todos`、`/stats`、
`/settings`、`/login`——5 条都应返回 200 且是应用 HTML（等价于上面那条 SPA rewrite）。

## 🖥️ 桌面版（Tauri 2）

> **架构原则：Web 应用是唯一本体，Tauri 只是「壳」。** 一套代码双发布渠道——浏览器版走 GitHub Pages，
> 桌面版出 exe，互不阻塞。桌面化只做**增量适配**，Web 版功能在壳里原样可用。

### 为什么选 Tauri 而不是 Electron

| | Tauri 2 ✅ | Electron |
|---|---|---|
| 包体 | **8~15 MB** | 100~150 MB |
| 内存 | 低（复用系统 WebView2） | 高（自带 Chromium，一个窗口几百 MB） |
| 额外依赖 | Rust + MSVC 工具链（一次性） | 无 |

### 环境前置（一次性）

| 组件 | 状态检查 | 说明 |
|---|---|---|
| Rust（stable-msvc） | `rustc --version` | `winget install Rustlang.Rustup` 后 `rustup default stable-x86_64-pc-windows-msvc` |
| VS Build Tools（C++ 工具链） | `vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64` | 链接器与 Windows SDK 来源 |
| WebView2 运行时 | Win10 21H2 / Win11 自带 | 老系统由安装包的 `downloadBootstrapper` 自动补装 |

> 💡 **国内网络提示**：直连 crates.io 的 sparse 索引是延迟瓶颈（实测 25 秒只前进 ~42KB）。
> 本机在 `~/.cargo/config.toml` 里配了 USTC 镜像（纯附加配置，删掉即回到官方源）：
> ```toml
> [source.crates-io]
> replace-with = 'ustc'
> [source.ustc]
> registry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"
> ```

### 开发与构建

```bash
pnpm tauri dev      # 桌面版热更新（起 Vite + 壳窗口）
pnpm tauri build    # 产出 exe
```

产物：

```
src-tauri/target/release/smart-workspace.exe                ← 绿色版，双击即用（4.91 MB）
src-tauri/target/release/bundle/nsis/智能工作台_0.1.0_x64-setup.exe  ← 安装版（2.01 MB，可选安装目录）
```

> 绿色版文件名来自 Cargo 的 `name`（Rust crate 名只能是 ASCII），窗口标题与安装包名来自
> `productName: 智能工作台`，所以两者不同名——这是 Cargo 的硬约束，不是配置漏了。

### 桌面版做了什么增量（全部经 `utils/platform.ts` 一处判定，Web 版零影响）

| 改造 | 实现 | 为什么 |
|---|---|---|
| **无边框窗口 + 自绘标题栏** | `tauri.conf.json` 里 `decorations: false`；`TitleBar.vue` 画 40px 标题栏：左图标名、中拖拽区（`data-tauri-drag-region`，双击最大化）、右三键（46×32，关闭键 hover 红） | 去掉 Windows 系统白条标题栏，界面从窗口最顶端开始——这是「原生质感」与「套壳网页」的分界线 |
| **去掉移动端底部导航** | `shouldShowBottomNav()` 在桌面版返回 false | 窗口最窄 900px，底部导航既占地方又「移动端感」十足 |
| **侧边栏默认折叠成活动栏** | 默认值取 `isTauri()`（VS Code Activity Bar 风格，tooltip 提示全名） | 桌面屏空间大，紧凑一点信息密度更高；点一下即可展开，选择会被记住 |
| **关闭 = 最小化到托盘** | Rust 侧 `CloseRequested` 里 `prevent_close()` + `hide()`；托盘菜单「显示主窗口 / 退出」 | **功能级增量**：窗口藏起来后秒表 tick 与提醒调度继续跑，到点照常弹原生通知 |
| **系统托盘** | `tauri::tray::TrayIconBuilder` + 菜单，左键单击显示窗口 | 「真桌面应用」的行为标志 |
| **外链唤起系统浏览器** | 全局 click 监听：只拦绝对 http(s) 链接 → `shell.open` | 壳内导航会让用户「走丢」回不来；`javascript:` 之类绝不交给 shell |
| **禁止误选文字** | `html[data-platform="desktop"] body { user-select: none }`，输入框/`.selectable` 例外 | 桌面应用习惯；但连标题都复制不了就是把原生感做成了残废 |
| **细滚动条** | 6px 半透明、hover 加深（两种形态共用） | 浏览器默认粗滚动条是「网页感」最大来源 |
| **默认紧凑密度** | 首次进入桌面版时写入 `compact` | 桌面屏空间大，信息密度优先；设置面板仍可调 |
| **窗口状态记忆** | `tauri-plugin-window-state` | 位置/尺寸/最大化状态不用每次重设 |
| **单实例锁** | `tauri-plugin-single-instance`（必须**第一个**注册） | 第二次启动不该开第二份，而是把已有窗口拉到前台 |
| **定位兜底** | 浏览器定位 → 上次位置 → **高德 `/v3/ip`** → 默认城市 | WebView2 定位要过系统隐私设置，被拒后没别的办法；IP 定位只要联网就能出城市级位置 |
| **vite base 双形态** | `TAURI_ENV_PLATFORM` 存在时强制 `base: '/'` | 桌面壳里带子路径会资源 404 → 白屏 |

### 数据隔离（要知道的一件事）

桌面版的 localStorage / IndexedDB 落在 `%LOCALAPPDATA%\<identifier>\EBWebView`（WebView2 的用户数据目录），
**与浏览器数据天然不共享**。想在两个渠道之间搬数据，可用未来要做的 JSON 导入导出，或直接登录 Supabase 云同步。

> 两个目录别混：**Web 数据**在 `%LOCALAPPDATA%\com.smartworkspace.desktop\EBWebView`，
> 而**窗口位置尺寸**在 `%APPDATA%\com.smartworkspace.desktop\.window-state.json`——
> 前者由 WebView2 管，后者由 window-state 插件管。
>
> **卸载时是否清数据由你决定**：生成的 NSIS 脚本里有个「是否删除应用数据」复选框
> （`installer.nsi` 的 `DeleteAppDataCheckbox`），勾了才 `RmDir /r` 掉上面两个目录；
> 不勾则任务、设置、窗口位置全部留在本机，重装即可继续用。

### CI（可选，与 Pages 双流水线）

`.github/workflows/build-desktop.yml`：打 tag（如 `v0.2.0`）自动构建 Windows 安装包并上传 Release——
同一个仓库，push 主分支发 Pages、打 tag 发桌面版。

### 验收记录（本机实测，2026-09-12 ~ 09-13）

| 验收项 | 实测结果 |
|---|---|
| 绿色版 exe 体积 | **4.91 MB**（`target/release/smart-workspace.exe`） |
| 安装版体积 | **2.01 MB**（`bundle/nsis/智能工作台_0.1.0_x64-setup.exe`） |
| 运行内存 | **29.2 MB** 工作集（Electron 同规模应用通常几百 MB） |
| 启动即原生感 | 窗口矩形 1296×809、客户区 **1280×800**，垂直非客户区仅 9px（纯调整边框）→ **无 31px 系统标题栏**，`decorations: false` 确实生效 |
| 窗口标题 | `智能工作台`（配置生效） |
| 前端已加载 | `msedgewebview2` 宿主进程挂在应用进程下（WebView2 载入成功，非白屏空壳） |
| 单实例锁 | 连续启动两次，进程数始终为 **1** → 第二次启动被拦截并聚焦已有窗口 |
| **关闭 = 最小化到托盘** | 向主窗口发 `WM_CLOSE` 后进程仍在（进程数 1）→ 关闭键不退出应用，秒表/提醒留在后台继续跑 |
| **窗口位置/尺寸记忆** | `MoveWindow` 到 (210,190,1020,690) → 关闭 → 状态文件写下 `x:210 y:190`（宽高存**客户区** 1004×681）→ 重启后 `GetWindowRect` 精确回到 (210,190,1020,690) |
| **CSP 与真实调用域名一致** | `connect-src` 覆盖高德 `restapi.amap.com`、`*.supabase.co`、`wxpusher.zjiecode.com`、`api.deepseek.com`、`open.bigmodel.cn`；`img-src https:` 覆盖 Google favicon 服务与 GitHub 头像 |
| **新 CSP 下前端真的跑起来** | 启动后 `%LOCALAPPDATA%\com.smartworkspace.desktop\EBWebView\Default\Local Storage\leveldb\*.log` 被写入 `smart-workspace:theme` = `compact` → 打包产物在主进程 CSP 下执行成功（不是白屏空壳），桌面默认紧凑密度也按预期落盘 |
| **CSP 已随构建生效** | 反查产物二进制：生产 CSP 为 `connect-src 'self' ipc: http://ipc.localhost https:`，`devCsp` 另含 `ws://localhost:5173`；旧的域名白名单字符串已不存在于二进制中 |
| Web 版不受影响 | 全量 1512 例测试通过；`title-bar` 只在 `platform=desktop` 下渲染 |

> 说明 1：`decorations: false` 无法用「有没有 `WS_CAPTION` 样式位」来判断——tao 保留了该位用于尺寸计算，
> 真正去掉标题栏靠的是 `WM_NCCALCSIZE`。所以判据是**客户区与窗口矩形的差**（上式），不是样式位。
>
> 说明 2：窗口状态记忆有坑——`tauri-plugin-window-state` 只在 `RunEvent::Exit` 落盘，`Moved`/`Resized`
> 仅更新内存缓存。而本项目「关闭」= 隐藏到托盘（**不退出进程**），只用关闭按钮的用户位置永远不会被持久化。
> 故在 `CloseRequested` 隐藏窗口后显式调用 `save_window_state(StateFlags::all())`；状态文件位于
> `%APPDATA%\com.smartworkspace.desktop\.window-state.json`。

**以下 4 项依赖真实人机交互，未做自动化实测**（合成鼠标输入会干扰用户当前桌面，不做）：

- 拖拽标题栏移动 / 双击最大化还原 / 三键 hover 语义色（组件层行为已由 9 例单测覆盖调用映射）
- 托盘图标右键菜单「显示主窗口 / 退出」
- 提醒到点弹 Windows 原生通知气泡（通道分支 7 例单测覆盖）
- 安装版安装与卸载（会改动本机注册表与安装目录，需你确认后再跑）

## 设计思路

- **原子设计**分层组件：原子（纯展示）→ 分子（简单交互）→ 有机体（连接 Store 处理数据）；
  模板层交给 `layouts/`，页面层交给 `pages/`
- **状态管理**：Pinia（任务 + 云同步、主题偏好、登录态）
- **运行时主题**：改主题色/圆角写入 `--el-color-primary` 系列 CSS 变量 + `ElConfigProvider` 注入密度，`html.dark` 一处切换深浅，无需重新编译主题包
- **撤销删除**：软删除 + 延迟提交，权衡数据安全与体验
- **纯函数优先**：赚钱换算（`utils/earnings.ts`）、每日格言（`utils/dailyQuote.ts`）、统计聚合（`useStatistics.ts`）、
  金额拆位（`utils/amountDigits.ts`）、同步差异与合并（`utils/todoSync.ts`）、头像校验（`utils/avatarImage.ts`）
  都做成可注入 `now` / 纯输入输出的纯函数，组件只负责渲染，逻辑好测也好讲
- **渐进增强的降级链路**：定位（定位 → 记忆位置 → 默认城市）、天气（缓存 → 接口 → 错误重试）、
  存储（localStorage → 内存态）、同步（云端 → 本地缓存 + 离线队列 → 本地模式）、
  头像（Storage → IndexedDB → 内存兜底）、动效（`prefers-reduced-motion` → 直接切换）都保证"永远有东西可看/可用"

## Git 规范

- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)（husky + commitlint 强制校验）
- 提交前由 lint-staged 自动执行 ESLint/Prettier
- ⚠️ commitlint 的 `subject-case` 规则只在 subject **以有大小写的拉丁字母开头**时生效：以 `ECharts`、`API` 这类英文缩写开头会被判为 start-case 而拒绝，写成中文开头即可

## 测试挖出并修掉的缺陷

第六阶段补测试时（覆盖率从 96% 推到 99.8% 的过程中）挖出 4 个真 bug，都已修复并把当时
「锁定缺陷现状」的用例反过来写成回归断言。第七阶段做桌面验收时又挖出 1 个（标题栏双击）。
这部分比覆盖率数字本身更有价值——**测试与验收的意义就是逼出这些**：

| 缺陷 | 后果 | 修法 |
|---|---|---|
| `useReminder` 的 30 秒轮询从未启动 | `useIntervalFn` 的 `immediate` 控制的是「是否自动 `resume()`」，传 `false` 定时器压根没建 —— 规划要求的周期轮询成了死代码 | 改 `immediate: true` + `immediateCallback: false`，首轮仍由挂载时显式 `scan()` 负责 |
| `isSearchEngineId` / `isThemeColorName` 用 `value in OBJ` | 原型链上的 `'toString'` 被当成合法值放行，随后取到函数直接 `TypeError`（值来自可被手改的 localStorage） | 改用 `Object.hasOwn` |
| `todoSignature` 漏掉新字段 | 只归档 / 只 snooze / 只改标签算不出差异 → **这些改动永远同步不到其它设备** | 指纹补上 `tags / archived / archivedAt / snoozedUntil / reminderAt / reminderOff` |
| snooze 到期不随日期回归 | 列表 computed 缺「今天」这个响应式来源，页面开一整夜后已到期任务仍被藏着 | `todoStore` 增加 `today` + `refreshToday()`，由 `App.vue` 每分钟与回前台校准 |
| 登录拉取云端期间的改动被吞（数据丢失） | 「补差」代码紧跟在赋值之后、比的是同一份数据，差异恒为空；期间新增的任务既没进队列也被覆盖 | 拉取**前**拍快照，用 `applyDiff` 把用户改动叠加到云端结果上并补发 |
| `httpClient` 的 `res.text()` 未包装 | 流被消费/连接中断时抛出原始 `TypeError`，与「任何失败都抛 `HttpError`」的约定不符 | 包成 `kind: 'network'` |
| `getCurrentCoords` 同步抛错未收敛 | 上层 `e instanceof GeoError` 判断落空，「已拒绝定位」标记记不住，每次进站都白试一次 | 同步异常也包成 `GeoError`，并校验坐标非 NaN |
| 标题栏自己绑了双击最大化（第七阶段查框架源码时发现） | Tauri 注入的 `drag.js` 已按 `e.detail === 2` 调 `internal_toggle_maximize`，我们再绑一次 `@dblclick` 就是第二次切换——**双击标题栏表现为毫无反应**（最大化后立刻还原） | 删掉自绑的 handler，只留 `data-tauri-drag-region` 标记；测试反过来断言「双击不得调用 toggleMaximize」防后人加回来 |

## 待优化项

- **主题偏好跨设备同步**：目前留在 localStorage，后续可选挂到 `auth.users.user_metadata`（本期不做，不阻塞主线）
- **冲突解决**：当前是"最后一次写入生效"（last-write-wins），多端同时编辑同一条任务可能互相覆盖；
  更严谨可引入 `updated_at` 版本号做乐观并发控制
- **提醒的"关页面也能收"**：已完成到 Edge Function 代理这一层，但服务端定时扫描（Supabase pg_cron）
  只在文档里给了方案没落地——它还需要把 UID 上服务端、service_role key 入 Vault 两个前置条件
- PWA 离线、数据导入导出、命令面板完整版（聚合搜索是其雏形）、Bing 每日壁纸
- **功能截图**：README 里的截图小节仍缺——它需要真实运行的界面截图（含暗色模式对比），
  不该用占位图凑数，等部署到 Pages 后补
- **法定节假日数据每年初需更新**（`src/data/holidays.json`，来源见 `src/utils/holidays.ts` 头注释）
- **桌面版自动更新**：规划里标为「可选」，本期未做——需要 `tauri-plugin-updater` + 一对签名密钥，
  且更新包要挂在 GitHub Releases 上；CI 已经会打 tag 出安装包，接上这一步只差配置

## 致谢

- **设计灵感来源：[薪跳 PayDance](https://github.com/MrBaoboer/PayDance)**（AGPL-3.0）。
  赚钱秒表的「薪资模式 / 状态机文案 / 诚实免责声明」等产品设计参考了它，但**没有使用其任何代码**，
  本项目为自研实现，许可证仍为 MIT。
- 生产热力图与迷你月历的视觉语言参考了 GitHub 贡献图与 Finexy 风格仪表板。

## 与规划文档的已知差异

施工过程中有几处**有意偏离**规划原文，都有具体理由；还有一处是规划写错了、按官方文档纠正：

| 规划原文                          | 实际实现                                                             | 理由                                                                                                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layouts/MobileLayout.vue`        | 无此文件，移动端由 `components/organisms/MobileBottomNav.vue` 承担   | 移动端与桌面端共用同一个 `DefaultLayout`，只是底部导航换成 bottom nav；再拆一个布局文件会带来两份几乎相同的骨架                                                                                                                          |
| `Login.vue` 用 ElForm 校验        | 自研 `BaseInput` + `utils/validation.ts` 纯函数校验                  | 校验规则要复用到 TodoForm/ResetPassword，抽成纯函数才能单测；ElForm 的规则是运行时配置，测起来反而绕                                                                                                                                     |
| 头像「方形裁剪框 + 圆形遮罩」     | 圆形引导环（无遮罩压暗），导出方形 256×256 + CSS `rounded-full` 显示 | 遮罩压暗后很难看清选区外的构图；导出方形是为了将来支持非圆形头像展示，圆形只在展示层做                                                                                                                                                   |
| `reminderAt`「默认策略自动生成」  | **不自动写入**，为空时由 `dueDate` 推导出默认提醒时间                | 可推导的字段写进每条任务只会让存储与云同步 payload 平白变胖；语义改为「用户改过才存」                                                                                                                                                    |
| WxPusher `contentType: 3`（HTML） | `contentType: 2`（HTML）+ `uids: [uid]` 数组                         | 规划此处写错了：按 [WxPusher 官方文档](https://wxpusher.zjiecode.com/docs/api-reference.html)，`1`=文本 / `2`=HTML / `3`=Markdown，照抄会把 `<p>` 当 Markdown 渲染；且 POST 接收人字段是 `uids` 数组（单数 `uid` 只存在于 GET 查询参数） |
| 侧边栏「帮助」入口                | 已实现（打开使用说明弹窗）                                           | —                                                                                                                                                                                                                                        |
| 卡片拖拽「等槽化」                | 按规划实现：进入编辑布局即切等槽网格，默认仍是精调 bento             | 变跨度卡片无法直接拖拽换位，等槽化是规划自己给出的取舍                                                                                                                                                                                   |
| CSP 只列 5 个 API 域名            | `connect-src 'self' ipc: http://ipc.localhost https:`                | 规划要求「白名单」，但第六阶段是 **BYOK**：用户可把 AI `baseUrl` 指向自建网关，Supabase 也可自托管——域名写死会让这些功能在壳里静默失效，违背「Web 版功能原样可用」。真正的防线是 `script-src 'self'`（没有可执行注入就不存在可利用的连接），故 `connect-src` 放开 `https:` |
| 绿色版叫 `智能工作台.exe`         | 实际为 `smart-workspace.exe`                                        | Cargo 的 crate/二进制名只能是 ASCII；`productName` 的「智能工作台」用于窗口标题与安装包名，两者不同名是工具链约束 |
| 通知「点击聚焦窗口并跳转任务」    | 桌面版只能弹 Toast，点击不深链；应用内兜底路径照常高亮任务           | 插件能力边界：`tauri-plugin-notification` 2.4.0 桌面端 `invoke_handler` 只注册 `notify`/`request_permission`/`is_permission_granted`，JS 侧 `onAction`/`onNotificationReceived` 依赖的 `register_listener` 与 `desktop.rs` 的点击处理**都只在移动端存在**——不是没写，是拿不到回调 |

## 许可证

[MIT](./LICENSE)
