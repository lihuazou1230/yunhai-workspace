<script setup lang="ts">
/**
 * 页面：重置密码（公开路由，独立全屏）
 *
 * 触发路径：登录页「忘记密码？」→ 输入邮箱 → 收到重置链接 →
 * 点链接 → Supabase 校验 token → 带临时凭据跳回 `/reset-password` →
 * `detectSessionInUrl` 自动换成 recovery 会话 → 本页让用户设置新密码。
 *
 * 两种状态：
 * - **有会话**（正常流程）：显示新密码表单，提交后调 `updateUser({ password })`
 * - **无会话**（链接失效/过期，或用户直接敲了这个地址）：显示引导，让用户重新申请，
 *   而不是给一个提交必然失败的空白表单
 */

import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/atoms/BaseButton.vue'
import BaseInput from '@/components/atoms/BaseInput.vue'
import PasswordStrengthMeter from '@/components/atoms/PasswordStrengthMeter.vue'
import { useAuthStore } from '@/stores/authStore'
import { validatePassword } from '@/utils/auth'
import { validatePasswordConfirm } from '@/utils/validation'

const authStore = useAuthStore()
const router = useRouter()

const password = ref('')
const confirmPassword = ref('')
const submitting = ref(false)
const formErrors = ref<Record<string, string>>({})
const feedback = ref<{ ok: boolean; message: string } | null>(null)
/** 会话是否已就绪（没就绪说明链接无效/过期） */
const ready = ref(false)

const isLocalMode = computed(() => authStore.isLocalMode)

onMounted(async () => {
  // 等会话恢复：recovery 凭据就在地址里，恢复完才有会话
  await authStore.ensureReady()
  // 有些情况下 URL 里的凭据刚被处理完，再拉一次用户态更稳
  if (!authStore.isAuthed && !authStore.isLocalMode) await authStore.refreshUser()
  ready.value = true
})

/** 新密码是否达标（未达 strong 前保存按钮置灰，理由同注册：不给服务端拒一次的机会） */
const passwordCheck = computed(() => validatePassword(password.value))

function validateForm(): boolean {
  const errors: Record<string, string> = {}

  // 按钮已按强度置灰，但回车仍会触发 form submit —— 这里再拦一次（只报第一条，细则在强度条里）
  const strength = passwordCheck.value
  if (!strength.valid) errors.password = strength.errors[0] ?? '密码不符合要求'

  const confirmCheck = validatePasswordConfirm(password.value, confirmPassword.value)
  if (!confirmCheck.valid) errors.confirmPassword = confirmCheck.message ?? '两次密码不一致'

  formErrors.value = errors
  return Object.keys(errors).length === 0
}

async function submit() {
  feedback.value = null
  if (!validateForm()) return

  submitting.value = true
  try {
    const result = await authStore.changePassword(password.value)
    feedback.value = { ok: result.ok, message: result.message }
    // 改密成功：清空表单，稍后把用户送到仪表板（此时已是登录态）
    if (result.ok) {
      password.value = ''
      confirmPassword.value = ''
      setTimeout(() => void router.push({ name: 'dashboard' }), 1200)
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div
    class="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 dark:bg-slate-950"
  >
    <div class="w-full max-w-md">
      <header class="mb-6 text-center">
        <h1 class="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
          🔐 设置新密码
        </h1>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
          重置链接只能用一次、约 1 小时后过期；设置完成后即可用新密码登录
        </p>
      </header>

      <section class="card p-6" data-testid="reset-card">
        <!-- 链接无效 / 过期 -->
        <div
          v-if="ready && !authStore.isAuthed"
          data-testid="reset-invalid"
          class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
        >
          <p class="mb-1 font-semibold">链接无效或已过期</p>
          <p>
            重置链接通常只能用一次、有效期约 1
            小时。请回到登录页重新申请一封（也可能是你换了浏览器/设备打开）。
          </p>
          <BaseButton
            data-testid="reset-back-to-login"
            class="mt-3"
            size="sm"
            variant="secondary"
            @click="router.push({ name: 'login' })"
          >
            返回登录页重新申请
          </BaseButton>
        </div>

        <form v-else-if="ready" class="space-y-4" novalidate @submit.prevent="submit">
          <div v-if="authStore.isAuthed" class="text-xs text-slate-500 dark:text-slate-400">
            正在为
            <strong class="text-slate-700 dark:text-slate-200">{{ authStore.email }}</strong>
            设置新密码
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              新密码
            </label>
            <BaseInput
              v-model="password"
              data-testid="reset-password"
              type="password"
              placeholder="至少 8 位，含大小写字母与数字"
            />
            <p
              v-if="formErrors.password"
              data-testid="reset-error-password"
              class="mt-1 text-xs text-rose-500"
            >
              {{ formErrors.password }}
            </p>
            <!-- 与注册页共用同一套强度规则（utils/auth）：改密也是"新设一个密码" -->
            <PasswordStrengthMeter :password="password" />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              确认新密码
            </label>
            <BaseInput
              v-model="confirmPassword"
              data-testid="reset-confirm-password"
              type="password"
              placeholder="再次输入新密码"
            />
            <p
              v-if="formErrors.confirmPassword"
              data-testid="reset-error-confirm-password"
              class="mt-1 text-xs text-rose-500"
            >
              {{ formErrors.confirmPassword }}
            </p>
          </div>

          <BaseButton
            data-testid="reset-submit"
            native-type="submit"
            variant="primary"
            block
            :disabled="submitting || !passwordCheck.valid"
          >
            保存新密码
          </BaseButton>

          <button
            type="button"
            class="w-full text-center text-xs text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
            data-testid="reset-to-login"
            @click="router.push({ name: 'login' })"
          >
            ← 返回登录
          </button>
        </form>

        <p v-else class="text-center text-xs text-slate-400" data-testid="reset-checking">
          正在校验重置链接…
        </p>

        <p
          v-if="feedback"
          data-testid="reset-feedback"
          class="mt-4 text-center text-xs"
          :class="feedback.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'"
          role="status"
        >
          {{ feedback.message }}
        </p>

        <p
          v-if="isLocalMode"
          data-testid="reset-local-mode"
          class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
        >
          当前是本地模式（未配置 Supabase），没有云端账号密码可重置。
        </p>
      </section>
    </div>
  </div>
</template>
