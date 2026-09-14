<script setup lang="ts">
/**
 * 页面：登录 / 注册（公开路由，不套 DefaultLayout，独立全屏）
 *
 * 一页双 Tab：
 * - 登录：邮箱 + 密码
 * - 注册：昵称（可空）+ 邮箱 + 密码 + 确认密码
 * - GitHub OAuth：一键跳转授权，回跳后由 supabase-js 自动换会话
 *
 * 三个设计决策：
 * 1. **校验全用纯函数**（utils/validation 管形状、utils/auth 管密码强度）：逻辑可单测，组件只负责把错误显示出来
 * 2. **未配置 Supabase 时给配置引导 + 「以本地模式进入」**：
 *    没有云配置就永远登不进去，不能让用户卡死在这个页面
 * 3. **注册卡两道安全闸**（都卡在"发确认邮件之前"）：密码复杂度（本地实时提示）
 *    + Cloudflare Turnstile（服务端核验）。两道闸都在提交前置灰按钮并说明缺什么，
 *    而不是提交后甩一句服务端英文报错
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/atoms/BaseButton.vue'
import BaseInput from '@/components/atoms/BaseInput.vue'
import PasswordStrengthMeter from '@/components/atoms/PasswordStrengthMeter.vue'
import TurnstileCaptcha from '@/components/atoms/TurnstileCaptcha.vue'
import { useAuthStore } from '@/stores/authStore'
import { SUPABASE_SETUP_HINT, fetchAuthProviders } from '@/api/supabase'
import { isTurnstileEnabled } from '@/composables/useTurnstile'
import type { TurnstileStatus } from '@/composables/useTurnstile'
import { validateLoginPassword, validatePassword } from '@/utils/auth'
import { validateDisplayName, validateEmail, validatePasswordConfirm } from '@/utils/validation'
import { parseRedirect } from '@/router/authGuard'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

type Tab = 'signIn' | 'signUp' | 'reset'
const tab = ref<Tab>('signIn')

const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const displayName = ref('')

const submitting = ref(false)
const formErrors = ref<Record<string, string>>({})
const feedback = ref<{ ok: boolean; message: string } | null>(null)

/**
 * Turnstile 人机验证（三个 Tab 都要）：
 * - `captchaToken`：一次性 token，提交时带上（v-model 由子组件播上来）
 * - `captchaStatus`：状态机，用来决定提交按钮是否置灰
 *
 * ⚠️ Supabase 的 Captcha 是**全局开关**：打开后不只注册，
 * **登录（/token）、忘记密码（/recover）、重发验证邮件（/resend）** 都会要求 token——
 * 只在注册页放验证码，一开开关就会登不进去。所以这里三条链路共用同一个 widget。
 *
 * 未配置 siteKey（`captchaEnabled === false`）时不拦任何操作：本地开发或还没申请站点时
 * 不该把登录锁死——服务端没开 Captcha 校验时本来也不会拦。
 */
const captchaEnabled = isTurnstileEnabled()
const captchaToken = ref('')
const captchaStatus = ref<TurnstileStatus>(captchaEnabled ? 'idle' : 'disabled')
const captchaRef = ref<InstanceType<typeof TurnstileCaptcha> | null>(null)
/** 需要拦提交：配了验证码但还没通过（含加载失败——不放行正是因为不能绕过服务端核验） */
const captchaBlocked = computed(() => captchaEnabled && captchaStatus.value !== 'passed')

function onCaptchaStatus(status: TurnstileStatus) {
  captchaStatus.value = status
}

/** 注册用的密码是否达标（强度条已逐条列出缺什么） */
const passwordStrong = computed(() => validatePassword(password.value).valid)

/**
 * 提交按钮置灰条件：人机验证没过 / 注册密码不达标 / 忘记密码还在冷却。
 * 置灰而不是提交后再报错，是为了让"差什么"停在用户顺手能看到的位置。
 */
const submitBlocked = computed(() => {
  if (captchaBlocked.value) return true
  if (tab.value === 'signUp') return !passwordStrong.value
  if (tab.value === 'reset') return resendCooldown.value > 0
  return false
})

/**
 * 等待邮箱验证的那个邮箱地址（注册成功后需要去邮箱确认时设置）。
 * 有它才显示「重新发送」入口——没有它，用户只能干等，或者再点一次注册拿到「已注册」。
 */
const pendingConfirmEmail = ref('')
/** 重发冷却剩余秒数（Supabase 对发信有频率限制，本地也倒计时一次，减少无效请求） */
const resendCooldown = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | null = null

function startResendCooldown(seconds = 60) {
  resendCooldown.value = seconds
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    resendCooldown.value -= 1
    if (resendCooldown.value <= 0 && cooldownTimer) {
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }, 1000)
}

onBeforeUnmount(() => {
  if (cooldownTimer) clearInterval(cooldownTimer)
})

async function resendConfirm() {
  if (resendCooldown.value > 0 || !pendingConfirmEmail.value) return
  submitting.value = true
  try {
    const result = await authStore.resendConfirm(
      pendingConfirmEmail.value,
      captchaToken.value || undefined,
    )
    feedback.value = { ok: result.ok, message: result.message }
    if (result.ok) startResendCooldown(60)
  } finally {
    submitting.value = false
    // 任何一次提交都会花掉一次性 token，重发同样要重新取
    captchaRef.value?.reset()
  }
}

/** 登录后回跳目标（只认站内路径，挡开放重定向） */
const redirectTarget = computed(() => parseRedirect(route.query.redirect) ?? '/')
const isLocalMode = computed(() => authStore.isLocalMode)

function switchTab(next: Tab) {
  tab.value = next
  formErrors.value = {}
  feedback.value = null
  // 切走就清掉上一种模式留下的提示，避免「注册待验证」面板出现在忘记密码页
  pendingConfirmEmail.value = ''
  resetSentTo.value = ''
  // 注意：**不重置验证码**。widget 挂在三个 Tab 之外、始终是同一个实例，
  // 拿到的一次性 token 对登录/注册/忘记密码三条链路都有效（消费掉才失效），
  // 切 Tab 就丢弃只会让用户白白再等一次校验。
}

/** 表单校验（纯函数），返回是否通过 */
function validateForm(): boolean {
  const errors: Record<string, string> = {}

  const emailCheck = validateEmail(email.value)
  if (!emailCheck.valid) errors.email = emailCheck.message ?? '邮箱格式不正确'

  // 人机验证对三个 Tab 都要：服务端开了 Captcha，登录/忘记密码/重发也一样要求 token
  if (captchaBlocked.value) errors.captcha = '请先完成人机验证'

  // 忘记密码只需要邮箱（此时还没有密码可校验）
  if (tab.value === 'reset') {
    formErrors.value = errors
    return Object.keys(errors).length === 0
  }

  if (tab.value === 'signIn') {
    /**
     * 登录只查非空：复杂度规则是本期才加的，老账号未必合规，
     * 而服务端才是权威——前端按新规则拦下来只会让用户连登录都做不到，
     * 看到的还不是真实原因（真实原因只能是「密码不对」）。
     */
    const loginCheck = validateLoginPassword(password.value)
    if (!loginCheck.valid) errors.password = loginCheck.message ?? '请输入密码'
  } else {
    /**
     * 注册：硬性规则一条不落。
     * 按钮虽然已置灰，但**回车照样会触发 form submit**，所以这里必须再拦一次；
     * 报错只取第一条（强度条已经把"缺什么"逐条列在输入框下方，不重复念一遍）。
     */
    const strength = validatePassword(password.value)
    if (!strength.valid) errors.password = strength.errors[0] ?? '密码不符合要求'

    const nameCheck = validateDisplayName(displayName.value)
    if (!nameCheck.valid) errors.displayName = nameCheck.message ?? '昵称不符合要求'

    const confirmCheck = validatePasswordConfirm(password.value, confirmPassword.value)
    if (!confirmCheck.valid) errors.confirmPassword = confirmCheck.message ?? '两次密码不一致'
  }

  formErrors.value = errors
  return Object.keys(errors).length === 0
}

/** 忘记密码：发重置邮件（成功后同样进入 60 秒冷却，Supabase 对发信有限流） */
const resetSentTo = ref('')

async function sendReset() {
  if (resendCooldown.value > 0) return
  feedback.value = null
  if (!validateForm()) return

  submitting.value = true
  try {
    const result = await authStore.sendResetEmail(email.value, captchaToken.value || undefined)
    feedback.value = { ok: result.ok, message: result.message }
    if (result.ok) {
      resetSentTo.value = email.value.trim()
      startResendCooldown(60)
    }
  } finally {
    submitting.value = false
    captchaRef.value?.reset()
  }
}

async function submit() {
  feedback.value = null
  if (tab.value === 'reset') {
    await sendReset()
    return
  }
  if (!validateForm()) return

  submitting.value = true
  const isSignUp = tab.value === 'signUp'
  // 没启用验证码时给 undefined（而不是空串）：payload 干净，服务端也不会收到空 token
  const token = captchaToken.value || undefined
  try {
    const result = isSignUp
      ? await authStore.signUp({
          email: email.value,
          password: password.value,
          displayName: displayName.value,
          captchaToken: token,
        })
      : await authStore.signIn(email.value, password.value, token)

    feedback.value = { ok: result.ok, message: result.message }
    // 需要邮箱验证时不跳转：还没有会话，进去也会被守卫送回登录页
    if (result.ok && !result.needsEmailConfirm) {
      await router.push(redirectTarget.value)
      return
    }
    // 记住待验证邮箱，并给一个重发入口（邮件慢/进垃圾箱是常态）
    if (result.ok && result.needsEmailConfirm) {
      pendingConfirmEmail.value = email.value.trim()
      startResendCooldown(60)
    }
  } finally {
    submitting.value = false
    /**
     * Turnstile 的 token 是**一次性**的：这次提交已经把它花掉了（成功失败都一样），
     * 必须重新取一枚，否则用户改个邮箱再点注册会被服务端直接拒掉（登录同样如此）。
     * 这是这条链路里最容易漏的坑——状态机与重置都收口在 TurnstileCaptcha 里。
     */
    captchaRef.value?.reset()
  }
}

async function signInWithGithub() {
  feedback.value = null
  submitting.value = true
  try {
    const result = await authStore.signInWithGithub(window.location.href)
    feedback.value = { ok: result.ok, message: result.message }
  } finally {
    submitting.value = false
  }
}

/** 本地模式：直接进应用（没有云配置时不该把用户挡在门外） */
function enterLocalMode() {
  void router.push(redirectTarget.value)
}

// ---- 按服务端实际开启的登录方式来渲染按钮 ----
/** null = 还没问到（保持按钮可见，不因一次网络抖动把功能藏起来） */
const githubEnabled = ref<boolean | null>(null)

/**
 * 已经登录还落在登录页 → 直接送进应用。
 *
 * 两个真实场景：① 点了邮件验证链接，会话是在**本页挂载之后**才建立起来的
 * （守卫那一轮判定时还没有会话）；② 用户在别的标签页登录过，又手动打开了 /login。
 * 没有这一步，用户就得自己再点一次"登录"——看起来就像"验证完了却没登录"。
 */
watch(
  () => authStore.isAuthed,
  (authed) => {
    if (authed) void router.replace(redirectTarget.value)
  },
  { immediate: true },
)

onMounted(async () => {
  /**
   * 先恢复会话（守卫通常已经调过；这里兜底，直接打开 /login 时也拿得到状态）。
   * **必须在取 redirectNotice 之前 await**：邮件链接的落地结果是在 init() 里产生的。
   */
  await authStore.init()

  // 邮件链接落地结果（验证成功 / 链接过期）展示一次
  const notice = authStore.takeRedirectNotice()
  if (notice) feedback.value = { ok: notice.ok, message: notice.message }

  if (isLocalMode.value) return
  const providers = await fetchAuthProviders()
  if (providers) githubEnabled.value = providers.github
})
</script>

<template>
  <div
    class="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 dark:bg-slate-950"
  >
    <div class="w-full max-w-md">
      <header class="mb-6 text-center">
        <h1 class="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
          🧭 云海工作台
        </h1>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
          登录后任务数据多设备同步；不登录也能先用本地模式
        </p>
      </header>

      <section class="card p-6" data-testid="login-card">
        <!-- 未配置 Supabase：给配置引导，而不是让用户对着报错发懵 -->
        <div
          v-if="isLocalMode"
          data-testid="login-setup-hint"
          class="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
        >
          <p class="mb-1 font-semibold">当前是本地模式（未配置 Supabase）</p>
          <p>{{ SUPABASE_SETUP_HINT }}</p>
          <BaseButton
            data-testid="login-enter-local"
            class="mt-3"
            size="sm"
            variant="secondary"
            @click="enterLocalMode"
          >
            以本地模式进入应用
          </BaseButton>
        </div>

        <!-- Tab 切换（忘记密码模式隐藏，改用标题+返回链接） -->
        <div
          v-if="tab !== 'reset'"
          class="mb-5 flex gap-1 rounded-full bg-slate-100 p-1 dark:bg-slate-800"
        >
          <button
            type="button"
            data-testid="login-tab-signin"
            class="flex-1 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
            :class="
              tab === 'signIn'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700'
            "
            @click="switchTab('signIn')"
          >
            登录
          </button>
          <button
            type="button"
            data-testid="login-tab-signup"
            class="flex-1 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
            :class="
              tab === 'signUp'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700'
            "
            @click="switchTab('signUp')"
          >
            注册
          </button>
        </div>

        <!-- 忘记密码：说明 + 返回登录 -->
        <div v-if="tab === 'reset'" class="mb-5">
          <h2 class="text-base font-semibold text-slate-800 dark:text-slate-100">忘记密码</h2>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            填入注册时用的邮箱，我们会发一封重置链接（通常 1~2 分钟到达，没收到先看垃圾箱）
          </p>
        </div>

        <form class="space-y-4" novalidate @submit.prevent="submit">
          <!-- 昵称（仅注册） -->
          <div v-if="tab === 'signUp'">
            <label class="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              昵称（可留空，默认用邮箱前缀）
            </label>
            <BaseInput v-model="displayName" data-testid="login-display-name" placeholder="张三" />
            <p
              v-if="formErrors.displayName"
              data-testid="login-error-display-name"
              class="mt-1 text-xs text-rose-500"
            >
              {{ formErrors.displayName }}
            </p>
          </div>

          <!-- 邮箱 -->
          <div>
            <label class="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              邮箱
            </label>
            <BaseInput
              v-model="email"
              data-testid="login-email"
              type="text"
              placeholder="you@example.com"
            />
            <p
              v-if="formErrors.email"
              data-testid="login-error-email"
              class="mt-1 text-xs text-rose-500"
            >
              {{ formErrors.email }}
            </p>
          </div>

          <!-- 密码（忘记密码模式不需要） -->
          <div v-if="tab !== 'reset'">
            <div class="mb-1 flex items-center justify-between">
              <label class="block text-xs font-medium text-slate-600 dark:text-slate-300">
                密码
              </label>
              <button
                v-if="tab === 'signIn' && !isLocalMode"
                type="button"
                data-testid="login-forgot-password"
                class="text-xs text-[var(--el-color-primary)] underline-offset-2 hover:underline"
                @click="switchTab('reset')"
              >
                忘记密码？
              </button>
            </div>
            <BaseInput
              v-model="password"
              data-testid="login-password"
              type="password"
              :placeholder="tab === 'signUp' ? '至少 8 位，含大小写字母与数字' : '请输入密码'"
            />
            <p
              v-if="formErrors.password"
              data-testid="login-error-password"
              class="mt-1 text-xs text-rose-500"
            >
              {{ formErrors.password }}
            </p>
            <!-- 注册才给强度条：登录不校验复杂度（老账号未必合规，服务端才是权威） -->
            <PasswordStrengthMeter v-if="tab === 'signUp'" :password="password" />
          </div>

          <!-- 确认密码（仅注册） -->
          <div v-if="tab === 'signUp'">
            <label class="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              确认密码
            </label>
            <BaseInput
              v-model="confirmPassword"
              data-testid="login-confirm-password"
              type="password"
              placeholder="再次输入密码"
            />
            <p
              v-if="formErrors.confirmPassword"
              data-testid="login-error-confirm-password"
              class="mt-1 text-xs text-rose-500"
            >
              {{ formErrors.confirmPassword }}
            </p>
          </div>

          <!--
            人机验证（三个 Tab 共用同一个 widget，所以放在 tab 条件之外，切 Tab 不重挂载）：
            服务端一开 Attack Protection，登录 / 注册 / 忘记密码 / 重发都要求 token。
            token 一次性，每次提交后由 submit()/sendReset()/resendConfirm() 负责重置重取。
          -->
          <div>
            <TurnstileCaptcha
              ref="captchaRef"
              v-model="captchaToken"
              data-testid="login-captcha"
              @status="onCaptchaStatus"
            />
            <p
              v-if="formErrors.captcha"
              data-testid="login-error-captcha"
              class="mt-1 text-xs text-rose-500"
            >
              {{ formErrors.captcha }}
            </p>
          </div>

          <!-- 提交 -->
          <BaseButton
            data-testid="login-submit"
            native-type="submit"
            variant="primary"
            block
            :disabled="submitting || submitBlocked"
          >
            {{
              tab === 'reset'
                ? resendCooldown > 0
                  ? `重新发送（${resendCooldown}s 后可再发）`
                  : '发送重置邮件'
                : tab === 'signIn'
                  ? '登录'
                  : '注册并登录'
            }}
          </BaseButton>

          <!-- 忘记密码：返回登录 -->
          <button
            v-if="tab === 'reset'"
            type="button"
            data-testid="login-back-to-signin"
            class="w-full text-center text-xs text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
            @click="switchTab('signIn')"
          >
            ← 返回登录
          </button>
        </form>

        <!-- 重置邮件已发送：说明 + 冷却提示 -->
        <div
          v-if="tab === 'reset' && resetSentTo"
          data-testid="login-reset-sent"
          class="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
        >
          重置链接已发送到 <strong>{{ resetSentTo }}</strong
          >，点邮件里的链接即可设置新密码（有效期约 1 小时，过期可再发一次）。
        </div>

        <!-- GitHub OAuth：只在服务端确实开启时才渲染（否则点了只会报 provider is not enabled） -->
        <template v-if="tab !== 'reset' && githubEnabled !== false">
          <div class="my-5 flex items-center gap-3">
            <span class="h-px flex-1 bg-slate-200 dark:bg-slate-700"></span>
            <span class="text-xs text-slate-400">或</span>
            <span class="h-px flex-1 bg-slate-200 dark:bg-slate-700"></span>
          </div>
          <BaseButton
            data-testid="login-github"
            variant="secondary"
            block
            :disabled="submitting"
            @click="signInWithGithub"
          >
            <span class="mr-2">🐙</span>使用 GitHub 登录
          </BaseButton>
        </template>

        <!-- 反馈 -->
        <p
          v-if="feedback"
          data-testid="login-feedback"
          class="mt-4 text-center text-xs"
          :class="feedback.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'"
          role="status"
        >
          {{ feedback.message }}
        </p>

        <!-- 等待邮箱验证：给重发入口 + 说清「慢/进垃圾箱」是常态，别让用户干等 -->
        <div
          v-if="pendingConfirmEmail"
          data-testid="login-pending-confirm"
          class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
        >
          <p>
            请到 <strong>{{ pendingConfirmEmail }}</strong> 查收验证邮件（通常 1~2 分钟送达，
            <strong>没收到先看垃圾箱</strong>）。点邮件里的链接即可完成注册并自动登录。
          </p>
          <button
            type="button"
            data-testid="login-resend-confirm"
            class="mt-2 font-medium underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="resendCooldown > 0 || submitting || captchaBlocked"
            @click="resendConfirm"
          >
            {{
              resendCooldown > 0
                ? `重新发送验证邮件（${resendCooldown}s 后可再发）`
                : '重新发送验证邮件'
            }}
          </button>
        </div>
      </section>

      <!-- 只在本地模式下给「随便逛逛」出口：配了 Supabase 后点它会被守卫弹回来，等于死链 -->
      <p
        v-if="isLocalMode"
        data-testid="login-browse-local"
        class="mt-4 text-center text-xs text-slate-400 dark:text-slate-500"
      >
        <router-link :to="{ name: 'dashboard' }" class="underline hover:text-slate-600">
          先随便逛逛（本地模式）
        </router-link>
      </p>
    </div>
  </div>
</template>
