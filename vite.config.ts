import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { defineConfig } from 'vitest/config'

/**
 * 部署路径的两种形态（第七阶段）：
 * - **桌面版（Tauri）必须是 `/`**：壳里加载的是 `tauri://localhost` 之类的自定义协议，
 *   带子路径会让资源全部 404 → 白屏。Tauri 构建时会注入 `TAURI_ENV_PLATFORM`。
 * - **GitHub Pages 项目站点**挂在 `/<repo>/` 下，由部署工作流注入 `BASE_PATH`。
 * - 本地开发、Vercel、Netlify、Cloudflare Pages 都在根目录，默认 `/` 即可。
 *
 * `import.meta.env.BASE_URL` 会同步变化，而路由用的是
 * `createWebHistory(import.meta.env.BASE_URL)`，所以两种形态下路由都正确。
 */
const isTauriBuild = Boolean(process.env.TAURI_ENV_PLATFORM)

export default defineConfig({
  base: isTauriBuild ? '/' : (process.env.BASE_PATH ?? '/'),
  plugins: [
    vue(),
    // Element Plus 按需自动导入：模板组件 + API（ElMessage 等）
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia'],
      resolvers: [ElementPlusResolver()],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // 避免 chokidar 监听被锁定的临时目录/文件导致 EBUSY 崩溃（如 .App.vue.<uuid>.tmpdir）
  // awaitWriteFinish：原子写入（先写 .tmp 再 rename）会产生多次变更事件，这里等待文件稳定后再触发
  // 一次 HMR，避免事件风暴导致进程被强杀（Windows 下 exit 4294967295）
  server: {
    watch: {
      ignored: [
        '**/.git/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/.DS_Store',
        '**/*.tmp',
        '**/*.tmpdir',
        '**/*.tmpdir/**',
      ],
      awaitWriteFinish: {
        stabilityThreshold: 120,
        pollInterval: 10,
      },
    },
  },
  test: {
    environment: 'happy-dom',
    /**
     * 测试环境不该有网络行为：happy-dom 默认会为插进文档的 `<script src>` 真的发请求，
     * 于是「Turnstile 脚本加载器」这类用例在 CI 上必然失败、在本机变成碰运气。
     * 这里把文件加载关掉（脚本加载器自身的三条分支由用例注入 appender 后自己驱动，
     * 见 src/composables/useTurnstile.spec.ts）。
     */
    environmentOptions: {
      happyDOM: {
        settings: {
          disableJavaScriptFileLoading: true,
        },
      },
    },
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: ['src/test/setup.ts'],
    css: true,
    /**
     * 默认 5 秒对「整站挂载」类集成测试太紧：App / authFlow 要跑完路由守卫 + 会话恢复 +
     * 首屏组件树，本机负载一高（并行跑别的任务时）就会从 ~3.5s 抖到 5s+ 而假失败。
     * 放宽到 20 秒——它只影响「失败要等多久才判定」，不会让慢测试变快，
     * 但能把负载导致的假红消掉（真正的死循环仍会被 20 秒截住）。
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
    server: {
      deps: {
        inline: ['element-plus'],
      },
    },
    /**
     * 覆盖率只统计「核心逻辑」——utils / composables / stores / api。
     * 页面与组件数量多、生命周期依赖浏览器环境，用集成/组件测试护航更划算；
     * 把它们塞进 include 只会稀释数字，让阈值失去约束力。
     */
    coverage: {
      provider: 'v8',
      // json-summary 供脚本/徽章读取，text 供人眼看，html 供定位未覆盖行
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'src/utils/**/*.ts',
        'src/composables/**/*.ts',
        'src/stores/**/*.ts',
        'src/api/**/*.ts',
      ],
      exclude: [
        // 测试自身不计入覆盖率
        '**/*.spec.ts',
        '**/*.test.ts',
        // 类型声明无运行时代码
        '**/*.d.ts',
        'src/components.d.ts',
        'src/auto-imports.d.ts',
        // 纯类型目录：编译期产物，运行时零语句
        'src/types/**',
        // 测试基建（桩件、setup）不属于被测逻辑
        'src/test/**',
      ],
      /**
       * 阈值 = **已经达到的水位**，不是愿望。数字是实测出来的，设成 80/70 是因为
       * 规划口径就是「核心逻辑行覆盖 ≥ 80%」；实测远高于它，说明这个门槛现在拦得住
       * 回归（一旦哪次改动把某层砸下去，它会立刻变红），又不会因为一处浏览器分支
       * 没覆盖就误伤。
       *
       * 另外给 utils 单独加了更严的一档：规划里 utils 纯函数是「必须全测」的一层，
       * 一个总阈值会让它被 composables/stores 的高分掩盖。95/90 取在实测水位
       * （stmts 99.6 / lines 100 / funcs 100 / branch 99.09）下面一档，
       * 既守住纪律，也不至于新增一个还有浏览器分支的 util 就直接卡住构建。
       */
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70,
        'src/utils/**/*.ts': {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 90,
        },
      },
    },
  },
})
