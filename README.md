# 云海工作台

[![Deploy to GitHub Pages](https://github.com/lihuazou1230/yunhai-workspace/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/lihuazou1230/yunhai-workspace/actions/workflows/deploy-pages.yml)
![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38bdf8?logo=tailwindcss&logoColor=white)
![Element Plus](https://img.shields.io/badge/Element%20Plus-2-409eff?logo=element&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)

一个集**任务管理、今日聚焦、子任务、批量操作、数据可视化、天气信息与外观自定义**于一体的个人效率仪表板，基于 Vue 3 + TypeScript + Tailwind CSS + Element Plus 构建。第五阶段接入 **Supabase**（Auth + Postgres RLS + Storage）后支持真实注册/登录与任务多设备同步；**不配置 Supabase 也能以「本地模式」完整使用**，不会把功能锁死。

> 当前进度：**第一 ~ 九阶段已完成**（基础建设 / 任务管理闭环 / 可视化与天气集成 / 体验优化与交付 / 用户系统与多设备同步 / 任务组织与仪表板完全体 / 桌面端打包 Tauri 2 / 数据可视化强化 + 上线部署自有服务器 IIS / **账号级数据一致性**）。

## 在线演示

- **自建服务器**：<http://124.220.159.58/workspace/>（Windows Server 2012 R2 + IIS 8.5 子应用，与主站二维码工具共用 80 端口；部署方式见下方「自有服务器 IIS」）
- **线上地址**：<https://lihuazou1230.github.io/yunhai-workspace/>（GitHub Pages，由 `.github/workflows/deploy-pages.yml` 自动部署）
- **源码仓库**：<https://github.com/lihuazou1230/yunhai-workspace>
- **桌面版**：`src-tauri/target/release/` 下的绿色版 exe 与 NSIS 安装包（见「桌面版（Tauri 2）」）

打开即用：任务管理、今日聚焦、子任务、批量操作、统计图表、热力图、赚钱秒表、每日格言、天气定位全部可用；
未配置 Supabase 时会自动进入**本地模式**（不登录、不云同步，其余功能完整）。

## 核心功能

- 👤 **用户系统**：邮箱密码注册/登录（含忘记密码邮件重置），刷新页面会话自动恢复（不闪跳登录页），未登录访问受保护页自动重定向并带原目标回跳
- 🛡️ **注册安全（两道闸，都卡在"发确认邮件之前"）**：**密码复杂度**（≥8 位 + 大小写 + 数字 + 弱密码黑名单，实时强度条列出"缺什么"，未达标按钮置灰）+ **Cloudflare Turnstile** 人机验证（token 由 Cloudflare 签发、**Supabase 服务端核验**，前端伪造无效；managed 模式正常用户无感通过；**登录 / 注册 / 忘记密码 / 重发验证邮件四条链路都带 token**——Supabase 的 Captcha 是全局开关）
- ☁️ **多设备同步**：任务写进云端 Postgres（行级安全 RLS），离线改动进队列、联网自动补发，旧 localStorage 数据登录后**一次性迁移**
- 🔄 **账号级数据一致性（第九阶段）**：不只任务——**主题外观、壁纸、标签、快捷导航、倒计时、仪表板布局与周目标、赚钱秒表配置、投入时长日志、提醒设置、默认搜索引擎**统统跟账号走，任一设备登录即是同一套；换账号登录会先清本地再拉新账号的（同一台电脑换人用不串数据）；凭证（AI Key / 微信 UID）与设备相关项（天气缓存 / 定位记忆 / 已通知标记）**刻意留在本机**，设置页可展开查看完整清单与理由
- 📚 **知识库问答（第十阶段）**：文档上传（pdf/md/txt/jsonl，≤10MB，超 2MB 异步入库）→ 递归分块 → 向量入库 → **SSE 流式问答并带引用来源**；库外问题**直接拒答不编造**，回答下方常显「基于知识库 / 不基于知识库 / 拒答」与命中的来源块。模型与 Key 全在独立后端仓库 [`yunhai-agent`](https://github.com/lihuazou1230/yunhai-agent)，前端只拿一个基地址
- 🧠 **会思考的助手（第十一阶段）**：知识库降级成 agent 的一个工具——问"分块默认多大"它自己去查并给引用；说"帮我加个明天交周报的任务"它调 `task_crud` 在**你自己的工作台数据上真的落库**（"明天"会先问日期工具换算成绝对日期）；问几点/天气秒回；闲聊不调用工具、也不进任务上下文。消息流里能看见它**调了什么工具、参数是什么、返回什么**
- 🖼️ **头像上传**：本地选图 → 圆形裁剪（cropperjs）→ 压成 256×256 WebP → 已登录传云端 Storage，未登录存 IndexedDB
- 📋 **任务管理闭环**：增删改查、状态筛选、优先级多选、关键字搜索、localStorage 持久化
- ↩️ **撤销删除**：软删除 + 1 分钟窗口内可撤销（Toast 倒计时）
- 📅 **截止日期**：今日/本周筛选、逾期标红、1天/1周/1月快捷调整
- 🎯 **今日聚焦（My Day）**：置顶 + 今日到期任务单独成列
- 📅 **迷你月历**：CSS Grid 自绘，有任务的日期标主题色圆点，点某天直接跳到任务页按那天筛选
- 🔥 **连续打卡 + 周目标**：连续 N 天（按 `completedAt` 聚合，纯函数 + 单测）、本周完成数、最佳日、周目标进度条（目标可直接在卡上改）
- 🧩 **可自定义仪表板**：默认是精调的三列 bento；点「编辑布局」切成等槽网格后**按住卡片任意位置就能拖动换位**（不用去够那个小把手；复用任务列表同一套 SortableJS）、每卡可**隐藏**与调**大小三档**（小/中/大），顺序与显隐持久化，新增卡片不会破坏已存顺序
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
- ☀️ **未来 3 日预报**：高德 `extensions=all` 免费档的 cast 列表直接渲染（以 3 天为上限），每列标「几号」（如 9月13日，跨月不歧义）而不是周几，预报失败不影响当前天气卡
- 🖼️ **背景壁纸**：纯色/渐变预设 + 本地上传（IndexedDB 存 blob，与头像同方案），卡片是不透明白底所以不影响可读性
- ☑️ **子任务清单**：任务内嵌 checklist + 完成度进度条
- 🖱️ **批量操作**：列表多选，批量完成/取消/删除/改优先级/归档/推后 1 天
- 🏷️ **任务标签**：8 色标签（新建表单里就地创建或点选），列表按标签筛选；任务只存标签 id，**改名/改色全局即时生效**，删标签只摘引用、任务不删
- ✨ **AI 智能添加**：任务页用一句话描述（「明天下午3点提醒我交周报，高优先级」）→ 解析成结构化任务 → **预览确认后才入库**；BYOK（Key 只存本机 localStorage），未配置时入口隐藏并引导设置
- 🧩 **AI 任务拆解**：大目标一键拆成 3~6 条子任务建议 → 预览清单可勾选/编辑/删减 → 确认后写入子任务；整体放弃不产生写入
  - 两条链路共用同一套可靠性三件套：`response_format: json_object` 强制结构化 → schema 校验（失败把错误回灌**重试一次**）→ 仍失败降级回手动表单，**AI 永远是加速器不是阻塞点**
- 📦 **任务归档**：归档后主列表与统计（含热力图）不再计入，但 `completedAt` 保留所以历史不丢；「已归档」视图可恢复、可彻底删除（走撤销保护）
- ⏩ **推后到期日**：一键把截止日期往后推 1 天 / 1 周 / 1 月（基准取**当前 dueDate**；没有截止日期的以今天为基准补上）。**任务始终留在列表里**，只是换了一天到期 —— 与旧版「稍后再做（Snooze）」的「藏起来 + 已隐藏视图 + 召回」是两套语义，那套已整体移除
- ✨ **拖拽排序**：按住行首把手拖动自定义顺序（SortableJS / VueUse `useSortable`，移动端同样可用；手动排序后不再自动重排）
- 💬 **每日格言**：按时段问候（早上好/下午好…）+ **登录后带上用户名**（「早上好，张三，今天是 9月13日 星期日」；本地模式不带称呼）+ 每日一句（本地 JSON 按日期哈希取句，同一天不换）
- 💰 **PayDance（赚钱秒表 Pro）**：卡片标题显示为 **PayDance**；主指标**每秒跳一次**「今日已赚 ¥xxx.xx」精准到分（tick 默认 1000ms，需要更细腻可传 `tickMs` / `useRaf`）并作为**整卡主体**（`text-5xl`~`sm:text-6xl`），**数字逐位上滑滚动**（odometer）；**薪资三模式**（月薪/日薪/时薪，统一换算到日薪）、**自定义每周计薪日**（单休/轮休）、午休剔除、**跨零点夜班**（22:00 → 06:00 按次日算）；**三栏统计条**（已工作 ｜ 距离午休/下班 ｜ 今日预计）；**进度光条钉在卡片底端**（`mt-auto`，悬浮右侧出百分比）；展开设置是同一张卡上的内容（背景壳延伸，见 `EarningsClock.vue`）；**迷你折叠模式**（只留金额小条，状态记忆）
- ✅ **今日完成度**：环形图 + 大数字展示「今日完成 ÷（今日完成 + 今日待办）」，附较昨日涨跌徽章
- 🎨 **外观自定义**：明暗模式（深色/浅色/跟随系统）、主题色（默认 emerald，预设色板含 lavender + 自定义取色器）、圆角、密度，实时生效并持久化（Element Plus CSS 变量 + ElConfigProvider）
- 📊 **数据可视化**：独立统计页 `/stats`——**完成趋势柱线混合图**（每日柱 + 7 日移动平均线）、**7×24 完成时段热力图**（一眼看出高效时段）、**标签占比环形图**（按首个标签归类，占比之和恒为 100%）、**投入产出散点图**（赚钱秒表投入时长 × 当日完成数，带相关系数）；**时间范围（本周 / 本月 / 全部）切换即时生效**，空数据一律有占位说明
- 🎉 **年度报告**：`/annual` 全年任务数、有产出的日子、最长连续完成、投入总时长、最高效月、最常用标签、最猛的一天；一键用 canvas 生成竖版分享卡（跟随主题色与深浅模式）并保存为图片
- 🔥 **生产力热力图**：近 90 天每日完成数 GitHub 风格色阶图（纯 CSS Grid）
- 📍 **自动定位**：进站自动显示**当前位置**的天气，位置文案为「区 · 城市 · 省份」（直辖市为「区 · 城市」）
- ☀️ **天气卡片**：自动定位 + **手动切换城市**（国内数据源 · 高德地图），emoji 天气图标、体感温差徽章、加载骨架屏、错误重试、30 分钟本地缓存、三级降级链路、未配置 Key 引导

## 技术栈

- **Vue 3**（`<script setup>`）+ **TypeScript**
- **Vite** 构建，路径别名 `@` → `src`
- **Tailwind CSS v3.4**（`darkMode: 'class'` 与 Element Plus 深色共用 `html.dark`）
- **Element Plus**（unplugin 按需自动导入）
- **Pinia** 状态管理 / **Vue Router**（仪表板 / 任务 / 统计 / 年度报告 / 知识库 / 设置 6 个页面按需懒加载 + 登录守卫 + keep-alive）
- **Supabase**（Auth 邮箱密码 · Postgres + RLS 任务存储 · Storage 头像 bucket）
- **cropperjs**（头像圆形裁剪）
- **ECharts**（`echarts/core` 按需注册图表类型）
- **Vitest** 单元测试 / ESLint + Prettier / Husky + commitlint

## 项目结构

```
src/
├── api/              # supabase 客户端 / auth 认证 / avatar 头像 Storage / userAssets 用户图片 Storage /
│                     # todoRemote 任务云端读写 / userSettingsRemote 偏好云端读写 / weather 天气 / notify 微信代理 /
│                     # agent 知识库后端（第十阶段：SSE 解析 + 上传/会话/任务轮询）
├── assets/styles/    # Tailwind 入口、Element Plus 主题变量、卡片/数字滚动等纯 CSS
├── components/
│   ├── atoms/        # BaseButton / BaseInput / BaseBadge / BaseCheckbox / DigitRoll / TrendBadge /
│   │                 # PasswordStrengthMeter 密码强度条 / TurnstileCaptcha 人机验证（第五阶段）/
│   │                 # BaseChatBubble 聊天气泡 / BaseCitationChip 引用块 / BaseToolTag 工具标签（第十/十一阶段）
│   ├── molecules/    # TodoItem / SearchBar / ThemeToggle / RollingAmount / ChartEmpty / StatsRangeTabs /
│   │                 # BaseMessageGroup 一条消息的完整装配（第十/十一阶段）
│   └── organisms/    # TodoList / TodoForm / MyDay / DailyGreeting / EarningsClock / TodayProgressCard /
│                     # WeatherWidget / SettingsPanel / SidebarNav / AvatarUpload / MobileBottomNav /
│                     # StatsTrendChart / StatsHourHeatmap / StatsTagDonut / StatsScatterChart（第八阶段）/
│                     # ChatPanel 知识库对话 / KnowledgeSidebar 文档管理（第十阶段）
├── agent/            # clientTools.ts：客户端工具执行器（task_crud / get_weather，第十一阶段）
├── composables/      # useTheme / useWeather / useEarnings / useECharts / useChartTheme / useStatistics /
│                     # useWorkLog / useSyncedStorage（账号级设置同步）/ useTurnstile（人机验证状态机）/
│                     # useAvatar / useIndexedDb
├── data/             # quotes.json（每日格言，本地 JSON 轮换）
├── layouts/          # DefaultLayout（侧边栏 + 顶栏 + 内容区 + 移动端底部导航）
├── pages/            # Dashboard / Todos / Stats / AnnualReport / Knowledge（第十阶段）/ Settings / Login / ResetPassword
├── router/           # 路由表 + authGuard（登录守卫与回跳校验）
├── stores/           # todoStore（含云同步）/ themeStore / authStore / tagStore / linkStore / wallpaperStore /
│                     # agentStore（第十/十一阶段：会话、消息、文档、流式状态、工具回环）
├── types/            # todo / weather / statistics / earnings / auth / settings（同步清单）/ agent（SSE 事件）类型定义
└── utils/            # 日期、优先级、表单校验、密码强度（auth）、主题色、统计聚合（stats/workLog/annualCard）、
                      # 赚钱换算、每日格言、金额拆位、头像工具、同步差异
supabase/schema.sql   # todos + user_settings 两张表、RLS 策略、avatars / user-assets 两个 bucket（可重复执行）
deploy/               # 第八阶段：IIS 子路径部署（web.config + install.ps1 + 部署说明.txt）
scripts/              # 构建辅助：desktop-build.mjs（桌面打包）/ build-deploy-package.ps1（部署包）
src-tauri/            # 第七阶段：Tauri 2 壳工程（Rust + tauri.conf.json + icons），前端零侵入
```

## 🎨 视觉规范与主题系统

设计语言：**浅灰底 + 白底大圆角卡片 + 单一绿色强调 + 大数字排版**，几乎不用阴影，靠底色差分层。

| 元素         | 落地方式                                                                                                                                                                                                                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 页面底色     | `body` 已是 `bg-slate-100` / `dark:bg-slate-950`（`main.css`）                                                                                                                                                                                                                                                                                                         |
| 卡片         | `.card`（`custom.css`）：白底 / 暗色 `slate-900` + `border-radius: calc(var(--app-radius) + 8px)`，即**圆角设置 小/中/大 = 16/20/24px**                                                                                                                                                                                                                                |
| C 位强调卡   | `.card-accent`：深绿渐变底 + 白色大数字（赚钱秒表卡，暗色模式下保持不变）                                                                                                                                                                                                                                                                                              |
| 强调色       | **默认 emerald**，`themeStore` 预设新增 `lavender`；`element-theme.css` 给静态基准值，运行时由 `useTheme` 把用户选择写进 `--el-color-primary` 系列变量                                                                                                                                                                                                                 |
| 组件跟随主题 | `BaseButton`(primary) / `BaseInput`(focus) / `BaseBadge`(primary) / `BaseCheckbox` / 设置页选中态 / ECharts 柱子颜色**全部读 CSS 变量**，换主题色即刻全站生效（不再硬编码 indigo）                                                                                                                                                                                     |
| 大数字       | `font-bold tabular-nums tracking-tight`：PayDance 主体 `text-5xl sm:text-6xl`（C 位要压得住），今日完成度 `text-4xl`                                                                                                                                                                                                                                                   |
| 涨跌徽章     | `TrendBadge` 原子组件：↑ 绿 / ↓ 红 / — 持平，支持自定义后缀与无障碍描述                                                                                                                                                                                                                                                                                                |
| 仪表板布局   | 三列 bento grid（`lg:grid-cols-3`）：第一行赚钱秒表深绿卡 + 今日完成度环形卡 + 天气卡，第二行迷你月历 + Streak/周目标 + 倒计时，第三行今日聚焦（通栏），最后是通栏快捷导航。秒表卡**不跨行**——跨行会让它的格高被邻居撑到 ≈ 580px，而内容只有 250px，收起设置后就是一大片空绿；「任务概览」卡已撤掉（信息与今日聚焦、任务页重复），今日聚焦顺势吃满整行，避免留下空格子 |
| Element Plus | `--el-border-radius-base: 12px` 与卡片圆角协调                                                                                                                                                                                                                                                                                                                         |

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

- 问候语按当前时段切换（凌晨/早上/中午/下午/晚上），日期标签为「9月10日 星期四」；
  **登录后中间插入用户名**（「早上好，张三，今天是 9月13日 星期日」），本地模式没有名字就不加称呼；
  昵称上限 20 字而页头只有一行，超过 12 字截断加省略号，避免把右边的格言挤没。
- 「每日一句」用 **FNV-1a 哈希日期键**取模选句：同一天永远同一句（刷新、重进都不换），换一天自然换一句，
  纯前端零请求、无需定时任务；每分钟与切回标签页时校准，跨零点后自动更新。

## 📊 数据可视化强化（第八阶段 8.1）

四张新图 + 一个独立统计页 + 一份年度报告，**零后端改动**：数据源本来就是就绪的
（`completedAt` 时间戳、标签、子任务、秒表时长），缺的只是聚合口径与画法。

### 口径先定死，再画图

所有聚合收在 `utils/stats.ts`（纯函数、`now` 可注入、全量单测），页面只做
「拿 store 数据 → 传 props」。这一层是刻意的：统计页与年度报告必须给出**同一个数字**，
口径散在两处迟早对不上账。三条统一约定：

| 约定     | 取值                                               | 为什么                                                     |
| -------- | -------------------------------------------------- | ---------------------------------------------------------- |
| 统计范围 | 只统计 `visibleTodos`（已归档任务不参与）          | 归档是"软删除"，若仍进统计，用户会发现"归档了但热力图没变" |
| 完成归日 | 按 `completedAt` 落到**本地**日期键                | 用户看的是自己的作息，不是 UTC 作息                        |
| 标签归类 | 按任务的**第一个标签**归类，无标签进「无标签」切片 | 多标签各计一次会让各切片占比之和 > 100%，环形图会撒谎      |

### 四张图各自解决什么

| 图                             | 数据                                     | 关键实现                                                                                                                    |
| ------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 📈 **完成趋势**（柱线混合）    | 每日完成数（柱）+ 7 日移动平均（线）     | 移动平均在**起点用已有项**（而不是留空），曲线不会断头；「全部」口径把窗口收敛到近 6 周，否则 X 轴会挤成毛刺                |
| 🕒 **完成时段分布**（heatmap） | `completedAt` 按「星期 × 小时」落格      | 用本地 `getHours()`；标题直接写出**峰值时段**（「周二 09:00（2 项）」），省得用户在 168 个格子里找                          |
| 🏷️ **标签占比**（环形图）      | 各标签完成数占比 + 平均「创建→完成」耗时 | 归类口径见上表；平均耗时把"占比高但很快做完"和"占比高且拖着做"区分开                                                        |
| ⚖️ **投入产出**（散点）        | X = 当日计薪时长（小时），Y = 当日完成数 | 全项目独一份的**跨模块联动**（赚钱秒表 × 任务）；另给皮尔逊相关系数，样本 < 2 或某一维无波动时**不下结论**（那种 r 是假的） |

### 投入时长从哪来（一个必须交代的设计决定）

规划原文假设「秒表时长都在 store」，但快照（`EarningsSnapshot`）天生只描述**此刻**——
关掉页面后，昨天计薪了多久就无从得知。所以新增了一份**最小投入日志**
（`utils/workLog.ts` + `composables/useWorkLog.ts`，`smart-workspace:worklog`）：

- 秒表 tick 时把「当日累计计薪秒数」按天记一条，**取较大值**（一天内它单调递增，取大值幂等，
  重复写/乱序写都不会把数字写小）；**不写 0**（保持稀疏，散点图才能区分"没投入"与"没数据"）。
- 按**整分钟**节流：快照每 100ms 变一次，不做这层节流就是每秒十次全量 JSON 序列化。
- `immediate` 落盘：下午 3 点才打开应用时，初始快照就已经是 5 小时，没有"变化"来触发写入。
- **要求薪资已配置**才记：没填薪资就等于没告诉过我们作息，按默认 09:00~18:00 累计是在编数据
  （夜班用户会全错）。金额为 0 只是不算钱，日志却会被年度报告当真。
- 写入时按 400 天窗口 + 条数上限裁剪，localStorage 不会无限长胖。

### 图表主题跟随（修「深色下发白」）

`composables/useChartTheme.ts` 由「主题色 + 深浅模式」派生出整套令牌（轴文字/网格/热力色阶/
提示框底色/强调色），组件把令牌 spread 进自己的 option——主题一变 option 重算 → `setOption` 重绘。
三个细节：**背景一律 `transparent`**（卡片自带底色与圆角，图表再铺一层纯色就会在圆角处露直角，
这正是"发白方块"的成因）、深色下热力色阶**向深底色混合**（直接用 `lighten` 会在深色底上糊成亮斑）、
提示框自带底色/边框/圆角/阴影。

> 代价：`useECharts` 的按需注册多了 Bar/Scatter/Heatmap/VisualMap 四个模块，
> 该 chunk 从 535 KB（gzip 181 KB）涨到 609 KB（gzip 205 KB）。它只在有图表的页面懒加载，
> 且规划明确要求这几张图，所以接受这个体积。

### 年度报告（`/annual`）

- **年份可切**（从数据里汇总出有记录的年份，默认今年），全年指标：完成数 / 新建完成率 /
  有产出的日子 / 日均 / 最长连续完成（按整年逐日回看，跨月不断档）/ 最高效月 / 最猛的一天 /
  最常用标签 / 投入总时长。
- **分享卡用 canvas 自绘**（`utils/annualCard.ts`，720×1000，按 DPR 出 2 倍图）：不引 html2canvas，
  版式固定反而完全可控；配色跟随主题色与深浅模式，与图表同待遇。
- 绘制逻辑只依赖一个 `CanvasRenderingContext2D` 形状的参数，单测传「记账用的假 ctx」逐条断言画了什么；
  `roundRect` 在旧 WebView 上缺失时走 `arcTo` 降级；拿不到 2D 上下文时**明说"当前环境不支持"**，
  而不是留一块空白让人以为坏了。

### 「图能画出来」也要有测试（SSR 冒烟）

happy-dom 没有 canvas 2D 上下文，`useECharts` 在测试环境里一律降级——于是「option 拼错一个键」
这类错误在单测里**永远暴露不出来**（页面不报错，只是图画不出来）。所以另加一层
`statsChartsRender.spec.ts`：用 ECharts 的 **SSR 模式**（`renderer: 'svg'` + `ssr: true`，
不需要 canvas，且必须关掉入场动画——SSR 只渲染第一帧，动画起点是零尺寸，拿到的是空图）
把四张图**真正算出来的 option** 渲染成 SVG，断言柱/线/热力格/饼片/散点都出现在输出里。

它走的是**真实的 `echarts.use([...])` 注册**（`vi.mock` 里用 `importOriginal` 保留原模块副作用）。
写第一版时正是这里翻了车：把整个模块 mock 掉导致图表类型一个都没注册，ECharts 安静地渲染出四张空图，
四条用例全红——这个坑本身就是保留这层冒烟测试的理由。

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

双击项目根目录的 **`启动.bat`**（或桌面快捷方式「启动云海工作台」）即可：

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
| lines      | 80%      | 95%              | **99.38%** |
| statements | 80%      | 95%              | **98.57%** |
| functions  | 80%      | 95%              | **99.35%** |
| branches   | 70%      | 90%              | **96.61%** |

分层实测（`pnpm test:coverage`，137 个 spec 文件 / 1940 条用例）：

| 层级                  | 语句   | 分支   | 函数   | 行     |
| --------------------- | ------ | ------ | ------ | ------ |
| `src/utils`（纯函数） | 99.19% | 97.62% | 100%   | 99.77% |
| `src/composables`     | 96.46% | 91.93% | 98.75% | 98.31% |
| `src/stores`          | 99.06% | 95.82% | 98.92% | 99.37% |
| `src/api`（请求层）   | 99.00% | 96.88% | 98.59% | 99.55% |

覆盖口径的**诚实说明**：

- **单测覆盖**：纯函数（薪资三模式换算、跨零点夜班时间差、金额整数「分」运算、日期归一化、odometer
  拆位、节假日查询、壁纸样式、标签与排序索引、搜索 URL/深链、**密码强度分级与弱密码黑名单**
  （恰 8 位 / 缺某一类字符 / 纯数字纯字母 / 黑名单命中与"包含不命中"的边界）、**第八阶段的统计聚合**——标签占比与多标签
  归类、7×24 时段落格、移动平均、投入产出散点与皮尔逊相关系数、年度报告各项与闰年连续天数、
  投入日志的取大值/裁剪/跨设备合并、canvas 分享卡绘制）、composables 的核心分支（提醒扫描与
  防重复标记、`useLocalStorage` 序列化容错、天气「定位 → 记忆位置 → 默认城市」降级链、主题模式与系统
  偏好联动、ECharts 实例的 dispose、投入日志的分钟级节流与未配置不记、
  **Turnstile token 状态机**——脚本加载成功/失败/超时、通过/过期/报错、一次性 token 的重置与重挂载、
  未配置 siteKey 的降级、
  **账号级设置同步引擎**——首次登录迁移、逐键 LWW 与合并型键、离线队列与重试、跨账号隔离、
  云端值写回全部订阅者）、stores 的状态流转（标签增删不影响任务本身、归档/恢复改变统计
  口径、推后到期日（含"过期任务也保证推了有用"的兜底）、撤销删除窗口用 fake timers 推进、壁纸本机与云端双来源）、
  请求层的异常分类（AbortController 超时、非 2xx、JSON 解析失败、网络异常、Storage 上传失败降级、
  **人机验证失败时的 Cloudflare 错误码翻译**）。
- **集成 / 组件测试覆盖**（**不计入**上面的覆盖率分母）：整站挂载与路由守卫、登录/会话恢复流程、
  **注册安全两道闸**（强度条实时分级与"缺什么"清单、未达强或验证码未过时按钮置灰、
  回车绕过置灰仍被拦下、mock Turnstile widget 的「通过 → 提交带 token → 失败后重置」、
  脚本加载失败时置灰并提示、切 Tab 丢弃旧 token）、
  云同步多端合并与离线队列、仪表板拖拽排序、AI 添加任务与拆解（含降级）、头像上传链路、
  秒表三种模式的界面状态、**统计页范围切换与四张图的空状态、四张图的 option 经 ECharts SSR 真渲染、
  图表配色跟随主题、年度报告的年份切换与分享卡降级提示、账号级设置同步的全部分支
  （首次迁移 / 冲突归属 / 离线重试 / 换账号隔离 / 合并型键 / 清单自检）、壁纸上传 Storage 与降级**等。
  它们断言的是「用户看到什么」，不是「某一行执行过」。
- **仍然没覆盖到的**（`coverage/index.html` 里能看到具体行号，都是可解释的）：
  ① **当前调用路径不可达的纯防御性兜底**——`earnings.ts` 的几处默认/`?? 0` 分支、`linkHelper.ts` 的旧数据兼容分支、
  `useStatistics.ts` 的空值兜底、`useECharts.ts` 的 SSR 早退、`httpClient.ts` 里 `clearTimeout` 的「没有定时器」分支、
  `useWeather.ts` 中「抛出的不是 Error 时的通用文案」、`stats.ts` 里年份汇总的极端过滤分支；
  ② **只在部署环境或真实浏览器成立的分支**——`import.meta.env.BASE_URL` 取到子路径、IndexedDB 真实配额耗尽、
  真实通知权限弹窗、**canvas 真实绘制（happy-dom 没有 2D 上下文，分享卡这条路径在测试里必然走"不支持"分支，
  绘制逻辑本身用假 ctx 逐条断言）**。这些在 happy-dom 下用桩件模拟其**可观测后果**（如「存储不可用 → 静默降级为内存态」），
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

| 项目     | 说明                                                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 天气接口 | `https://restapi.amap.com/v3/weather/weatherInfo?city=<adcode>&extensions=base`                                                                                                                                            |
| 城市参数 | 要求 **adcode**；API 层兼容 6 位 adcode 与中文城市名（后者自动走地理编码换算），当前 UI 只用「定位得到的 adcode」与「回落的默认城市名」                                                                                    |
| 本地快查 | 内置 6 个常见城市（北京/上海/广州/深圳/杭州/成都）的 adcode 快查表，命中时省掉地理编码请求，只发 1 次请求                                                                                                                  |
| 错误处理 | 高德**失败时仍返回 HTTP 200**，错误在响应体 `status/info/infocode` 中，代码已显式判断并转成中文提示                                                                                                                        |
| 限流重试 | 免费 Key 实测约 **≥1 秒 1 次**才不被限流；命中 `10004/10014/10019/10021` 会自动退避重试（1s、2s）                                                                                                                          |
| 本地缓存 | `api/weatherCache.ts`：adcode 与天气数据各缓存一份，默认 **30 分钟** 有效，写入 localStorage（刷新页面仍有效）；命中缓存不发请求（**界面上不再标「缓存」**——省额度是内部实现，不是用户要看的信息），要最新数据点「↻ 刷新」 |
| 字段差异 | 高德无「体感温度/风速」，提供的是 `winddirection`（风向）与 `windpower`（风力级别），故 `WeatherData` 中相关字段为可选                                                                                                     |
| 天气图标 | 高德不提供图标，改用中文天气现象 → emoji 的纯函数映射（`weatherIcon`），不依赖外部图片                                                                                                                                     |

常见错误码：`10001` Key 无效 · `10009` Key 平台类型不对 · `10003` 超出日调用量 · `10004`/`10021` 请求过于频繁（会自动重试）。

### 自动定位（实现细节）

进站降级链路：**自动定位 → 上次定位到的位置（localStorage 记忆）→ 默认城市**，任何一步失败都不影响使用，且卡片内会说明当前展示的是哪一级结果。

| 项目       | 说明                                                                                                                                                                                                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 定位来源   | 浏览器 `navigator.geolocation`（`useGeolocation`，Promise 化 + 8s 超时 + 兜底定时器，避免永远卡在「定位中」）                                                                                                                                                                                                         |
| 坐标转城市 | 高德**逆地理编码** `/v3/geocode/regeo`，返回**区级** adcode（如 360111 青山湖区），实测可直接用于天气查询                                                                                                                                                                                                             |
| 位置文案   | 行政区名只能取自逆地理编码（天气接口按区级 adcode 查询时 `city` 其实是**区名**）：普通城市 = **区 · 城市 · 省份**（「青山湖区 · 南昌市 · 江西省」）；直辖市 = **区 · 城市**（「黄浦区 · 上海市」，此时城市即 province）。见 `utils/placeFormatter.ts`                                                                 |
| 参数顺序   | `location=经度,纬度`（经度在前！写反会定位到完全不同的地方）                                                                                                                                                                                                                                                          |
| 位置记忆   | 定位成功即把 `{ adcode, label }` 写入 `smart-workspace:last-place`；**定位被拒/失败时优先回退到它**（比默认城市更贴近用户），请求直接走 adcode，不再消耗一次逆地理编码                                                                                                                                                |
| 交互       | 卡片默认展示当前位置天气，另有「🏙 城市」手动切换（输入城市名、点常用城市快捷键，或点面板里的「📍 用当前位置」回到自动定位）；**「↻ 刷新」= 重新定位 + 跳过缓存取最新**，所以工具栏不再单独放「📍 定位」按钮——展示的是定位结果就重新定位，手动选过城市则只刷新那座城市、不把定位盖回去；手动切换的城市也会写入位置记忆 |
| 权限被拒   | 记录标记，之后进站直接用记忆位置（无记忆则默认城市），并在卡片内说明「定位权限已被拒绝」                                                                                                                                                                                                                              |
| 坐标纠偏   | 浏览器给的是 WGS84、高德用 GCJ-02，差异仅几百米，对「查哪个城市」无影响，故不做纠偏以省一次请求                                                                                                                                                                                                                       |

> ⚠️ **必须用 `localhost` 或 `https` 打开**：浏览器只在安全上下文提供定位。用局域网 IP（`http://192.168.x.x`）访问会被直接拒绝定位（会提示「定位权限被拒绝」并回落到默认城市）。部署到 Vercel 后是 https，可正常定位。

> ⚠️ 实现上有个坑：限流错误必须在 `withRetry` **内部**判定。因为高德失败时 HTTP 仍是 200，若把校验放在重试之外，重试永远不会触发（本项目已修正并有用例覆盖）。

## 👤 用户系统与多设备同步（第五阶段）

### 为什么选 Supabase

| 方案                     | 成本   | 结论                                              |
| ------------------------ | ------ | ------------------------------------------------- |
| 本地多用户档案（假登录） | 半天   | ❌ 换设备数据不通，价值有限                       |
| **Supabase Auth**        | 1~2 天 | ✅ **已选**：真注册/登录 + 云同步，一次解决两件事 |
| 自建 JWT 后端            | 3~5 天 | ❌ 偏离前端项目重心，性价比低                     |

权限下沉到数据库层：前端只带 anon（公开）key，越权读写由 **RLS 策略**拦住，所以 key 泄露 ≠ 数据泄露。

### 配置步骤

1. <https://supabase.com> 新建项目 → Project Settings → API 复制 **Project URL** 与 **anon public key**
2. 控制台 → SQL Editor → 粘贴执行 `supabase/schema.sql`（脚本幂等，可重复执行）
3. Authentication → Providers：打开 **Email**（当前登录页只有邮箱密码一种方式）
4. Authentication → Settings：把 **最小密码长度调到 8**（与前端 `utils/auth.ts` 的规则对齐；这是绕过前端直接调 API 时的服务端兜底）
5. 项目根 `.env.local` 写入：

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA   # 人机验证，见下节；留空 = 不启用
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

### 注册安全：密码强度 + Cloudflare Turnstile

注册页是入口也是攻击面，所以卡两道闸——**都在服务端发确认邮件之前**：

**① 密码复杂度（`utils/auth.ts` 纯函数 + `PasswordStrengthMeter.vue` 强度条）**

| 规则                          | 说明                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| 长度 ≥ 8                      | 与 Supabase Dashboard 的最小长度对齐（改一处要同步改另一处）    |
| 同时含大写 + 小写 + 数字      | 「禁纯数字/纯字母」由这条覆盖，不再单列规则                     |
| 不在 50+ 条常见弱密码黑名单里 | 比对忽略大小写与首尾空格（`PassWord ` 同样命中 `password`）     |
| 弱 / 中 / 强分级              | 按满足的规则数：≤2 条「弱」、3 条「中」、4 条且不在黑名单「强」 |

- **未达「强」之前注册/改密按钮置灰**，强度条逐条列出"缺什么"；但**置灰挡不住回车**，
  所以 `validateForm` 里还会再拦一次（这条是被用例当场抓出来的）
- **登录页只查非空**：复杂度规则是后加的，老账号未必合规，服务端才是权威——前端按新规则拦下来，
  用户连登录都做不到，看到的还不是真实原因
- **服务端兜底**：前端校验是体验、不是防线，绕过前端直接调 API 时由 Dashboard 的最小密码长度守住

**② Cloudflare Turnstile（服务端核验，真防机器）**

canvas 自绘验证码的答案就在前端代码里（生成与校验用的是同一个随机串），只能防君子不防脚本；Turnstile 走四步闭环：

1. [Cloudflare 控制台](https://dash.cloudflare.com) → Turnstile → Add site，拿到 **siteKey**（公开）与 **secretKey**（私密）
2. secretKey 填进 **Supabase Dashboard → Authentication → Attack Protection → Bot and Abuse Protection**（启用 Captcha 校验）——**不进代码、不需要 Serverless**
3. 登录页渲染 widget（managed 模式：正常用户**无感通过**，可疑流量才弹交互挑战）→ 回调拿到**一次性** token
4. 请求带上 `captchaToken` → Supabase 服务端拿 secretKey 向 Cloudflare 核验通过，才放行

> ⚠️ **Supabase 的 Captcha 是全局开关，不止注册**：打开后 `/signup`、`/token`（登录）、`/recover`（忘记密码）、`/resend`（重发验证邮件）**都要求 token**。只在注册页放验证码，一开开关就会登不进去。
> 所以本项目把 widget 放在**三个 Tab 共用**的位置（切 Tab 不重挂载、已拿到的 token 继续有效），四条链路都带 token，并在每次提交后无条件 `reset()` 重取。

- **登录页渲染时机**：`tab` 切换不会重建 widget（`v-if` 之外），token 对登录/注册/忘记密码都通用；只有"被服务端消费掉"或过期才需要重新验证
- **token 一次性**：注册失败（邮箱已存在、发信失败……）、登录失败后都必须 `reset()` 重取，否则第二次提交必被服务端拒。
  这是这条链路里最容易漏的坑，`Login.vue` 在 `submit()` / `sendReset()` / `resendConfirm()` 的 finally 里都无条件重置
- **本地开发**不必申请真钥匙，用官方测试 siteKey 即可：`1x00000000000000000000AA` 总是通过（无感）、
  `2x00000000000000000000AB` 总是拦截（用来验证失败分支）
- **三条降级路径**（与"未配 Supabase 就进本地模式"同一套思路）：
  ① 未配 siteKey → 不渲染 widget、不拦任何操作（⚠️ 但**服务端若已开启 Captcha，请求仍会被服务端拒**——两处必须同时配好：Dashboard 开关 + 前端 siteKey）；② 脚本加载失败/超时 → 明确提示 + 「重试」（会清掉脚本缓存**真的重新请求**）+ 提交按钮置灰（不放行 = 不绕过服务端核验）；③ token 过期 → 「重新验证」
- **桌面版（Tauri）需要在 CSP 里放行** `https://challenges.cloudflare.com`（`script-src` + `frame-src`）——
  壳里原来的 `script-src 'self'` 会把 Turnstile 脚本直接拦掉，注册会永远停在「验证加载失败」。
  `pnpm desktop:build` 已于 2026-09-13 重新出包（绿色版 + 安装包），壳内注册可用

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

#### 第九阶段新增：`user_settings` 表与 `user-assets` bucket

```sql
create table public.user_settings (
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null,                 -- 前端 localStorage 键同名
  value      jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
create policy "user_settings: own rows only" on public.user_settings
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- **一行一个 key，而不是"一行一坨 JSON"**：手机上改主题、桌面上调卡片顺序，
  挤在同一个 jsonb 里就会互相覆盖（整坨 LWW）。拆键后冲突范围收敛到"同一个设置项"
- 同一套 `GRANT`/`REVOKE` 口径（授 `authenticated`、`revoke anon`）
- `user-assets` bucket：公开读、写入限本人目录 `user_id/wallpaper-<时间戳>.webp`——
  路径带时间戳，换图即换地址，天然绕开浏览器与 CDN 缓存（头像用的是固定路径 + `?v=` 版本号）

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

| 时机           | 反馈                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 跨入离线       | **Toast 警告**「当前处于离线模式：改动已保存在本地，恢复网络后自动同步」+ 设置页文案（侧边栏不再挂常驻徽章：导航区不放状态，状态归设置页） |
| 网络恢复       | **Toast 成功**「网络已恢复，改动已同步到云端」（只有真离线过才提示，正常同步不打扰）                                                       |
| 旧数据迁移完成 | **Toast 成功**「已把本地 N 条任务迁移到云端」（同一条只提示一次）                                                                          |

三个实现细节：

1. **状态机而不是"看上一态"**：恢复路径是 `offline → syncing → synced`（补发前会先切成 syncing），
   只看上一态会漏掉这次恢复，所以用 `wasOffline` 标记跨过中间态（`decideSyncNotice` 是纯函数，可单测）。
2. **不刷屏**：只在**跨入**离线时提示一次，而不是每次推送失败都弹一个 Toast；登出（回到 `local`）复位标记，
   下次登录再断网会重新提示。
3. **提示器可注入**：组合式函数不依赖 Element Plus（`App.vue` 传 `ElMessage`），单测注入假实现断言"弹了什么"；
   Toast 自身抛错也会被吞掉——UI 层异常不该冒泡回同步流程把补发链路带崩。

### 路由与守卫（`router/` + `router/authGuard.ts`）

- **页面拆分**：`/` 仪表板、`/todos` 任务、`/stats` 统计、`/annual` 年度报告、`/knowledge` 知识库（第十阶段）、`/settings` 设置、`/login` 登录（不套布局）；
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

### 邮件链接落地：验证完就直接进去（`utils/authRedirect.ts` + `api/auth.ts`）

点完确认邮件"没自动登录、还得手动登一次"是这类项目最常见的坑，根因通常在**落地页没认领邮件带回来的凭据**。四种形态都要认：

| 邮件里的链接                                                                    | 地址栏出现什么                                | 谁处理                                                 |
| ------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| 默认模板 `{{ .ConfirmationURL }}`（GoTrue 服务端验证后 302 回站点）             | `#access_token=…&refresh_token=…`             | supabase-js 的 `detectSessionInUrl` 自己换             |
| 客户端开了 PKCE                                                                 | `?code=…`                                     | `exchangeCodeForSession`（本地要还留着 code_verifier） |
| 模板改成 `{{ .SiteURL }}/auth/confirm?token_hash=…&type=signup`（SSR 推荐写法） | `?token_hash=…&type=…`                        | **`verifyOtp`——库不会自动处理这一种**                  |
| 链接过期 / 被邮箱安全扫描器先点过一次                                           | `#error=access_denied&error_code=otp_expired` | 翻成「请回登录页重新发送一封」                         |

三个实现要点：

1. **顺序：先认领凭据，再恢复会话**（`authStore.init()` 里 `consumeAuthRedirect()` 在 `getSession()` 之前）——
   反过来的话凭据还没换成会话，`getSession()` 拿到空的，用户点完邮件就会被判成"未登录"而停在登录页
2. **用完即清地址栏**：一次性凭据留在 URL 里，用户一刷新就会拿同一个凭据再换一次 → 报「已过期或已被使用」，
   看起来像"刚验证完就失效"。`stripAuthParams` 只删认证参数，保留业务 query 与 hash
3. **已登录落在登录页要自动送进去**：`Login.vue` 监听 `isAuthed`，一旦为真立刻 `router.replace(目标页)`
   （覆盖"会话比守卫判定晚一步建立"和"在别的标签页已登录又手动打开 /login"两种情况）

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

## 🔄 账号级数据一致性（第九阶段）

第五阶段只把**任务**送上了云，于是"换了台设备就像换了个应用"：主题、标签、快捷导航、布局、秒表配置全在另一台机器上。
第九阶段把**偏好类数据**也挂到账号上——判断标准只有一条：**同账号在任何设备（浏览器 / 桌面版 / 手机）登录，看到的是同一套。**

### 谁跟账号走、谁留在本机

| 跟账号走（`user_settings`，16 项）                           | 留在本机（刻意，不是漏了）                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 主题与外观、壁纸、标签、快捷导航、纪念日倒计时、发薪日       | **AI Key（BYOK）/ 微信推送 UID**——用户级凭证，进数据库等于多一份泄露面，换设备重填一次即可 |
| 仪表板卡片顺序/显隐/大小/自定义标记、周目标                  | **已通知标记**——同步过去会让另一台设备该提醒时被标成"已提醒"而静默不响                     |
| 赚钱秒表配置与迷你模式、投入时长日志、提醒设置、默认搜索引擎 | **天气缓存 / 上次定位城市 / 定位被拒标记**——设备相关，手机与桌面本来就不在同一座城市       |
| 任务（走自己的增量同步通道，见第五阶段）                     | **侧边栏折叠状态**——跟着屏幕尺寸走的界面细节                                               |

> 设置页「数据同步 → 偏好设置」里有可展开的清单与逐条理由：用户不必读源码就知道**什么被传上去了**。

### 同步层怎么工作（`composables/useSyncedStorage.ts`）

用法与 `useLocalStorage` 一模一样（`useSyncedStorage(key, default)`），多的是一层云同步：

1. **本地优先**：读写先落 localStorage（同步、瞬时、离线可用），云端只是"另一个副本"；
   绝不做成"等网络回来再渲染"——那样断网等于应用坏了。
2. **逐键合并**：一行一个 key，冲突范围收敛到"同一个设置项"（见上面的表结构）。
3. **localStorage 是本地唯一真相，ref 只是视图**：同一个键可能被多处持有
   （`useEarnings` 在 App.vue 与秒表卡各一次、`useWorkLog` 四个页面都有），
   所以同步层不"挑一个 ref 当代表"，而是读存储、并把云端值写回**所有**订阅者。
4. **冲突判定不看本机时钟**：只比「本地是否有未推送的改动」+「云端 `updated_at` 是否变过我上次推上去的那一版」。
   笔记本时区错了、系统时间被改过都不会算错。合并规则：本地有未推送改动 → 本地赢；否则云端时间戳更新 → 云端赢。
5. **离线队列只记"哪个键脏了"**：推送时取当前值（设置项是整值快照语义，重放旧操作反而会把中间态推上去）。
   断网时从失败那一项起保留队列，联网（`window online`）或手动「立即同步」再补发。
6. **合并型键要"先读后合并再推"**：投入时长日志按日期逐项取大值合并——
   两台设备各记了不同的日子，直接用本地覆盖会把另一台那几天抹掉，而这份数据不可再生
   （用户不会记得三天前在另一台电脑上工作了几小时）。所以它推送前会先拉云端那一行做合并。
7. **跨账号隔离**：`settings-owner` 记住本地数据属于谁。**换账号登录时先把本地重置为默认再拉新账号的**，
   绝不把 A 的偏好写进 B 的账号（同一台电脑换人用很常见）；登出后再登**同一个**账号不算换账号，不白重置。
8. **首次登录即迁移**：本地模式下攒下的设置（非默认值的那些）在第一次登录时一次性推上账号。

### 壁纸（二进制怎么办）

配置（纯色/渐变/图片地址）走 `user_settings`，**图片本体走 Supabase Storage `user-assets`**：
已登录时保存图片会顺带上传，配置里记下公开地址，于是换设备登录直接就能看到同一张壁纸；
上传失败只降级"换设备也能看到"这一条，本机壁纸照常生效（本机那份仍存 IndexedDB，离线可用）。
展示优先级：云端地址 → 本机 blob。

> **桌面版与浏览器的数据隔离因此不再是问题**：本地缓存各存各的（WebView2 有自己的用户数据目录），
> 但**登录后云端才是共同真相**，两边看到的是同一套任务与设置。

## 📚 知识库（第十阶段）

前九阶段这个仓库是一个"没有后端的仪表板"；第十阶段第一次引入服务端——但**没有**把 Python 塞进这个仓库：
AI 能力全部落在独立仓库 **`yunhai-agent`**（FastAPI + Chroma + bge-small-zh），
本仓库只多了一个消费它的知识库页。前端拿得到的东西只有三样：一个基地址、一条 SSE 事件流、一份自检信息。

### 前端这一层做了什么

| 位置 | 内容 |
| --- | --- |
| `types/agent.ts` | 七种 SSE 事件类型一次定死（token / tool_call / tool_result / citation / proposal / done / error）+ 领域类型 |
| `api/agent.ts` | 原生 fetch + `ReadableStream` **手写 SSE 解析**（按 `\n\n` 切帧、跨分片拼帧）、非流式接口、任务轮询、错误翻译 |
| `stores/agentStore.ts` | 会话 / 消息 / 文档 / 自检 / 流式状态；`ask()` 把事件逐条落到当前消息上 |
| `organisms/KnowledgeSidebar.vue` | 连接自检、基地址、拖拽上传、文档清单与删除、两步清空、向量模型自检入口 |
| `organisms/ChatPanel.vue` | 流式逐字、停止、检索策略与兜底模式切换、示例问题、依据横幅 |
| `atoms/BaseChatBubble.vue`、`BaseCitationChip.vue`、`molecules/BaseMessageGroup.vue` | 气泡（引用编号高亮）、引用块（空态 = "无知识库来源"）、一条消息的完整装配 |

### 四个值得单独说的决定

1. **手写 SSE 而不是 EventSource**：EventSource 只支持 GET，而问答要 POST 带 body。
   自己解析只有十几行，还顺带解决了"一帧被网络切成两半"的经典坑（解析器按缓冲区切 `\n\n`，
   跨分片自动拼接——这条路径有专门的用例）。
2. **流里的 `error` 不是异常**：后端刻意让 HTTP 保持 200、把错误发在流里，
   前端因此只有**一条**错误路径：无论是"后端没配 Key"还是"模型限流"，都是同一个事件、同一处渲染。
3. **引用块永远显示**：命中就列出「文件名 + 页码/块号 + 相似度 + 片段」，没命中就写「无知识库来源」，
   并标出这次回答是**基于知识库 / 不基于知识库 / 拒答**。RAG 的可信度全靠这两样撑着，藏起来等于没有。
4. **停止生成是真的取消**：`AbortController` 断开 fetch，后端随之停止生成；
   而不是前端把字藏起来继续收（那样用户以为停了，额度还在烧）。

### 第十一阶段：前端这一侧多出来的东西

后端从"固定检索直答"变成了 **ReAct 循环 + 工具**，前端相应多了三块：

| 位置 | 内容 |
| --- | --- |
| `agent/clientTools.ts` | **客户端工具执行器**：`task_crud`（在工作台的任务数据上真的增删查改）与 `get_weather`（只读本机天气缓存）。永不抛异常——失败一律变成给模型的观察结果 |
| `agentStore.ask()` | **回环驱动**：一条流结束在 `status=awaiting_client` 时，执行 `pending` 里的客户端工具，再 `POST /api/ask/resume` 把结果送回去继续同一轮（有 5 次上限，避免死循环） |
| `atoms/BaseToolTag.vue` | 消息流里的工具标签：调了什么、参数是什么、跑成没跑成、返回了什么（可展开） |

为什么任务操作要绕一圈回前端执行：**任务数据只存在于工作台里**（localStorage + Supabase + Tauri 数据目录），
后端没有也不该复制一份真相。所以后端只负责"想"（发 `tool_call(executor=client)` 并把这一轮状态存起来），
执行发生在数据所在地；两段用的是**同一条 SSE 协议**，前端还是一套解析器。

好处是"帮我加个明天交周报的任务"这句话，最终改动的是你**真实的任务列表**，
而不是后端数据库里的一份影子副本；坏处是多一次往返（本机实测 1~2 秒量级）。

### 本机怎么跑起来

```powershell
# 1) 起后端（独立仓库，默认 8000 端口）
cd ..\yunhai-agent
.venv\Scripts\python -m uvicorn app.main:app --port 8000
# 2) 前端照常
pnpm dev
```

知识库页侧栏可改后端基地址（默认 `http://127.0.0.1:8000`，存在本机，不进账号同步）。
**未配 LLM Key 也能用**：上传、检索、引用、拒答四条链路都不需要 Key，
只有"自由生成答案"需要（后端 `.env` 的 `LLM_API_KEY`）——页面会明说缺什么。

> 检索质量的实测数据（语义 vs 字面 BM25 的 recall/MRR 与阈值校准、端到端答案验收、
> 以及第十一阶段的工具轨迹与护栏验收）分别在 `yunhai-agent/eval/report.md`、
> `eval/answer_report.md`、`eval/agent_report.md`。结论如实记录：这份 30 块的小语料上
> 两者 recall@1 打平、BM25 在 recall@4 上更满；而**分块粒度**（把 Markdown 小节硬断）才是
> 把语义 recall@1 从 0.562 拉到 0.750 的那一步——调参之前先看数据。

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

| 变量                      | 用途                              | 不配的后果                                                                                        |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `VITE_AMAP_KEY`           | 高德「Web 服务」Key               | 天气卡显示"未配置 Key"的引导                                                                      |
| `VITE_SUPABASE_URL`       | Supabase Project URL              | 应用进入**本地模式**（不登录、不同步，其余功能照常）                                              |
| `VITE_SUPABASE_ANON_KEY`  | Supabase anon public key          | 同上（anon key 是公开的，真正的权限在数据库 RLS）                                                 |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare Turnstile 公开 siteKey | 注册页不渲染人机验证、也不拦注册（**关闭**这道闸，不是报错）；secretKey 只填在 Supabase Dashboard |

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

1. 把仓库推到 GitHub（本仓库根即 `yunhai-workspace/`），Vercel → **Add New → Project → Import** 该仓库
2. Framework 会自动识别为 Vite；确认 Build Command = `pnpm build`、Output Directory = `dist`
3. 展开 **Environment Variables**，把上表三个变量填进去（Production / Preview 都勾上更省事）
4. **Deploy**，等 1~2 分钟拿到 `https://<项目名>.vercel.app`
5. 回到 **Supabase → Authentication → URL Configuration**：Site URL 填 Vercel 域名，Redirect URLs 加上
   `https://<项目名>.vercel.app/**` 与 `http://localhost:5173/**`（邮箱验证与重置密码链接靠它回跳）

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
   `https://<用户名>.github.io/<仓库名>/**`（否则邮件里的验证/重置链接会跳回 localhost）

站点地址形如 `https://lihuazou1230.github.io/yunhai-workspace/`。工作流里已处理两个 Pages 特有的坑：

| 坑                                                 | 处理方式                                                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 项目站点部署在 `/<仓库名>/` 子路径，绝对路径会 404 | 构建时注入 `BASE_PATH=/<仓库名>/`（`vite.config.ts` 读它），路由用的 `createWebHistory(import.meta.env.BASE_URL)` 会自动跟随 |
| Pages 对未知路径返回 404，刷新 `/todos` 会白屏     | 构建后 `cp dist/index.html dist/404.html`，让 404 页也是应用入口；另加 `.nojekyll` 防止 `_` 开头的产物被 Jekyll 丢掉         |

> 本地想验一遍子路径构建：`$env:BASE_PATH='/yunhai-workspace/'; pnpm build; pnpm preview`，
> 然后访问 `http://localhost:4173/yunhai-workspace/todos`——应为 200 且资源路径都带子路径前缀。

**踩坑记录：部署报 `status 400 … due to in progress deployment`**

GitHub 的已知问题（[actions/deploy-pages#22](https://github.com/actions/deploy-pages/issues/22)，96 条同类反馈）：
某次部署被中断/取消后，Pages 会残留一条 `in progress` 的部署记录，**之后每次部署都被直接拒绝**，
报 `Please cancel <sha> first or wait for it to complete`；而仓库 Deployments 列表里那条显示的是 `failure`
（两套账，很容易白查半天）。GitHub 官方在该 Issue 里确认已修复，但**已被锁住的记录最长要 1 小时才自动解除**。

工作流的「清理陈旧的部署记录」步骤会在部署前，用 Deployments API 把非 `success` 的历史部署标为
`inactive` 并删除（删的是记录，不影响已发布的内容），因此流水线能自愈、不用手工干预。

### 步骤（自有服务器 IIS，子路径 `/workspace/`）

> **目标形态**：`http://124.220.159.58/workspace/`。服务器是 **Windows Server 2012 R2 + IIS 8.5**，
> 80 端口上已经跑着另一个站点（图片二维码工具），**不能覆盖、但可以挂子路径共存**；
> 5000 是个税项目、9090 是系统 HTTPAPI 服务、3389 是 RDP，都不能碰。
> 既然不动安全组、不开新端口，就复用唯一已放行的 **80**。

| 决策点   | 选择                                                | 理由                                                                                                                                                                                                             |
| -------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 部署方式 | **RDP 3389 + 一键部署包**                           | 445/5985/135 全关、不装 SSH → 没有命令行通道；RDP 剪贴板原生支持文件复制                                                                                                                                         |
| 访问地址 | **`http://124.220.159.58/workspace/`**（80 子应用） | 用户不愿动腾讯云控制台 → 复用已开放的 80，与主站二维码工具共存互不影响                                                                                                                                           |
| 前端产物 | **`BASE_PATH=/workspace/` 构建**                    | 子路径部署必须让 assets 引用带前缀，否则白屏（`vite.config.ts` 已支持该变量）                                                                                                                                    |
| 缓存策略 | **入口 HTML `no-cache`，`assets/` 长缓存一年**      | IIS 默认不发 `Cache-Control`，浏览器按启发式猜新鲜度、明文 HTTP 上代理还会自行缓存 → 会出现「同一个链接、两台设备两个版本」的幽灵旧版（旧 index.html 配旧 assets 永远自洽）。见 `deploy/web.config` 末尾两处配置 |
| HTTPS    | 本期不做（纯 HTTP + IP）                            | 无域名无证书；限制见下方「已知限制」，绑域名后可随时升级                                                                                                                                                         |

**本机打包**（一条命令，产物已 gitignore）：

```powershell
pnpm deploy:package        # = BASE_PATH=/workspace/ pnpm build + 组装 + 校验 + 打 zip
# 产物：deploy-package.zip
#   ├── dist/           按 /workspace/ 构建的前端产物
#   ├── web.config      子目录版：SPA fallback + MIME 补登记 + 安全响应头 + 缓存策略
#   ├── install.ps1     幂等部署脚本（管理员 PowerShell 跑一次）
#   └── 部署说明.txt     服务器侧操作与排障说明
```

**服务器侧**（约 1 分钟）：RDP 登录 3389 → 把 zip 粘进远程会话 → 解压 → 右键 `install.ps1`「使用 PowerShell 运行」。
`install.ps1` 做四件事，全部幂等（改完代码重新打包、再拖进去覆盖即更新）：

1. **URL Rewrite 检测/安装**：查注册表，缺失就从微软官方 CDN 静默装 `rewrite_amd64_en-US.msi`
   （服务器不通外网时，把 msi 与脚本放同目录即可离线安装；2012 R2 的 TLS 1.0 默认值会让下载直接失败，脚本里显式启用了 TLS 1.2）
2. **探测主站点**：`Get-Website` 找 80 端口已启动的那个，**不硬编码 "Default Web Site"**；在其下建子应用 `workspace`
   （已存在则只更新文件；目录已存在但不是应用则 `ConvertTo-WebApplication` 就地升级）
3. **同步文件**：清空并复制 `dist/*` + `web.config`，授予 `IIS_IUSRS` 读取权限
4. **自检**：本机请求 `/workspace/` 与 `/workspace/dashboard`，把响应码打出来

`web.config` 是"刷新子路由不 404"的关键：Vue Router 用 History 模式，`/workspace/dashboard` 在磁盘上没有对应文件，
rewrite 规则只对**既不是文件也不是目录**的请求回退到 `/workspace/index.html`（`assets/*.js` 这类真实文件不受影响）。
规则写在子目录的 `web.config` 里，IIS 配置继承是父→子单向的，**主站根目录完全不受影响**；真要回退，删掉 `workspace` 子应用即可。

**已知限制（必须知晓）**：纯 HTTP + IP 属于浏览器定义的**非安全上下文**，两个 API 会被禁用 ——

- **Geolocation**（天气自动定位）→ 自动走降级链（`上次位置 → 高德 /v3/ip → 默认城市`），功能不挂：明文 HTTP 下浏览器**必然**拒绝定位（平台规则，不是用户能点的开关），所以这两级兜底是网页端唯一还能自动贴近用户的途径，IP 定位能落到城市级（南昌而不是默认的北京）
- **Notification**（网页版系统通知）→ 应用内铃铛/Toast 兜底正常；**桌面版 exe 走 Windows 原生通知，不受影响**

升级路径：绑域名 → 解析到本 IP → IIS 绑域名 + win-acme 申请免费证书 → HTTPS 全解锁，随时可做、不阻塞本期上线。

> 部署后别忘了回 **Supabase → Authentication → URL Configuration**，把 Site URL 与 Redirect URLs 加上
> `http://124.220.159.58/workspace/`，否则邮件里的验证/重置链接会跳回旧地址。

> 本地想先验一遍子路径构建（不需要 IIS）：`$env:BASE_PATH='/workspace/'; pnpm build; pnpm preview`，
> 然后访问 `http://localhost:4173/workspace/dashboard` —— 应为 200，且 `/workspace/assets/*.js` 返回 `text/javascript`。

### 部署自检记录（本机实测，2026-09-13）

| 检查项                                   | 结果                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 子路径构建                               | `BASE_PATH=/workspace/ pnpm build` 后 `dist/index.html` 的 9 处资源引用全部带 `/workspace/` 前缀，产物零硬编码绝对路径                                                                                                                                                                                              |
| 子路径预览（等价于 IIS 的 rewrite 语义） | `pnpm preview` 下 `/workspace/`、`/workspace/dashboard` 均 200（回退 index.html）；`/workspace/assets/*.js` 返回 `text/javascript`、`*.css` 返回 `text/css`（不是被 fallback 吞成 HTML）                                                                                                                            |
| 部署包结构                               | 33 个文件 / ~520 KB，根目录恰为 `dist/` + `web.config` + `install.ps1` + `部署说明.txt`，解压后逐项校验通过                                                                                                                                                                                                         |
| `web.config` 正确性                      | XML 可解析；rewrite 动作为 `/workspace/index.html` + 两个 negate 条件；8 条 MIME 补登记；默认文档 index.html                                                                                                                                                                                                        |
| `install.ps1` 语法                       | Windows PowerShell 解析零错误（打包脚本内置该检查，语法错直接拒绝出包）                                                                                                                                                                                                                                             |
| `install.ps1` 站点探测逻辑               | 用桩函数（模拟 WebAdministration 真实返回形态）驱动 **18 项用例全通过**：单站点 `*:80:`、`Get-WebBinding` 优先、多站点挑 80 且已启动、仅主机头绑定、80 站点未启动、绑定串取不到时单站点兜底、错误信息带真实绑定串、`-SiteName` 指定、裸字符串数组兼容、应用存在性判定的三种属性名与配置查询兜底、物理路径展开与兜底 |
| 交付脚本编码                             | `install.ps1` 与 `部署说明.txt` 均为 UTF-8 **带 BOM**（2012 R2 的 Windows PowerShell 4.0 无 BOM 会按 GBK 读，中文提示全乱码）                                                                                                                                                                                       |
| 服务器实机部署（第一轮）                 | 跑到 2/6 暴露一个真 bug（见下方"服务器首跑挖出的坑"），已修复并重新出包                                                                                                                                                                                                                                             |
| 服务器实机部署（第二轮）                 | **待用户 RDP 执行**（本机无 IIS，无法预演；`install.ps1` 自带部署后连通性自检，跑完会直接打印响应码）                                                                                                                                                                                                               |

**服务器首跑挖出的坑：`Get-Website` 的 `Bindings` 不能直接匹配**

第一轮在服务器上（Windows Server 2012 R2 / IIS 8.5）跑到 2/6 报：

```
部署失败：没有找到绑定 80 端口的已启动站点。现有站点：Default Web Site [Microsoft.IIs.PowerShell.Framework.ConfigurationElement]。
```

`Get-Website` 返回的是 IIS 配置对象，`$site.Bindings` 直接 `-match` / `-join` 只能得到**类型名**（配置元素集合并不会摊平成绑定串），
所以 `"http/*:80:"` 永远匹配不到。修法是从集合里取 `bindingInformation`：

| 改动                                         | 内容                                                                                                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 取绑定串（新增 `Get-SiteBindingInfo`）       | 策略 1：`Get-WebBinding -Name <站点>`；策略 2：`$site.Bindings.Collection` 里逐项取 `bindingInformation`（大小写两种写法都试），并兼容"裸字符串数组"形态                                                                 |
| 站点选择兜底（重写 `Get-MainSite`）          | ① 绑定该端口且已启动 ② 只有一个已启动站点就直接用（打印其绑定串供复核） ③ 绑定该端口但未启动（提示）④ 都不满足才报错，且错误信息列出**每个站点的真实绑定串与状态**                                                       |
| 同源加固（新增 `Test-WebApplicationExists`） | 幂等性判定同样依赖属性名：`Get-WebApplication` 的返回对象在 `Path`/`Name`/`PSChildName` 之间因版本而异，写死一个就会把"已存在"误判成"不存在"→ 二次部署重复建应用报错。改为三个属性轮询 + `Get-WebConfiguration` 查询兜底 |
| 零散加固                                     | `PhysicalPath` 为空时从 IIS 提供程序兜底读取；应用池名取不到时不传 `-ApplicationPool`（交给 IIS 用默认池），避免传空值报参数错误                                                                                         |

### 上线后的自检清单

- [ ] 首页仪表板能出数字（秒表在计薪时间内会跳动、今日完成度环形图有渲染）
- [ ] 刷新 `/todos`、`/stats`、`/annual`、`/settings` 这些子路由**不 404**（Vercel 靠 `vercel.json` 的 rewrite；
      Cloudflare / Netlify 靠 `_redirects`；GitHub Pages 靠 `404.html`；自有服务器靠子目录 `web.config` 的 rewrite）
- [ ] 统计页四张新图有渲染且跟随主题（深色模式下坐标轴文字清晰、不发白）；切「本周/本月/全部」数字跟着变
- [ ] 年度报告页能生成分享卡并保存为图片（`canvas.toDataURL` 在真实浏览器里才有 2D 上下文）
- [ ] 天气卡能显示当前位置（必须 HTTPS，浏览器才给定位权限；`http://局域网 IP` 会直接被拒）
- [ ] 未登录访问 `/todos` 会跳到 `/login`，登录后回到 `/todos`（配了 Supabase 才有登录环节）
- [ ] 换一台设备／无痕窗口登录同一账号，任务数据一致
- [ ] 头像上传后侧边栏与设置页都显示圆形头像
- [ ] 自有服务器：`/workspace/` 首页正常、`/workspace/dashboard` 直接刷新不 404、主站 `http://124.220.159.58/` 二维码工具完好

本地也可以先验一遍"路由能不能直接访问"：`pnpm build && pnpm preview`，然后直接请求 `/`、`/todos`、`/stats`、
`/annual`、`/settings`、`/login`——6 条都应返回 200 且是应用 HTML（等价于上面那条 SPA rewrite）。

## 🖥️ 桌面版（Tauri 2）

> **架构原则：Web 应用是唯一本体，Tauri 只是「壳」。** 一套代码双发布渠道——浏览器版走 GitHub Pages，
> 桌面版出 exe，互不阻塞。桌面化只做**增量适配**，Web 版功能在壳里原样可用。

### 为什么选 Tauri 而不是 Electron

|          | Tauri 2 ✅                   | Electron                             |
| -------- | ---------------------------- | ------------------------------------ |
| 包体     | **8~15 MB**                  | 100~150 MB                           |
| 内存     | 低（复用系统 WebView2）      | 高（自带 Chromium，一个窗口几百 MB） |
| 额外依赖 | Rust + MSVC 工具链（一次性） | 无                                   |

### 环境前置（一次性）

| 组件                         | 状态检查                                                              | 说明                                                                               |
| ---------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Rust（stable-msvc）          | `rustc --version`                                                     | `winget install Rustlang.Rustup` 后 `rustup default stable-x86_64-pc-windows-msvc` |
| VS Build Tools（C++ 工具链） | `vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64` | 链接器与 Windows SDK 来源                                                          |
| WebView2 运行时              | Win10 21H2 / Win11 自带                                               | 老系统由安装包的 `downloadBootstrapper` 自动补装                                   |

> 💡 **国内网络提示**：直连 crates.io 的 sparse 索引是延迟瓶颈（实测 25 秒只前进 ~42KB）。
> 本机在 `~/.cargo/config.toml` 里配了 USTC 镜像（纯附加配置，删掉即回到官方源）：
>
> ```toml
> [source.crates-io]
> replace-with = 'ustc'
> [source.ustc]
> registry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"
> ```

### 开发与构建

```bash
pnpm tauri dev            # 桌面版热更新（起 Vite + 壳窗口）
pnpm tauri build          # 只打包，产物留在 src-tauri/target/release/
```

**改完网页端要出桌面版：一条命令（推荐）**

> 🧭 **工作流约定（2026-09-13 起）**：开发期间**不要改一处就重建一次桌面端**——一次打包 4~5 分钟，
> 还会强杀正在运行的窗口。**需求成批改完（或明确说「可以出包了」）再统一跑一次**
> `pnpm desktop:build:kill`。改的过程中想即时看效果，用 `pnpm tauri dev`
> （起 Vite + 壳窗口，前端热更新、不产出 exe）或 `pnpm dev` + 浏览器。
> 换句话说：源码改了但 exe 还是旧的，属预期状态，不是 bug。

```bash
pnpm desktop:build        # = typecheck + 单测 + lint → pnpm build → tauri build → 拷产物到项目根
pnpm desktop:build:fast   # 跳过校验，只构建（前端产物没变、想快点时用）
pnpm desktop:build:kill   # 同上，但先强杀正在运行的桌面版（见下）
```

也可以直接双击 `build-desktop.bat`（纯 ASCII，避免 cmd 解析中文批处理时报 `'xxx' is not recognized`）。
底下的脚本是 `scripts/desktop-build.mjs`，它顺手把本机**不在系统 PATH 里**的 `~/.cargo/bin` 补进
`PATH`（否则 `tauri build` 会直接报 `cargo not found`），并把终端上的完整输出（含 cargo 报错）
一并写进 `_desktop_build.log`。

> ⚠️ **桌面版正在运行时打包会失败**：cargo 删不掉被占用的 target 产物，报
> `failed to remove file ... 拒绝访问 (os error 5)`；项目根里那份 `云海工作台.exe`
> 被双击跑着时，最后一步拷贝也会 EBUSY。脚本在编译**之前**就查运行中的进程
> （按映像名查，所以「跑的是项目根那份」也算）与文件占用：
>
> - 没关它 → 带 PID 明确报错，让你先关掉（`pnpm desktop:build:kill` 则由脚本结束它）
> - 编译途中你又双击了应用 → 捕到占用报错后强杀一次并自动重试一轮
> - 拷贝时目标被新起的实例占住 → 最多重试 20 秒，必要时再杀一次
>
> 注意桌面版点关闭按钮**只是最小化到托盘**，要真正退出得走托盘菜单的「退出」。

产物统一拷到 **workspace 上一级目录**（即 `C:\Users\asus\Desktop\个人项目`），不用再翻 `target`：

```
..\云海工作台.exe                     ← 绿色版，双击即用
..\云海工作台_0.1.0_x64-setup.exe     ← 安装包（版本号取 tauri.conf.json 的 version）
..\_desktop_build.log                 ← 构建日志，失败先看它
```

> **网页端与桌面端是两份产物**：网页端改完 `dist` 就生效（浏览器/GitHub Pages），
> 但 exe 里嵌的是**打包那一刻**的 `dist`。所以每次动网页代码，都要重跑一次
> `pnpm desktop:build`，否则用户装到的还是旧页面——这就是上面那条命令存在的理由。

Tauri 原始产物（脚本拷贝的来源，仍会保留）：

```
src-tauri/target/release/smart-workspace.exe                ← 绿色版（4.91 MB）
src-tauri/target/release/bundle/nsis/云海工作台_0.1.0_x64-setup.exe  ← 安装版（2.01 MB，可选安装目录）
```

> 绿色版文件名来自 Cargo 的 `name`（Rust crate 名只能是 ASCII），窗口标题与安装包名来自
> `productName: 云海工作台`，所以两者不同名——这是 Cargo 的硬约束，不是配置漏了。

> ⚠️ **别用裸 `cargo build --release` 代替打包**：`tauri` 的 `build.rs` 里是
> `let dev = !has_feature("custom-protocol")`，不带该特性构建出来的是**dev 模式二进制**——
> 它不加载内嵌资源，而是去连 `tauri.conf.json` 的 `devUrl`（`http://localhost:5173`）。
> 那个端口没有服务时，双击 exe 只会看到 WebView2 的 **`ERR_CONNECTION_REFUSED`** 错误页，
> 看起来像「打包坏了」，其实是构建模式选错了。`pnpm tauri build`（以及上面的
> `pnpm desktop:build`）会由 CLI 自动带上该特性；手动构建必须写全：
>
> ```bash
> cargo build --release --features custom-protocol
> ```
>
> `src-tauri/Cargo.toml` 里已补上标准特性别名，所以上面这条命令可直接使用。

### 桌面版做了什么增量（全部经 `utils/platform.ts` 一处判定，Web 版零影响）

| 改造                        | 实现                                                                                                                                                                   | 为什么                                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **无边框窗口 + 自绘标题栏** | `tauri.conf.json` 里 `decorations: false`；`TitleBar.vue` 画 40px 标题栏：左图标名、中拖拽区（`data-tauri-drag-region`，双击最大化）、右三键（46×32，关闭键 hover 红） | 去掉 Windows 系统白条标题栏，界面从窗口最顶端开始——这是「原生质感」与「套壳网页」的分界线                                                                                      |
| **去掉移动端底部导航**      | `shouldShowBottomNav()` 在桌面版返回 false                                                                                                                             | 窗口最窄 900px，底部导航既占地方又「移动端感」十足                                                                                                                             |
| **侧边栏默认折叠成活动栏**  | 默认值取 `isTauri()`（VS Code Activity Bar 风格，tooltip 提示全名）                                                                                                    | 桌面屏空间大，紧凑一点信息密度更高；点一下即可展开，选择会被记住                                                                                                               |
| **关闭 = 最小化到托盘**     | Rust 侧 `CloseRequested` 里 `prevent_close()` + `hide()`；托盘菜单「显示主窗口 / 退出」                                                                                | **功能级增量**：窗口藏起来后秒表 tick 与提醒调度继续跑，到点照常弹原生通知                                                                                                     |
| **系统托盘**                | Rust 侧 `tauri::tray::TrayIconBuilder` + 菜单，左键单击显示窗口。**只在 Rust 建一次**——配置里别写 `app.trayIcon`，否则通知区会出现两个图标（见缺陷表）                 | 「真桌面应用」的行为标志                                                                                                                                                       |
| **外链唤起系统浏览器**      | 全局 click 监听：只拦绝对 http(s) 链接 → `shell.open`                                                                                                                  | 壳内导航会让用户「走丢」回不来；`javascript:` 之类绝不交给 shell                                                                                                               |
| **禁止误选文字**            | `html[data-platform="desktop"] body { user-select: none }`，输入框/`.selectable` 例外                                                                                  | 桌面应用习惯；但连标题都复制不了就是把原生感做成了残废                                                                                                                         |
| **细滚动条**                | 6px 半透明、hover 加深（两种形态共用）                                                                                                                                 | 浏览器默认粗滚动条是「网页感」最大来源                                                                                                                                         |
| **默认紧凑密度**            | 首次进入桌面版时写入 `compact`                                                                                                                                         | 桌面屏空间大，信息密度优先；设置面板仍可调                                                                                                                                     |
| **窗口状态记忆**            | `tauri-plugin-window-state`                                                                                                                                            | 位置/尺寸/最大化状态不用每次重设                                                                                                                                               |
| **单实例锁**                | `tauri-plugin-single-instance`（必须**第一个**注册）                                                                                                                   | 第二次启动不该开第二份，而是把已有窗口拉到前台                                                                                                                                 |
| **定位兜底**                | 浏览器定位 → 上次位置 → **高德 `/v3/ip`** → 默认城市                                                                                                                   | 浏览器版与桌面版**默认都开**：明文 HTTP 部署下浏览器必然拒绝定位（安全上下文限制），IP 定位只要联网就能出城市级位置；WebView2 的定位则要过系统隐私设置，被拒后同样只剩这一条路 |
| **vite base 双形态**        | `TAURI_ENV_PLATFORM` 存在时强制 `base: '/'`                                                                                                                            | 桌面壳里带子路径会资源 404 → 白屏                                                                                                                                              |

### 数据隔离（要知道的一件事）

桌面版的 localStorage / IndexedDB 落在 `%LOCALAPPDATA%\<identifier>\EBWebView`（WebView2 的用户数据目录），
**与浏览器数据天然不共享**。

> **第九阶段之后这条基本不用操心了**：本地目录仍然是各存各的（那是浏览器的实现，改不了），
> 但**登录同一账号后云端是共同真相**——任务、主题、标签、布局、壁纸全都会同步过来。
> 所以「在浏览器里配好，回桌面版接着用」是登录一下的事，不需要搬文件。
> 只有**不登录**（纯本地模式）时才需要搬数据：可用未来要做的 JSON 导入导出。

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

| 验收项                            | 实测结果                                                                                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 绿色版 exe 体积                   | **4.91 MB**（`target/release/smart-workspace.exe`）                                                                                                                                                                                                                                 |
| 安装版体积                        | **2.01 MB**（`bundle/nsis/云海工作台_0.1.0_x64-setup.exe`）                                                                                                                                                                                                                         |
| 运行内存                          | **29.2 MB** 工作集（Electron 同规模应用通常几百 MB）                                                                                                                                                                                                                                |
| 启动即原生感                      | 窗口矩形 1296×809、客户区 **1280×800**，垂直非客户区仅 9px（纯调整边框）→ **无 31px 系统标题栏**，`decorations: false` 确实生效                                                                                                                                                     |
| 窗口标题                          | `云海工作台`（配置生效）                                                                                                                                                                                                                                                            |
| 前端已加载                        | `msedgewebview2` 宿主进程挂在应用进程下（WebView2 载入成功，非白屏空壳）                                                                                                                                                                                                            |
| 单实例锁                          | 连续启动两次，进程数始终为 **1** → 第二次启动被拦截并聚焦已有窗口；进程内可见 `com.smartworkspace.desktop-sic/-siw` 两个隐藏窗口（插件的消息窗口）                                                                                                                                  |
| **托盘已注册（客观证据）**        | 进程内存在 `tray_icon_app` 隐藏窗口（`tray-icon` 库每个 `TrayIcon` 建一个）→ `Shell_NotifyIcon(NIM_ADD)` 成功。另有逻辑侧证据：`TrayIconBuilder::build()` 失败会让 `setup` 返回 Err、启动直接失败，而应用启动正常                                                                   |
| **托盘菜单文案已进产物**          | 反查二进制 UTF-8 字面量：`显示主窗口`、`退出`、`云海工作台` 均在                                                                                                                                                                                                                    |
| **双击最大化链路已进产物**        | 二进制含 `data-tauri-drag-region`、`start_dragging`、`internal_toggle_maximize` 与权限标识 `allow-internal-toggle-maximize`；且 `core:window:default` 的权限集本身含该内部命令                                                                                                      |
| **原生通知的验证基线**            | 测试前 `HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\com.smartworkspace.desktop` **不存在**，且 `wpndatabase.db` 的 `Notification` 表中属于本应用的记录为 **0** → 从未成功弹过 Toast。跑通一次提醒后这两处都会留下痕迹，可作为客观判据（无需靠"看到气泡"） |
| **关闭 = 最小化到托盘**           | 向主窗口发 `WM_CLOSE` 后进程仍在（进程数 1）→ 关闭键不退出应用，秒表/提醒留在后台继续跑                                                                                                                                                                                             |
| **窗口位置/尺寸记忆**             | `MoveWindow` 到 (210,190,1020,690) → 关闭 → 状态文件写下 `x:210 y:190`（宽高存**客户区** 1004×681）→ 重启后 `GetWindowRect` 精确回到 (210,190,1020,690)                                                                                                                             |
| **CSP 与真实调用域名一致**        | `connect-src` 覆盖高德 `restapi.amap.com`、`*.supabase.co`、`wxpusher.zjiecode.com`、`api.deepseek.com`、`open.bigmodel.cn`；`img-src https:` 覆盖 Google favicon 服务与 GitHub 头像                                                                                                |
| **新 CSP 下前端真的跑起来**       | 启动后 `%LOCALAPPDATA%\com.smartworkspace.desktop\EBWebView\Default\Local Storage\leveldb\*.log` 被写入 `smart-workspace:theme` = `compact` → 打包产物在主进程 CSP 下执行成功（不是白屏空壳），桌面默认紧凑密度也按预期落盘                                                         |
| **CSP 已随构建生效**              | 反查产物二进制：生产 CSP 为 `connect-src 'self' ipc: http://ipc.localhost https:`，`devCsp` 另含 `ws://localhost:5173`；旧的域名白名单字符串已不存在于二进制中                                                                                                                      |
| **安装版安装**                    | 静默 `/S`：退出码 0、耗时 1.9s、**无 UAC 提示**（脚本为 `RequestExecutionLevel user`）；装到 `%LOCALAPPDATA%\云海工作台`（`smart-workspace.exe` 4.91MB + `uninstall.exe`），写入 `HKCU\...\Uninstall\云海工作台` 与开始菜单 `云海工作台.lnk`                                        |
| **安装版运行**                    | 从 `%LOCALAPPDATA%\云海工作台\smart-workspace.exe` 启动正常；窗口沿用绿色版同一份数据（仍为 210,190,1020,690）→ 两种形态数据互通                                                                                                                                                    |
| **卸载（不删数据分支）**          | 目录、`HKCU` 卸载项、开始菜单快捷方式全清，残留进程 0；**两个数据目录完整保留**，窗口状态文件内容不变                                                                                                                                                                               |
| **跨安装周期持久性**              | 卸载后重装 → 窗口仍精确恢复 210,190,1020,690，数据未被安装/卸载动作影响                                                                                                                                                                                                             |
| **清空数据后的全新启动**          | 删除两个数据目录后启动 → 窗口回到配置默认 **1280×800 居中**（X/Y=320/116，即 1920×1080 屏的居中位置），Web 数据目录与 `smart-workspace:theme`（桌面默认紧凑密度）重新生成                                                                                                           |
| Web 版不受影响                    | 全量 1512 例测试通过；`title-bar` 只在 `platform=desktop` 下渲染                                                                                                                                                                                                                    |
| **一键打包脚本（2026-09-13 补）** | `pnpm desktop:build:kill` 全流程跑通：typecheck + 1494 例单测 + lint → `pnpm build` → `tauri build` → 两个产物拷到项目根；脚本自动补 `~/.cargo/bin` 进 PATH；运行中的桌面版（含项目根那份 `云海工作台.exe`）会被识别、结束并重试，耗时约 172 秒                                     |

> 说明 1：`decorations: false` 无法用「有没有 `WS_CAPTION` 样式位」来判断——tao 保留了该位用于尺寸计算，
> 真正去掉标题栏靠的是 `WM_NCCALCSIZE`。所以判据是**客户区与窗口矩形的差**（上式），不是样式位。
>
> 说明 2：窗口状态记忆有两个坑，本项目都填了——
> ① `tauri-plugin-window-state` 只在 `RunEvent::Exit` 落盘，`Moved`/`Resized` 仅更新内存缓存；
> 而本项目「关闭」= 隐藏到托盘（**不退出进程**），只用关闭按钮的用户位置永远不会被持久化。
> ② 更隐蔽的是：`AppHandle::exit` 的实现是 `cleanup_before_exit()` + `std::process::exit(code)`
> （`tauri/src/app.rs:574`），**直接退进程、从不发送 `RunEvent::Exit`** —— 也就是说走托盘「退出」时，
> 插件注册在 `RunEvent::Exit` 上的那次保存是**死代码**（实测：托盘退出后状态文件时间戳不推进）。
> 所以本项目在**两处**显式保存：`CloseRequested`（隐藏时）与托盘 `quit`（退出前）。
> 少了任何一处，「调好大小 → 直接退出」的用户都会丢窗口状态。
> 状态文件位于 `%APPDATA%\com.smartworkspace.desktop\.window-state.json`。
>
> 说明 3：卸载时**不勾**「删除应用数据」会留下 `HKCU\Software\smartworkspace\云海工作台`（值 = 旧安装路径）。
> 这不是本项目的代码问题——生成的 `installer.nsi`（Tauri 模板）把这段注册表清理放在了复选框分支**内部**
> （第 824–831 行，与该分支的 `RmDir /r` 同级），故未勾选时必然残留；勾选后一并清除。

**标题栏与托盘：已由「客观测量」逐条确认**

合成鼠标输入会干扰使用者当前桌面，所以没有用自动化点击，而是用一个只读探针（每 300ms 采样窗口矩形 /
可见性 / `IsIconic` / 进程存活）记录人工操作造成的真实状态变化，再由坐标数据判定：

| 验收项              | 判定 | 日志证据（1920×1080 屏）                                                                     |
| ------------------- | ---- | -------------------------------------------------------------------------------------------- |
| 拖拽标题栏移动      | ✅   | `(632,0) → (589,33) → (133,219)`，宽高恒为 1296×809（尺寸不变、位置变化即拖动）              |
| 双击最大化          | ✅   | `02:33:42.950` → `X=-8 Y=-8 1936×1048`（含边框的最大化尺寸）                                 |
| 双击还原            | ✅   | `02:33:44.258` → 回到 `320,116 1296×809`                                                     |
| 最小化键            | ✅   | `IsIconic=true`（`-32000,-32000 160×28`）                                                    |
| 关闭键 = 隐藏到托盘 | ✅   | 两次 `vis=False` 且进程始终存活                                                              |
| 托盘左键唤起        | ✅   | 隐藏后重新 `vis=True`                                                                        |
| 托盘「退出」        | ✅   | 进程消失且无崩溃记录；状态文件**不**被重写，与 `app.exit()` 走 `std::process::exit` 完全吻合 |

> 额外抓到一条原生行为：窗口处于最大化时拖动标题栏 → 自动还原并跟随光标移动（Windows 原生语义），
> 说明拖拽区在最大化状态下也正确。
>
> 三键 hover 无法从外部测量（纯渲染效果），其静态证据是产物 CSS 里确实存在
> `.hover\:bg-rose-600:hover{background-color:rgb(225 29 72…)}`（关闭键红底），且该 class 在模板里。

**仍未做的两项**：

- 提醒到点弹 Windows 原生通知气泡（通道分支由单测覆盖）。基线已确认干净：
  `HKCU\...\Notifications\Settings\com.smartworkspace.desktop` 不存在、`wpndatabase.db` 的 `Notification`
  表中属于本应用的记录为 0；跑通一次后这两处会留痕，可作为客观判据。注意专注助手拦截与绿色版/安装版差异。
- 卸载向导上**勾选「删除应用数据」**的那一次点击：脚本没有对应命令行开关（只有 `/P` `/NS` `/UPDATE`），
  删除动作仅由 GUI 复选框 `$DeleteAppDataCheckboxState = 1` 驱动，静默卸载会跳过该页。
  其**效果**已做等效验证：按脚本第 834–835 行删掉 `$APPDATA\${BUNDLEID}` 与 `$LOCALAPPDATA\${BUNDLEID}` 后，
  全机器无任何应用残留，重新启动即回到全新状态（默认居中窗口 + 重建数据目录）。

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
「锁定缺陷现状」的用例反过来写成回归断言。第七阶段做桌面验收时又挖出 1 个（标题栏双击），
第五阶段做注册安全时又被自己的用例当场抓住 2 个（置灰挡不住回车、失败缓存清不掉）。
这部分比覆盖率数字本身更有价值——**测试与验收的意义就是逼出这些**：

| 缺陷                                                                                | 后果                                                                                                                                                                                                                                                               | 修法                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `useReminder` 的 30 秒轮询从未启动                                                  | `useIntervalFn` 的 `immediate` 控制的是「是否自动 `resume()`」，传 `false` 定时器压根没建 —— 规划要求的周期轮询成了死代码                                                                                                                                          | 改 `immediate: true` + `immediateCallback: false`，首轮仍由挂载时显式 `scan()` 负责                                                  |
| `isSearchEngineId` / `isThemeColorName` 用 `value in OBJ`                           | 原型链上的 `'toString'` 被当成合法值放行，随后取到函数直接 `TypeError`（值来自可被手改的 localStorage）                                                                                                                                                            | 改用 `Object.hasOwn`                                                                                                                 |
| `todoSignature` 漏掉新字段                                                          | 只归档 / 只改标签 / 只改提醒算不出差异 → **这些改动永远同步不到其它设备**                                                                                                                                                                                          | 指纹补上 `tags / archived / archivedAt / reminderAt / reminderOff`（推后到期日走 `dueDate`，本就在指纹里）                           |
| 「今天」不随日期自己走                                                              | 列表 computed 缺「今天」这个响应式来源，页面开一整夜后「今日到期 / 今日聚焦」还停在昨天                                                                                                                     | `todoStore` 增加 `today` + `refreshToday()`，由 `App.vue` 每分钟与回前台校准                                                         |
| 登录拉取云端期间的改动被吞（数据丢失）                                              | 「补差」代码紧跟在赋值之后、比的是同一份数据，差异恒为空；期间新增的任务既没进队列也被覆盖                                                                                                                                                                         | 拉取**前**拍快照，用 `applyDiff` 把用户改动叠加到云端结果上并补发                                                                    |
| `httpClient` 的 `res.text()` 未包装                                                 | 流被消费/连接中断时抛出原始 `TypeError`，与「任何失败都抛 `HttpError`」的约定不符                                                                                                                                                                                  | 包成 `kind: 'network'`                                                                                                               |
| `getCurrentCoords` 同步抛错未收敛                                                   | 上层 `e instanceof GeoError` 判断落空，「已拒绝定位」标记记不住，每次进站都白试一次                                                                                                                                                                                | 同步异常也包成 `GeoError`，并校验坐标非 NaN                                                                                          |
| 标题栏自己绑了双击最大化（第七阶段查框架源码时发现）                                | Tauri 注入的 `drag.js` 已按 `e.detail === 2` 调 `internal_toggle_maximize`，我们再绑一次 `@dblclick` 就是第二次切换——**双击标题栏表现为毫无反应**（最大化后立刻还原）                                                                                              | 删掉自绑的 handler，只留 `data-tauri-drag-region` 标记；测试反过来断言「双击不得调用 toggleMaximize」防后人加回来                    |
| 托盘图标被建了两次（第七阶段验收枚举进程窗口时发现）                                | `tauri.conf.json` 的 `app.trayIcon` 与 Rust 的 `TrayIconBuilder` 各建一个托盘。而托盘一旦 `register()` 就进了 App 资源表，**丢弃返回值也不会被回收**（`tray/mod.rs` 写着「最后一个实例析构时才移除」）→ 通知区出现**两个图标**，且配置那个没有任何菜单、点了没反应 | 删掉配置块，托盘只由 Rust 建一次（菜单与左键行为本来也只在 Rust 侧）；实测进程内 `tray_icon_app` 隐藏窗口从 **2 个降为 1 个**        |
| `pruneWorkLog` 只看「有没有被时间窗裁掉」（第八阶段写新代码时被自己的用例当场抓住） | 条数上限是**另一条**约束：日志全都落在 400 天窗口内但数量超限时（例如一次性导入几千条），它直接原样返回——上限形同虚设，localStorage 可以无限长胖                                                                                                                   | 早返回条件补上 `kept.length <= limit`，两条约束同时判定                                                                              |
| 注册按钮置灰挡不住回车（第五阶段，被自己的用例当场抓住）                            | 按钮 `disabled` 只挡点击，**在输入框里按回车照样触发 `form submit`** → 弱密码照样发请求、验证码没过也照样提交                                                                                                                                                      | `validateForm` 里再拦一次（密码强度 + 人机验证），并把这两条写成用例锁死                                                             |
| Turnstile 脚本加载器的失败缓存不会被清（第五阶段，同上）                            | 清缓存写在 `fail()` 里，而失败可能是 `appendChild` **同步**触发的——那时 `scriptPromise` 还没被赋值，随后的 `scriptPromise = promise` 把 `null` 覆盖掉 → 缓存里永远躺着一个已拒绝的 promise，「重试」按钮成了空转                                                   | 改成创建 promise 后统一 `.catch()` 里按 `scriptPromise === promise` 清理                                                             |
| happy-dom 会真的去 fetch 外链脚本（第五阶段，测试环境问题）                         | 单测里 `appendChild(script)` 立刻同步触发 onerror（"文件加载被禁用"），用例根本轮不到自己 `dispatchEvent` 驱动 load/error/timeout 三条分支                                                                                                                         | 给脚本加载器加一个可注入的 appender（测试注入只记录的实现），并在 `vite.config.ts` 关掉 happy-dom 的文件加载——测试环境不该有网络行为 |

## 待优化项

- **任务级冲突解决**：任务目前是"最后一次写入生效 + 指纹差异合并"（见 `utils/todoSync.ts`），
  多端**同时**编辑同一条任务仍可能互相覆盖；更严谨可引入每条任务的 `updated_at` 做乐观并发控制
  （设置项已经是逐键 LWW + 逐键时间戳，不受此限）
- **未同步的两类数据**（有意为之，见第九阶段）：BYOK 凭证与设备相关项留在本机；
  如果将来想连凭证一起同步，需要先决定"云端加密"方案，而不是直接塞进 `user_settings`
- **提醒的"关页面也能收"**：已完成到 Edge Function 代理这一层，但服务端定时扫描（Supabase pg_cron）
  只在文档里给了方案没落地——它还需要把 UID 上服务端、service_role key 入 Vault 两个前置条件
- PWA 离线、数据导入导出（纯本地模式搬数据用）、命令面板完整版（聚合搜索是其雏形）、Bing 每日壁纸
- **功能截图**：README 里的截图小节仍缺——它需要真实运行的界面截图（含暗色模式对比），
  不该用占位图凑数，等部署到 Pages 后补
- **法定节假日数据每年初需更新**（`src/data/holidays.json`，来源见 `src/utils/holidays.ts` 头注释）
- **投入日志的采集时机**：它由赚钱秒表的实例写入。第九阶段起 `App.vue` 会额外起一个
  `useEarnings({ autoTick: false })` 只为注册同步键，所以**打开应用就会把当天已计薪时长记一次**；
  但"应用一整天没打开"的日子仍然没有记录（这是没有常驻进程的固有边界）
- **桌面版自动更新**：规划里标为「可选」，本期未做——需要 `tauri-plugin-updater` + 一对签名密钥，
  且更新包要挂在 GitHub Releases 上；CI 已经会打 tag 出安装包，接上这一步只差配置

## 致谢

- **设计灵感来源：[薪跳 PayDance](https://github.com/MrBaoboer/PayDance)**（AGPL-3.0）。
  赚钱秒表的「薪资模式 / 状态机文案」等产品设计参考了它，但**没有使用其任何代码**，
  本项目为自研实现，许可证仍为 MIT。
- 生产热力图与迷你月历的视觉语言参考了 GitHub 贡献图与 Finexy 风格仪表板。

## 与规划文档的已知差异

施工过程中有几处**有意偏离**规划原文，都有具体理由；还有一处是规划写错了、按官方文档纠正：

| 规划原文                                       | 实际实现                                                                                                           | 理由                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layouts/MobileLayout.vue`                     | 无此文件，移动端由 `components/organisms/MobileBottomNav.vue` 承担                                                 | 移动端与桌面端共用同一个 `DefaultLayout`，只是底部导航换成 bottom nav；再拆一个布局文件会带来两份几乎相同的骨架                                                                                                                                                                   |
| `Login.vue` 用 ElForm 校验                     | 自研 `BaseInput` + `utils/validation.ts` 纯函数校验                                                                | 校验规则要复用到 TodoForm/ResetPassword，抽成纯函数才能单测；ElForm 的规则是运行时配置，测起来反而绕                                                                                                                                                                              |
| 头像「方形裁剪框 + 圆形遮罩」                  | 圆形引导环（无遮罩压暗），导出方形 256×256 + CSS `rounded-full` 显示                                               | 遮罩压暗后很难看清选区外的构图；导出方形是为了将来支持非圆形头像展示，圆形只在展示层做                                                                                                                                                                                            |
| `reminderAt`「默认策略自动生成」               | **不自动写入**，为空时由 `dueDate` 推导出默认提醒时间                                                              | 可推导的字段写进每条任务只会让存储与云同步 payload 平白变胖；语义改为「用户改过才存」                                                                                                                                                                                             |
| WxPusher `contentType: 3`（HTML）              | `contentType: 2`（HTML）+ `uids: [uid]` 数组                                                                       | 规划此处写错了：按 [WxPusher 官方文档](https://wxpusher.zjiecode.com/docs/api-reference.html)，`1`=文本 / `2`=HTML / `3`=Markdown，照抄会把 `<p>` 当 Markdown 渲染；且 POST 接收人字段是 `uids` 数组（单数 `uid` 只存在于 GET 查询参数）                                          |
| 侧边栏「帮助」入口                             | 已实现（打开使用说明弹窗）                                                                                         | —                                                                                                                                                                                                                                                                                 |
| 卡片拖拽「等槽化」                             | 按规划实现：进入编辑布局即切等槽网格，默认仍是精调 bento                                                           | 变跨度卡片无法直接拖拽换位，等槽化是规划自己给出的取舍                                                                                                                                                                                                                            |
| CSP 只列 5 个 API 域名                         | `connect-src 'self' ipc: http://ipc.localhost https:`                                                              | 规划要求「白名单」，但第六阶段是 **BYOK**：用户可把 AI `baseUrl` 指向自建网关，Supabase 也可自托管——域名写死会让这些功能在壳里静默失效，违背「Web 版功能原样可用」。真正的防线是 `script-src 'self'`（没有可执行注入就不存在可利用的连接），故 `connect-src` 放开 `https:`        |
| 绿色版叫 `云海工作台.exe`                      | 实际为 `smart-workspace.exe`                                                                                       | Cargo 的 crate/二进制名只能是 ASCII；`productName` 的「云海工作台」用于窗口标题与安装包名，两者不同名是工具链约束                                                                                                                                                                 |
| 通知「点击聚焦窗口并跳转任务」                 | 桌面版只能弹 Toast，点击不深链；应用内兜底路径照常高亮任务                                                         | 插件能力边界：`tauri-plugin-notification` 2.4.0 桌面端 `invoke_handler` 只注册 `notify`/`request_permission`/`is_permission_granted`，JS 侧 `onAction`/`onNotificationReceived` 依赖的 `register_listener` 与 `desktop.rs` 的点击处理**都只在移动端存在**——不是没写，是拿不到回调 |
| 子应用建在 `C:\inetpub\wwwroot\workspace`      | 由 `Get-Website` 读出主站 `PhysicalPath` 再拼 `\workspace`                                                         | 主站在注册表里的物理路径可能被改过（也可能压根不是 Default Web Site）；写死路径会在那种机器上把文件拷到 IIS 根本不看的地方——部署成功却打不开                                                                                                                                      |
| 部署包直接放 `dist/`                           | `dist/` 之外还放了 `部署说明.txt`，脚本里带 4 项自检（管理员/包完整性/base 前缀/install.ps1 语法）                 | 这份包是给"RDP 里点一下"的人用的：白屏、500.19、404.3 这些失败的现场在服务器上很难查，所以把校验前移——打包时就拦掉 base 忘设、脚本语法错这类低级事故                                                                                                                              |
| 散点图的「秒表每日累计时长」直接读 store       | 新增**按天的投入日志**（`utils/workLog.ts` + `smart-workspace:worklog` 键），由赚钱秒表 tick 时写入                | 秒表快照只描述「此刻」，关掉页面后昨天的计薪时长无从得知——不落日志就没有"每日"这个维度；详见「投入时长从哪来」                                                                                                                                                                    |
| 标签占比「各标签完成数占比」                   | 按任务的**第一个标签**归类，无标签单列一片                                                                         | 一个任务挂多个标签时各计一次，各切片占比之和 > 100%，环形图的"占比"就不成立了                                                                                                                                                                                                     |
| 统计页保留第六阶段的「近 30 天完成趋势」柱状图 | 该图已被「完成趋势柱线混合图」取代并从 `StatisticsCard` 删除                                                       | 同一个数字在同一页出现两种画法只会互相打架；优先级环图仍留在 `StatisticsCard`                                                                                                                                                                                                     |
| 侧边栏主导航从 4 项扩到 5 项                   | 第十阶段把「知识库」提为主导航第 4 项；年度报告 `/annual` 仍从统计页按钮进入                                        | 年度报告是"统计的另一种呈现"，进导航是重复；而知识库是**独立模块**（有自己的文档管理与会话），藏进二级入口会让"答案靠不靠知识库、库里有什么"这些本该一眼看到的信息变难找                                                                                                            |
| 知识库后端地址 / 检索策略 / 兜底模式存本机     | 不进第九阶段的 16 项账号同步清单（`smart-workspace:agent-*` 键）                                                   | 它们描述的是"这台机器怎么连后端"：家里连本机 uvicorn、公司连另一台，本来就该各填各的；扩同步清单还要连带改 supabase 的类型与自检，收益不成正比                                                                                                                                      |
| 流式接口未配 Key 也返回 200                    | 把 `error` 事件发在流里，前端只有一条错误路径                                                                      | 若改用 4xx，"流中错误"与"请求错误"就变成两套代码；而 SSE 一旦开始发送，HTTP 状态码早就发出去了，本来也改不了                                                                                                                                                                        |
| 回答里的引用编号由**后端**生成                 | 前端只渲染，模型不许自报来源                                                                                       | 让模型自己写 `[1]` 就会出现"引用了不存在的片段"这种最难查的假象；编号与 citation 事件同源，才对得上                                                                                                                                                                                |
| 密码规则「禁纯数字 / 纯字母」单列一条          | 不单列，由「必须同时含大写、小写与数字」覆盖                                                                       | `12345678` 缺大小写、`abcdefgh` 缺大写与数字，都会被那条拦下；单列只会多一句永远不会单独出现的提示                                                                                                                                                                                |
| `Login.vue` 用 ElForm 自定义 validator         | 沿用项目既有约定（自研 `BaseInput` + `utils/auth.ts` 纯函数），另加 `PasswordStrengthMeter.vue` 原子组件承载强度条 | 与上一条 ElForm 偏离同源：规则要注册/改密/单测三处复用，抽成纯函数 + 一个共用组件比写两遍运行时规则更省                                                                                                                                                                           |
| Turnstile 在桌面壳里直接可用                   | `src-tauri/tauri.conf.json` 的 CSP 显式放行 `https://challenges.cloudflare.com`（`script-src` + `frame-src`）      | 壳里 `script-src 'self'` 会把 CDN 脚本拦掉，注册会永远停在「验证加载失败」；只放行这一个域名，仍不写通配符                                                                                                                                                                        |

## 许可证

[MIT](./LICENSE)
