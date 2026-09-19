/**
 * 路由表（第五阶段启用）
 *
 * 页面划分（与规划文档一致）：
 * | 路径 | 页面 | 内容 |
 * |------|------|------|
 * | /login | Login | 邮箱密码，不套布局（独立全屏） |
 * | / | Dashboard | 概览徽章 + 每日格言 + 赚钱秒表 + 今日聚焦 + 天气（三列 bento） |
 * | /todos | Todos | 新建表单 + 任务列表（筛选/搜索/批量/子任务/拖拽） |
 * | /stats | Stats | 统计图表 + 生产力热力图 |
 * | /annual | AnnualReport | 年度报告（canvas 分享卡） |
 * | /knowledge | Knowledge | AI 助手（第十阶段建页时叫「知识库」）：文档入库 + 带引用的流式问答 |
 * | /settings | Settings | 个人资料 + 数据同步 + 外观自定义 |
 *
 * 两个实现要点：
 * - **懒加载分包**：页面组件一律 `() => import(...)`，首屏只加载仪表板，其余按需拉取
 * - **数据零传递**：页面之间靠 Pinia 共享（todoStore 全局单例），切页不重新请求、状态不丢
 */

import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { installAuthGuard } from './authGuard'

declare module 'vue-router' {
  interface RouteMeta {
    /** 公开路由：不需要登录（只有登录页） */
    public?: boolean
    /** 页面标题（写入 document.title、侧边栏高亮用） */
    title?: string
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/Login.vue'),
    meta: { public: true, title: '登录' },
  },
  {
    // 重置密码落地页：邮件里的链接校验完 token 会带临时凭据跳到这里（不套布局）
    path: '/reset-password',
    name: 'resetPassword',
    component: () => import('@/pages/ResetPassword.vue'),
    meta: { public: true, title: '重置密码' },
  },
  {
    path: '/',
    component: DefaultLayout,
    children: [
      {
        path: '',
        name: 'dashboard',
        component: () => import('@/pages/Dashboard.vue'),
        meta: { title: '仪表板' },
      },
      {
        path: 'todos',
        name: 'todos',
        component: () => import('@/pages/Todos.vue'),
        meta: { title: '任务' },
      },
      {
        path: 'stats',
        name: 'stats',
        component: () => import('@/pages/Stats.vue'),
        meta: { title: '统计' },
      },
      {
        // 年度报告：从统计页进入（侧边栏主导航刻意保持 4 项，见 navItems.ts 的说明）
        path: 'annual',
        name: 'annual',
        component: () => import('@/pages/AnnualReport.vue'),
        meta: { title: '年度报告' },
      },
      {
        // AI 助手（第十阶段建页时叫「知识库」）：对话与文档管理都在这一页，状态由 agentStore 统一持有
        path: 'knowledge',
        name: 'knowledge',
        component: () => import('@/pages/Knowledge.vue'),
        meta: { title: 'AI 助手' },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/pages/Settings.vue'),
        meta: { title: '设置' },
      },
    ],
  },
  // 未知路径回仪表板（而不是白屏）
  { path: '/:pathMatch(.*)*', redirect: { name: 'dashboard' } },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL ?? '/'),
  routes,
  // 切页回到顶部
  scrollBehavior: () => ({ top: 0 }),
})

// 标题跟随路由，浏览器标签页可读
router.afterEach((to) => {
  if (typeof document === 'undefined') return
  document.title = to.meta.title ? `${to.meta.title} · 云海工作台` : '云海工作台'
})

installAuthGuard(router)

export default router
