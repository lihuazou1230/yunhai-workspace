import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  /**
   * 部署子路径。
   * 本地开发、Vercel、Netlify、Cloudflare Pages 都挂在域名根目录（`/`），保持默认即可；
   * GitHub Pages 的项目站点挂在 `https://<user>.github.io/<repo>/` 上，
   * 由部署工作流注入 `BASE_PATH=/<repo>/`——`import.meta.env.BASE_URL` 会同步变化，
   * 而路由用的是 `createWebHistory(import.meta.env.BASE_URL)`，所以子路径下路由依然正确。
   */
  base: process.env.BASE_PATH ?? '/',
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
  },
})
