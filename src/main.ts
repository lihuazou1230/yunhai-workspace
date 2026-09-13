import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/authStore'
import '@/assets/styles/main.css'
import '@/assets/styles/element-theme.css'
import '@/assets/styles/custom.css'
// Element Plus 的深色令牌（html.dark 下的 --el-bg-color/--el-text-color 等）。
// 少了这一句，html.dark 只切到了 Tailwind 那一半：弹窗、下拉、日期面板、
// el-switch、ElMessage 全都还是浅色 —— 深色页面里嵌一片白。
// 它会给 html.dark 设 --el-color-primary，但 useTheme 把运行时主题色内联在
// <html> 上，内联优先于样式表，所以用户自定义的主色仍然胜出。
import 'element-plus/theme-chalk/dark/css-vars.css'

async function bootstrap() {
  const app = createApp(App)

  app.use(createPinia())
  app.use(router)

  // 先恢复会话再挂载：否则已登录用户会先看到登录页（守卫闪跳）。
  // getSession 读的是本地存储，不发网络请求，所以这一步几乎无成本。
  await useAuthStore().init()

  await router.isReady()
  app.mount('#app')
}

void bootstrap()
