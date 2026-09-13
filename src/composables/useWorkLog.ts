/**
 * 投入时长日志（组合式函数）：把赚钱秒表算出来的当日计薪时长按天存下来。
 *
 * 数据流向：`useEarnings` 每分钟 tick 一次 → `record(dateKey, 秒)` → localStorage。
 * 这里只做三件事：读存储（带归一化）、原子地更新一天、按窗口裁剪。
 */

import { computed } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { useSyncedStorage } from '@/composables/useSyncedStorage'
import { todayKey } from '@/utils/dateFormatter'
import {
  mergeWorkLogs,
  normalizeWorkLog,
  pruneWorkLog,
  recordWorkSeconds,
  sumWorkSeconds,
  workHoursOn,
  workLogKeepFrom,
  WORKLOG_STORAGE_KEY,
} from '@/utils/workLog'
import type { WorkLog } from '@/utils/workLog'

export interface UseWorkLogReturn {
  /** 原始日志（日期键 -> 秒） */
  log: Ref<WorkLog>
  /** 记录某天的计薪秒数（值不变时不写存储） */
  record: (dateKey: string, seconds: number) => void
  /** 某天的投入小时数（1 位小数） */
  hoursOn: (dateKey: string) => number
  /** 截至今天的累计投入秒数 */
  totalSeconds: ComputedRef<number>
  /** 清空日志（设置页「清空本地数据」与测试用） */
  reset: () => void
}

export function useWorkLog(storage?: Storage | null): UseWorkLogReturn {
  /**
   * 第九阶段：投入日志跟账号走。
   * 合并策略**逐日取大值**（见 `mergeWorkLogs`）——两台设备各记各的天，
   * 整份覆盖会让另一台记的那几天凭空消失。
   */
  const log = useSyncedStorage<WorkLog>(
    WORKLOG_STORAGE_KEY,
    {},
    {
      normalize: normalizeWorkLog,
      merge: (local, cloud) => mergeWorkLogs(local, cloud),
      ...(storage !== undefined ? { storage } : {}),
    },
  )

  function record(dateKey: string, seconds: number) {
    const next = recordWorkSeconds(log.value, dateKey, seconds)
    // 值没变大时 recordWorkSeconds 原样返回，这里直接短路——秒表 100ms 一次 tick，
    // 不做这层拦截就是每秒十次全量 JSON.stringify
    if (next === log.value) return
    log.value = pruneWorkLog(next, workLogKeepFrom(dateKey))
  }

  function hoursOn(dateKey: string): number {
    return workHoursOn(log.value, dateKey)
  }

  const totalSeconds = computed(() => sumWorkSeconds(log.value, null, todayKey()))

  function reset() {
    log.value = {}
  }

  return { log, record, hoursOn, totalSeconds, reset }
}
