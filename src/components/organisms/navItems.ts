/**
 * 导航项定义（桌面端侧边栏与移动端底部导航共用一份）
 * 两处各写一遍很容易改一处漏一处，抽出来当唯一数据源。
 */

/** 导航项的路由名（字面量联合：`route.meta.title` 与 `{ name }` 跳转都能拿到类型提示） */
export type NavRouteName = 'dashboard' | 'todos' | 'stats' | 'knowledge' | 'settings'

/** 图标名（对应 UiIcon 原子组件；emoji 只作为无 SVG 时的语义备注保留） */
export type NavIconName = 'home' | 'check-square' | 'chart' | 'book' | 'settings'

export interface NavItem {
  /** 路由名（router-link 用 { name } 跳转，避免手写路径） */
  name: NavRouteName
  label: string
  icon: string
  /** 侧边栏/底部导航实际绘制的图标（自绘 SVG，跟随主题色） */
  iconName: NavIconName
}

/**
 * 侧边栏主导航 **5 项**。
 * 第十阶段把「知识库」提为主导航第 4 项：它与其他四项一样是**独立模块**（不是设置里的一个开关），
 * 藏在二级入口会让"问答靠不靠知识库、库里有什么"这些本该一眼看到的信息变得难找。
 * 「设置」仍在其中——顶栏另有齿轮快捷入口，两处都指向同一个 `/settings`。
 */
export const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { name: 'dashboard', label: '仪表板', icon: '🏠', iconName: 'home' },
  { name: 'todos', label: '任务', icon: '✅', iconName: 'check-square' },
  { name: 'stats', label: '统计', icon: '📊', iconName: 'chart' },
  { name: 'knowledge', label: '知识库', icon: '📚', iconName: 'book' },
  { name: 'settings', label: '设置', icon: '⚙️', iconName: 'settings' },
]

/** 设置项（顶栏入口复用同一份定义，避免文案/图标写两遍） */
export const SETTINGS_NAV_ITEM: NavItem = PRIMARY_NAV_ITEMS[4]

/** 全部导航项（移动端底部导航用：手机上 5 个平铺，标签都控制在 3 字内） */
export const NAV_ITEMS: readonly NavItem[] = [...PRIMARY_NAV_ITEMS]
