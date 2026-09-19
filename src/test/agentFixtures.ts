/**
 * Agent 相关用例的共用桩件。
 *
 * `done` 事件在第十一阶段长到了十几个字段，而几乎每个用例只关心其中两三个。
 * 每次手写整份字面量既容易漏字段（漏了就解析成 undefined，断言失败得莫名其妙），
 * 又会让用例的重点被淹没——所以统一给一份"完整形态 + 局部覆盖"的工厂。
 */

import type { AgentEvent } from '@/types/agent'

/** done 事件的完整形态；用例只写自己关心的那部分 */
export function doneEvent(patch: Partial<Extract<AgentEvent, { type: 'done' }>> = {}): AgentEvent {
  return {
    type: 'done',
    sessionId: 's1',
    runId: 'r1',
    messageId: 'm1',
    citations: [],
    fallback: 'kb',
    kind: 'kb',
    hitCount: 0,
    latencyMs: 0,
    status: 'ok',
    rounds: 0,
    tokens: 0,
    tools: [],
    pending: [],
    ...patch,
  }
}

/** 把一串事件包装成 streamAsk / resumeAsk 那种异步生成器 */
export function streamOf(events: AgentEvent[]) {
  return async function* () {
    for (const event of events) yield event
  }
}
