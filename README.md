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
pnpm lint
```

## 一键启动（Windows）

双击项目根目录的 **`启动.bat`**（或桌面快捷方式「启动智能工作台」）即可：

1. 自动切换到项目目录，检查 Node.js 与依赖
2. 启动开发服务器（`vite --open`）
3. 自动打开浏览器到 <http://localhost:5173/>

关闭黑窗口（或按 `Ctrl+C`）即停止服务。

> 说明：该批处理文件**只包含 ASCII 字符**。cmd.exe 解析 .bat 时按「字节」记录文件位置，文件中只要出现多字节字符（中文），后续行就会错位并报 `'xxx' is not recognized`；因此启动器刻意不使用中文提示。

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
| 交互       | 卡片默认展示当前位置天气，另有「🏙 城市」手动切换（输入城市名或点常用城市快捷键）；「📍 定位」重新定位、「↻ 刷新」跳过缓存重取；手动切换的城市也会写入位置记忆                                                                    |
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

## 待优化项

- **主题偏好跨设备同步**：目前留在 localStorage，后续可选挂到 `auth.users.user_metadata`（本期不做，不阻塞主线）
- **冲突解决**：当前是"最后一次写入生效"（last-write-wins），多端同时编辑同一条任务可能互相覆盖；
  更严谨可引入 `updated_at` 版本号做乐观并发控制
- PWA 离线、键盘快捷键（VueUse `useMagicKeys`）、数据导入导出、命令面板、迷你月历、连续打卡（Streak）
- 拖拽排序用 `@vueuse/integrations` + `sortablejs`（`useSortable`）：同一套方案既服务任务列表，也服务仪表板卡片排序；换成列表库的好处是**移动端触摸拖拽同样可用**
- 测试覆盖率提升（当前 **57 个测试文件 / 601 个用例**，覆盖纯函数、store 状态流转、路由守卫与关键组件交互）

## 许可证

[MIT](./LICENSE)
