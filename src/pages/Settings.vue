<script setup lang="ts">
/**
 * 页面：设置
 *
 * 四块内容：
 * 1. **个人资料**：头像（圆形预览 + 更换/裁剪）+ 昵称/邮箱/登录方式
 * 2. **数据同步**：模式（云端/本地）、同步状态、上次同步时间、「立即同步」，
 *    以及旧数据迁移状态——把「数据在哪、有没有同步上」明确告诉用户
 * 3. **外观自定义**：主题色/圆角/密度/明暗（复用 SettingsPanel，从抽屉改为整页）
 * 4. **标签管理**（第六阶段 6.1）：改名 / 改色 / 删除（删除时说明影响范围）
 */

import { computed, ref } from 'vue'

import AvatarUpload from '@/components/organisms/AvatarUpload.vue'
import SettingsPanel from '@/components/organisms/SettingsPanel.vue'
import BaseBadge from '@/components/atoms/BaseBadge.vue'
import BaseButton from '@/components/atoms/BaseButton.vue'
import { SUPABASE_SETUP_HINT, checkSupabaseConnection } from '@/api/supabase'
import type { ConnectionCheck } from '@/api/supabase'
import { TAG_COLOR_DOT, TAG_COLOR_LABEL, TAG_COLOR_PALETTE } from '@/types/tag'
import type { TagColor } from '@/types/tag'
import { useAvatar } from '@/composables/useAvatar'
import { useAuthStore } from '@/stores/authStore'
import { useTagStore } from '@/stores/tagStore'
import { useTodoStore } from '@/stores/todoStore'

const authStore = useAuthStore()
const todoStore = useTodoStore()
const tagStore = useTagStore()
const avatarOpen = ref(false)

// ---- 标签管理 ----
const tagError = ref('')
const removeDialogOpen = ref(false)
/** 待删除的标签 id（确认弹窗里要显示名字与影响范围） */
const pendingRemoveId = ref<string | null>(null)

const pendingRemove = computed(() =>
  pendingRemoveId.value ? tagStore.getTag(pendingRemoveId.value) : undefined,
)

/** 某个标签被多少任务引用（删除确认里要讲清楚影响范围） */
function tagUsage(tagId: string): number {
  return todoStore.todos.filter((t) => t.tags.includes(tagId)).length
}

const pendingRemoveUsage = computed(() =>
  pendingRemoveId.value ? tagUsage(pendingRemoveId.value) : 0,
)

function renameTag(id: string, name: string) {
  const current = tagStore.getTag(id)
  if (!current || current.name === name.trim()) return
  if (!tagStore.updateTag(id, { name })) {
    tagError.value = '改名失败：标签名不能为空、不超过 12 字，且不能与其他标签重名'
    return
  }
  tagError.value = ''
}

function recolorTag(id: string, color: TagColor) {
  tagStore.updateTag(id, { color })
}

function askRemoveTag(id: string) {
  pendingRemoveId.value = id
  removeDialogOpen.value = true
}

function confirmRemoveTag() {
  const id = pendingRemoveId.value
  if (!id) return
  // 先摘掉任务上的引用，再删标签：任务本身不删（规划明确要求）
  todoStore.removeTagReference(id)
  tagStore.removeTag(id)
  removeDialogOpen.value = false
  pendingRemoveId.value = null
  tagError.value = ''
}

const { displayUrl, fallbackInitial, markImageFailed, loadLocalAvatar } = useAvatar()
void loadLocalAvatar()

const syncTone = computed<'success' | 'warning' | 'info'>(() => {
  if (todoStore.syncState === 'offline') return 'warning'
  if (todoStore.syncState === 'synced') return 'success'
  return 'info'
})

const syncText = computed(() => {
  if (authStore.isLocalMode) return '本地模式（未配置 Supabase）'
  if (!authStore.isAuthed) return '未登录'
  if (todoStore.syncState === 'syncing') return '同步中…'
  if (todoStore.syncState === 'offline') return '离线（改动已排队，联网后自动补发）'
  if (todoStore.syncState === 'synced') return '已同步'
  return '待同步'
})

const lastSyncedText = computed(() => {
  if (!todoStore.lastSyncedAt) return '尚未同步'
  const date = new Date(todoStore.lastSyncedAt)
  return `上次同步：${date.toLocaleString('zh-CN', { hour12: false })}`
})

/** 本地旧数据是否已经迁移到当前账号 */
const migrationText = computed(() => {
  const userId = authStore.user?.id
  if (!userId) return '登录后可把本地任务迁移到云端'
  return todoStore.isMigrated(userId)
    ? '本地旧数据已迁移到云端（一次性，不会重复推送）'
    : '尚未迁移：下次进入时会把本地任务合并进云端'
})

const pendingCount = computed(() => todoStore.syncQueue.length)

async function syncNow() {
  await todoStore.syncNow()
}

// ---- 连接自检（区分「地址写错」与「密钥不对」） ----
const checking = ref(false)
const connectionResult = ref<ConnectionCheck | null>(null)

async function testConnection() {
  checking.value = true
  try {
    connectionResult.value = await checkSupabaseConnection()
  } finally {
    checking.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <header>
      <h1 class="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">⚙️ 设置</h1>
      <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">个人资料、数据同步与外观自定义</p>
    </header>

    <!-- 个人资料 -->
    <section class="card p-5" aria-label="个人资料">
      <h2 class="mb-4 text-sm font-semibold text-slate-500 dark:text-slate-400">个人资料</h2>
      <div class="flex flex-wrap items-center gap-4">
        <img
          v-if="displayUrl"
          data-testid="settings-avatar"
          :src="displayUrl"
          alt="当前头像"
          class="h-16 w-16 rounded-full object-cover ring-2 ring-[var(--el-color-primary)]/40"
          @error="markImageFailed"
        />
        <span
          v-else
          data-testid="settings-avatar"
          class="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--el-color-primary)] text-lg font-semibold text-white ring-2 ring-[var(--el-color-primary)]/30"
        >
          {{ fallbackInitial }}
        </span>

        <div class="min-w-0 flex-1">
          <p class="truncate text-base font-semibold text-slate-800 dark:text-slate-100">
            {{ authStore.displayName }}
          </p>
          <p class="truncate text-xs text-slate-500 dark:text-slate-400">
            {{ authStore.isAuthed ? authStore.email : '未登录（头像与任务只保存在本机）' }}
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <BaseBadge :tone="authStore.isAuthed ? 'success' : 'info'" size="sm">
              {{ authStore.isAuthed ? `已登录 · ${authStore.user?.provider}` : '本地访客' }}
            </BaseBadge>
            <BaseBadge v-if="authStore.isLocalMode" tone="warning" size="sm">本地模式</BaseBadge>
          </div>
        </div>

        <BaseButton data-testid="settings-avatar-edit" size="sm" @click="avatarOpen = true">
          更换头像
        </BaseButton>
      </div>

      <p class="mt-3 text-xs text-slate-400 dark:text-slate-500">
        头像支持圆形裁剪，自动压缩为 256×256 的 WebP；未登录时保存在本机
        IndexedDB，登录后同步到云端。
      </p>
    </section>

    <!-- 数据同步 -->
    <section class="card p-5" aria-label="数据同步">
      <h2 class="mb-4 text-sm font-semibold text-slate-500 dark:text-slate-400">数据同步</h2>

      <div class="space-y-3 text-sm text-slate-600 dark:text-slate-300">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-slate-400 dark:text-slate-500">状态</span>
          <BaseBadge :tone="syncTone" size="sm" data-testid="settings-sync-state">
            {{ syncText }}
          </BaseBadge>
          <span v-if="pendingCount > 0" class="text-xs text-amber-600 dark:text-amber-400">
            待补发 {{ pendingCount }} 项
          </span>
        </div>

        <p data-testid="settings-sync-time" class="text-xs text-slate-500 dark:text-slate-400">
          {{ lastSyncedText }}
        </p>
        <p data-testid="settings-migration" class="text-xs text-slate-500 dark:text-slate-400">
          {{ migrationText }}
        </p>
        <p
          v-if="todoStore.syncMessage"
          data-testid="settings-sync-message"
          class="text-xs text-amber-600 dark:text-amber-400"
        >
          {{ todoStore.syncMessage }}
        </p>

        <!-- 未配置 Supabase：给配置引导 -->
        <p
          v-if="authStore.isLocalMode"
          data-testid="settings-setup-hint"
          class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
        >
          {{ SUPABASE_SETUP_HINT }}
        </p>

        <div class="flex flex-wrap gap-2 pt-1">
          <BaseButton
            data-testid="settings-sync-now"
            size="sm"
            :disabled="!authStore.isAuthed"
            @click="syncNow"
          >
            立即同步
          </BaseButton>
          <BaseButton
            data-testid="settings-connection-test"
            size="sm"
            variant="secondary"
            :disabled="checking || authStore.isLocalMode"
            @click="testConnection"
          >
            {{ checking ? '检测中…' : '测试连接' }}
          </BaseButton>
          <router-link v-if="!authStore.isAuthed" :to="{ name: 'login' }">
            <BaseButton data-testid="settings-sign-in" size="sm" variant="secondary">
              登录 / 注册
            </BaseButton>
          </router-link>
        </div>

        <!-- 连接自检结果：把「地址对不对 / 密钥对不对」分开说清楚 -->
        <p
          v-if="connectionResult"
          data-testid="settings-connection-result"
          class="rounded-xl border p-3 text-xs leading-relaxed"
          :class="
            connectionResult.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
              : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200'
          "
        >
          <span class="font-semibold">{{ connectionResult.ok ? '✅' : '❌' }}</span>
          {{ connectionResult.message }}
          <code class="mt-1 block break-all opacity-70">{{ connectionResult.detail }}</code>
        </p>
      </div>
    </section>

    <!-- 外观自定义 -->
    <section class="card p-5" aria-label="外观自定义">
      <h2 class="mb-4 text-sm font-semibold text-slate-500 dark:text-slate-400">外观自定义</h2>
      <SettingsPanel />
    </section>

    <!-- 标签管理（第六阶段 6.1）：改名 / 改色 / 删除 -->
    <section class="card p-5" aria-label="标签管理">
      <h2 class="mb-1 text-sm font-semibold text-slate-500 dark:text-slate-400">标签管理</h2>
      <p class="mb-4 text-xs text-slate-400 dark:text-slate-500">
        任务只记录标签 id，所以这里改名/改色会立刻作用于所有已打标的任务。
      </p>

      <p v-if="tagStore.tagCount === 0" class="text-xs text-slate-400 dark:text-slate-500">
        还没有标签。去「任务」页的新建表单里点「+ 新标签」创建第一个。
      </p>

      <ul v-else class="space-y-2" data-testid="tag-manager">
        <li
          v-for="tag in tagStore.tags"
          :key="tag.id"
          class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700"
        >
          <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="TAG_COLOR_DOT[tag.color]"></span>

          <input
            :value="tag.name"
            type="text"
            :aria-label="`${tag.name} 标签名`"
            :data-testid="`tag-name-${tag.id}`"
            class="w-32 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm text-slate-700 outline-none hover:border-slate-200 focus:border-[var(--el-color-primary)] dark:text-slate-200 dark:hover:border-slate-600"
            @change="renameTag(tag.id, ($event.target as HTMLInputElement).value)"
          />

          <!-- 改色：点色点直接换 -->
          <span class="flex items-center gap-1">
            <button
              v-for="color in TAG_COLOR_PALETTE"
              :key="color"
              type="button"
              class="h-3.5 w-3.5 rounded-full transition-transform hover:scale-110"
              :class="[TAG_COLOR_DOT[color], tag.color === color ? 'ring-2 ring-slate-400' : '']"
              :aria-label="`把${tag.name}改成${TAG_COLOR_LABEL[color]}色`"
              :data-testid="`tag-color-${tag.id}-${color}`"
              @click="recolorTag(tag.id, color)"
            />
          </span>

          <span class="ml-auto flex items-center gap-2">
            <span class="text-xs text-slate-400 dark:text-slate-500">
              {{ tagUsage(tag.id) }} 个任务
            </span>
            <BaseButton
              size="sm"
              variant="danger"
              :data-testid="`tag-delete-${tag.id}`"
              @click="askRemoveTag(tag.id)"
            >
              删除
            </BaseButton>
          </span>
        </li>
      </ul>

      <p v-if="tagError" class="mt-2 text-xs text-rose-500" role="alert">{{ tagError }}</p>

      <!-- 删除确认：明确说明影响范围（标签没了，任务还在） -->
      <el-dialog v-model="removeDialogOpen" title="删除标签" width="420px">
        <p class="text-sm text-slate-600 dark:text-slate-300">
          将删除标签「{{ pendingRemove?.name }}」，并从
          <span class="font-semibold">{{ pendingRemoveUsage }} 个任务</span>
          上摘掉它。
        </p>
        <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
          <strong>任务不会被删除</strong>，只是少了一个分类；标签的颜色与名字也无法恢复。
        </p>
        <template #footer>
          <BaseButton variant="secondary" @click="removeDialogOpen = false">取消</BaseButton>
          <BaseButton variant="danger" data-testid="tag-delete-confirm" @click="confirmRemoveTag">
            确认删除
          </BaseButton>
        </template>
      </el-dialog>
    </section>

    <!-- 关于 -->
    <section class="card p-5" aria-label="关于">
      <h2 class="mb-3 text-sm font-semibold text-slate-500 dark:text-slate-400">关于</h2>
      <p class="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Vue 3 + TypeScript + Tailwind CSS + Element Plus + Pinia + Vue Router + ECharts，
        用户系统与数据同步基于 Supabase Auth / Postgres（RLS） / Storage。 运行模式：{{
          authStore.mode === 'cloud' ? '云端（已配置 Supabase）' : '本地（未配置 Supabase）'
        }}。
      </p>
    </section>

    <AvatarUpload v-model="avatarOpen" />
  </div>
</template>
