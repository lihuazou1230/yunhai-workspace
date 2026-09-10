/**
 * 聚合搜索领域类型（第六阶段 6.4）。
 *
 * 顶栏搜索从「只能搜任务」升级为**双通道**：一边给任务结果（点一条直接跳过去），
 * 一边把关键字丢给搜索引擎（新标签页打开）。引擎可一键切换，选择被记住。
 */

export type SearchEngineId = 'baidu' | 'google' | 'bing'

export interface SearchEngine {
  id: SearchEngineId
  label: string
  /** URL 模板，`{q}` 为关键字占位（用占位符而不是拼字符串，避免各处手写编码方式） */
  template: string
}

/** 预置引擎：国内可达的放前面，默认百度 */
export const SEARCH_ENGINES: Record<SearchEngineId, SearchEngine> = {
  baidu: { id: 'baidu', label: '百度', template: 'https://www.baidu.com/s?wd={q}' },
  google: { id: 'google', label: '谷歌', template: 'https://www.google.com/search?q={q}' },
  bing: { id: 'bing', label: '必应', template: 'https://www.bing.com/search?q={q}' },
}

/** 切换顺序（按钮按这个顺序轮换） */
export const SEARCH_ENGINE_ORDER: readonly SearchEngineId[] = ['baidu', 'google', 'bing']

/** localStorage 键 */
export const SEARCH_ENGINE_KEY = 'smart-workspace:search-engine'

/** 下拉里最多展示多少条任务结果（再多就该去任务页了） */
export const SEARCH_RESULT_LIMIT = 6
