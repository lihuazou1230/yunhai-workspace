<script setup lang="ts">
/**
 * 有机体组件：快捷导航（Link Dock）——「每天都要开的几个站」一键直达。
 *
 * - 查看态：按分组铺成图标卡网格（3 / 4 / 6 列），点一下新标签页打开
 * - 编辑态：「＋ 添加链接」表单 + 每条链接右上角的删除按钮
 * - 图标三级兜底：自定义 iconUrl（否则 Google s2 抓取）→ 站点自己的 /favicon.ico → 首字母色块
 *
 * 校验与分组规则都在 linkHelper / linkStore 的纯函数里，组件只做接线；
 * 这里唯一自己拿着的状态是「每个链接的图标失败到哪一级」——纯 UI 事，不值得进 store。
 */

import { nextTick, ref } from 'vue'

import BaseButton from '@/components/atoms/BaseButton.vue'
import BaseInput from '@/components/atoms/BaseInput.vue'
import { useLinkStore } from '@/stores/linkStore'
import { DEFAULT_LINK_GROUP, MAX_LINK_TITLE } from '@/types/link'
import type { LinkItem } from '@/types/link'
import { faviconUrl, isValidLinkTitle, normalizeUrl } from '@/utils/linkHelper'

const store = useLinkStore()

/** 编辑态：查看 / 管理（管理态才出现删除按钮与添加表单） */
const editing = ref(false)

/** 添加表单草稿 */
const draftTitle = ref('')
const draftUrl = ref('')
const draftGroup = ref(DEFAULT_LINK_GROUP)
/** 内联错误提示（不用 toast：错误就该长在输入框旁边） */
const addError = ref('')
/** 标题输入框外层节点，用于「再加一条」时把光标送回去 */
const titleField = ref<HTMLElement | null>(null)

/** 分组输入框的外观：BaseInput 透不出 `list` 属性，datalist 需要它，所以这里手写同一套样式 */
const GROUP_INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-[var(--el-color-primary)] focus:ring-2 focus:ring-[var(--el-color-primary-light-7)] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-[var(--el-color-primary-dark-2)]'

function toggleEdit() {
  editing.value = !editing.value
  addError.value = ''
}

/**
 * 「＋ 添加链接」：进入编辑态 + 清空草稿 + 光标回到标题框。
 * 空状态下这个入口兼作「开始添加」，有链接时就是「再加一条」——同一件事，没必要两套按钮。
 */
function startAdd() {
  editing.value = true
  addError.value = ''
  draftTitle.value = ''
  draftUrl.value = ''
  draftGroup.value = DEFAULT_LINK_GROUP
  void nextTick(() => titleField.value?.querySelector('input')?.focus())
}

function submitAdd() {
  const title = draftTitle.value.trim()
  if (!isValidLinkTitle(title)) {
    addError.value = `名称不能为空，且不超过 ${MAX_LINK_TITLE} 个字`
    return
  }
  if (!normalizeUrl(draftUrl.value)) {
    addError.value = '网址格式不正确，例如 example.com 或 https://example.com'
    return
  }

  const created = store.addLink({ title, url: draftUrl.value, group: draftGroup.value })
  if (!created) {
    addError.value = '添加失败，请检查名称与网址'
    return
  }

  addError.value = ''
  // 只清空名称与网址、保留分组：连着录同一分组的几个站点是常见操作
  draftTitle.value = ''
  draftUrl.value = ''
  void nextTick(() => titleField.value?.querySelector('input')?.focus())
}

/**
 * 图标失败阶段（按链接 id 各自记录，一个坏图标不会连累其它链接）：
 * `site` = 抓取图标失败，已退回站点自己的 /favicon.ico；`letter` = 连它也不行，只能上首字母色块。
 */
type IconFallback = 'site' | 'letter'
const iconFallbacks = ref<Record<string, IconFallback>>({})

/** 站点自带的 favicon（url 已归一化成绝对地址，正常解析不会失败） */
function ownFavicon(url: string): string {
  try {
    return new URL('/favicon.ico', url).href
  } catch {
    return ''
  }
}

/** 当前该用哪个图标地址；空串 = 走首字母兜底 */
function iconSrc(link: LinkItem): string {
  const stage = iconFallbacks.value[link.id]
  if (stage === 'letter') return ''
  if (stage === 'site') return ownFavicon(link.url)
  return link.iconUrl || faviconUrl(link.url)
}

function onIconError(link: LinkItem) {
  iconFallbacks.value = {
    ...iconFallbacks.value,
    [link.id]: iconFallbacks.value[link.id] === 'site' ? 'letter' : 'site',
  }
}

/** 首字母兜底（中文取第一个字，英文转大写；与 SidebarNav 的头像兜底同一套写法） */
function letterOf(link: LinkItem): string {
  return link.title.trim().charAt(0).toUpperCase() || '·'
}
</script>

<template>
  <section class="card p-5" aria-label="快捷导航">
    <header class="mb-3 flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-slate-500 dark:text-slate-400">🔗 快捷导航</h2>
      <div class="flex items-center gap-2">
        <!-- 空状态下入口在空状态块里，二者互斥，保证同一 testid 全页只有一个 -->
        <BaseButton
          v-if="editing && store.linkCount > 0"
          size="sm"
          variant="secondary"
          data-testid="linkdock-add"
          @click="startAdd"
        >
          ＋ 添加链接
        </BaseButton>
        <BaseButton
          size="sm"
          :variant="editing ? 'primary' : 'ghost'"
          data-testid="linkdock-edit-toggle"
          @click="toggleEdit"
        >
          {{ editing ? '完成' : '编辑' }}
        </BaseButton>
      </div>
    </header>

    <!-- 链接网格：按分组铺开，只渲染有链接的分组 -->
    <div v-if="store.linkCount > 0" class="space-y-4">
      <div v-for="bucket in store.groups" :key="bucket.group">
        <h3
          class="mb-1.5 text-xs font-medium text-slate-400 dark:text-slate-500"
          :data-testid="`linkdock-group-${bucket.group}`"
        >
          {{ bucket.group }}
        </h3>
        <div
          class="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6"
          :data-testid="`linkdock-grid-${bucket.group}`"
        >
          <!-- 删除按钮放在 <a> **外面**（靠外层 relative 定位）：交互元素不能嵌在锚点里 -->
          <div v-for="link in bucket.links" :key="link.id" class="relative">
            <a
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
              :title="link.url"
              :data-testid="`linkdock-link-${link.id}`"
              class="flex flex-col items-center gap-1.5 rounded-xl p-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <span class="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg">
                <img
                  v-if="iconSrc(link)"
                  :src="iconSrc(link)"
                  :alt="`${link.title} 图标`"
                  :data-testid="`link-icon-${link.id}`"
                  class="h-7 w-7 rounded-md object-contain"
                  @error="onIconError(link)"
                />
                <span
                  v-else
                  :data-testid="`link-icon-fallback-${link.id}`"
                  class="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--el-color-primary)] text-sm font-semibold leading-none text-white"
                >
                  {{ letterOf(link) }}
                </span>
              </span>
              <span class="w-full truncate text-center text-xs text-slate-600 dark:text-slate-300">
                {{ link.title }}
              </span>
            </a>

            <button
              v-if="editing"
              type="button"
              :aria-label="`删除 ${link.title}`"
              :data-testid="`link-delete-${link.id}`"
              class="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-xs leading-none text-white shadow transition-transform hover:scale-110"
              @click="store.removeLink(link.id)"
            >
              ×
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态：一句引导 + 添加入口（入口与编辑态那个按钮互斥，见 header 注释） -->
    <div
      v-else
      class="rounded-xl border border-dashed border-slate-300 py-8 text-center dark:border-slate-600"
      data-testid="linkdock-empty"
    >
      <p class="text-sm text-slate-400 dark:text-slate-500">
        还没有快捷入口，把每天都要打开的网站放进来，一键直达 🚀
      </p>
      <BaseButton
        v-if="!editing"
        size="sm"
        variant="secondary"
        class="mt-3"
        data-testid="linkdock-add"
        @click="startAdd"
      >
        ＋ 添加链接
      </BaseButton>
    </div>

    <!-- 添加表单（编辑态常驻：填完直接提交，少一次「展开」点击） -->
    <form
      v-if="editing"
      data-testid="link-add-form"
      class="mt-4 space-y-2 rounded-xl border border-[var(--el-color-primary-light-7)] bg-[var(--el-color-primary-light-9)] p-3"
      @submit.prevent="submitAdd"
    >
      <div class="grid gap-2 sm:grid-cols-3">
        <div ref="titleField" data-testid="link-add-title">
          <BaseInput v-model="draftTitle" :placeholder="`名称（最多 ${MAX_LINK_TITLE} 个字）`" />
        </div>
        <div data-testid="link-add-url">
          <BaseInput v-model="draftUrl" placeholder="网址，如 example.com" />
        </div>
        <div data-testid="link-add-group">
          <input
            v-model="draftGroup"
            list="linkdock-group-options"
            :placeholder="DEFAULT_LINK_GROUP"
            :class="GROUP_INPUT_CLASS"
          />
          <datalist id="linkdock-group-options">
            <option v-for="group in store.allGroups" :key="group" :value="group" />
          </datalist>
        </div>
      </div>

      <p
        v-if="addError"
        data-testid="link-add-error"
        class="text-xs text-rose-600 dark:text-rose-400"
      >
        {{ addError }}
      </p>

      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-slate-400 dark:text-slate-500">
          分组留空即归入「{{ DEFAULT_LINK_GROUP }}」
        </span>
        <BaseButton native-type="submit" size="sm" data-testid="link-add-submit">添加</BaseButton>
      </div>
    </form>
  </section>
</template>
