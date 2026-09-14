<script setup lang="ts">
/**
 * 原子组件：密码强度条（纯展示，规则来自 utils/auth 纯函数）
 *
 * 三件事一起给，用户才知道"差什么"：
 * 1. 进度条（按满足的规则数填色，红 → 黄 → 绿）
 * 2. 一个字的档位标签（弱 / 中 / 强）
 * 3. 未满足项清单（未达 strong 时逐条列出，注册按钮同时置灰）
 *
 * 登录/注册页与重置密码页共用，所以规则只写在 `utils/auth.ts` 一处。
 */

import { computed } from 'vue'

import { PASSWORD_LEVEL_COLOR, PASSWORD_LEVEL_LABEL, validatePassword } from '@/utils/auth'
import type { PasswordLevel } from '@/utils/auth'

const props = withDefaults(
  defineProps<{
    password: string
    /** 未达 strong 时是否列出未满足项（登录页不需要，注册/改密需要） */
    showHints?: boolean
  }>(),
  { showHints: true },
)

const check = computed(() => validatePassword(props.password))

const color = computed(() => PASSWORD_LEVEL_COLOR[check.value.level])
const label = computed(() => PASSWORD_LEVEL_LABEL[check.value.level])
/** 空密码不显示档位标签：还没开始输入就说"弱"有点冒犯 */
const showLevel = computed(() => props.password !== '')

const levelClass: Record<PasswordLevel, string> = {
  weak: 'text-rose-500',
  medium: 'text-amber-500',
  strong: 'text-emerald-500',
}
</script>

<template>
  <!--
    空密码时整块不渲染：`el-progress` 在 0% 会画出一条浅灰轨道，
    夹在「密码」和「确认密码」之间看起来就像一条分割线（用户反馈过一次）。
    有输入才出现，进度条才真正是有意义的反馈。
  -->
  <div v-if="password !== ''" class="mt-1.5" data-testid="password-strength">
    <div class="flex items-center gap-2">
      <div class="flex-1" data-testid="password-strength-bar">
        <!-- el-progress 用 :color 直接吃十六进制，避免再维护一套 Tailwind 色表 -->
        <el-progress
          :percentage="check.score"
          :stroke-width="6"
          :show-text="false"
          :color="color"
        />
      </div>
      <span
        v-if="showLevel"
        data-testid="password-strength-level"
        class="w-4 shrink-0 text-xs font-medium"
        :class="levelClass[check.level]"
      >
        {{ label }}
      </span>
    </div>

    <ul
      v-if="showHints && !check.valid"
      data-testid="password-strength-hints"
      class="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400"
    >
      <li v-for="error in check.errors" :key="error">· {{ error }}</li>
    </ul>
  </div>
</template>
