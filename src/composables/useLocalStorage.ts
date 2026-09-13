import { ref, watch } from 'vue'
import type { Ref } from 'vue'

/**
 * localStorage 持久化 ref。
 * 读不到/解析失败时回退到 defaultValue；写入失败静默降级为内存态。
 * @param storage 可注入存储实现（默认 window.localStorage），便于测试
 * @param normalize 可选的形状校验/归一化：**存储里的值是「不可信输入」**。
 *   只有 JSON.parse 成功并不代表它长得像 T —— 手改过的、或旧版本写入的缺字段数据
 *   都会在渲染期以 `xxx is not a function` 之类的方式炸掉页面。
 *   传了它，解析结果会先过一遍归一化；归一化抛错同样回退到 defaultValue。
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  storage?: Storage | null,
  normalize?: (value: unknown) => T,
): Ref<T> {
  const target: Storage | null | undefined = storage !== undefined ? storage : getDefaultStorage()

  function getDefaultStorage(): Storage | null {
    return typeof window !== 'undefined' ? window.localStorage : null
  }

  function read(): T {
    if (!target) return defaultValue
    try {
      const raw = target.getItem(key)
      if (raw === null) return defaultValue
      const parsed: unknown = JSON.parse(raw)
      return normalize ? normalize(parsed) : (parsed as T)
    } catch {
      return defaultValue
    }
  }

  function write(value: T) {
    if (!target) return
    try {
      target.setItem(key, JSON.stringify(value))
    } catch {
      // 容量超限/隐私模式：静默降级，仅保留内存态
    }
  }

  const data = ref<T>(read()) as Ref<T>

  watch(
    data,
    (value) => {
      write(value)
    },
    { deep: true },
  )

  return data
}
