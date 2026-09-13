/**
 * 壁纸状态（Pinia）：纯色 / 渐变 / 本地上传图片，作为仪表板的整页背景。
 *
 * 分两层存，各自放在合适的地方（第九阶段又各加了一层云）：
 * - 配置（kind/color/gradient/imageKey/imageUrl）很小、改得勤 → localStorage（同步落盘）+ `user_settings` 云同步
 * - 图片本体是二进制大对象 → IndexedDB 存一份（离线可用），**登录后再传 Supabase Storage**，
 *   这样换设备登录就能直接拉回同一张壁纸
 */

import { computed, ref } from 'vue'

import { defineStore } from 'pinia'

import { isSupabaseConfigured } from '@/api/supabase'
import { removeUserAssetByUrl, uploadUserAsset } from '@/api/userAssets'
import { getBlob, deleteBlob, putBlob } from '@/composables/useIndexedDb'
import { useSyncedStorage } from '@/composables/useSyncedStorage'
import { useAuthStore } from '@/stores/authStore'
import { DEFAULT_WALLPAPER, isValidImageFile, wallpaperStyle } from '@/utils/wallpaper'
import type { WallpaperConfig, WallpaperKind } from '@/utils/wallpaper'

/** 配置的 localStorage 键（沿用 theme 的 smart-workspace: 前缀，便于一起清理） */
export const WALLPAPER_STORAGE_KEY = 'smart-workspace:wallpaper'

/**
 * 图片 blob 在 IndexedDB 里的键。
 * 不复用头像的 `avatar` 键：壁纸是整页大图、头像会被裁剪压缩，两者体积与生命周期都不同，
 * 共用一个键会出现「换壁纸顺手把头像顶掉」——键各自独立，删图/删头像才不会互相误伤。
 */
export const WALLPAPER_IMAGE_KEY = 'wallpaper'

/** 保存图片的结果（成功时无 error 字段，界面按 ok 分支用） */
export type WallpaperSaveResult = { ok: true } | { ok: false; error: string }

export const useWallpaperStore = defineStore('wallpaper', () => {
  const authStore = useAuthStore()
  // 第九阶段：配置跟账号走；图片本体另外传 Storage（见 saveImage / init）
  const config = useSyncedStorage<WallpaperConfig>(WALLPAPER_STORAGE_KEY, { ...DEFAULT_WALLPAPER })

  /** 当前展示用的地址：本机是 objectURL，从云端同步回来的是 Storage 公开地址 */
  const imageUrl = ref<string | null>(null)
  /** 是否已经尝试恢复过一次 */
  let restored = false
  /** 上一个 objectURL，替换时释放，避免内存泄漏（云端 URL 不是 objectURL，不能 revoke） */
  let lastObjectUrl = ''

  function setObjectUrl(url: string) {
    if (lastObjectUrl && lastObjectUrl !== url) URL.revokeObjectURL(lastObjectUrl)
    lastObjectUrl = url.startsWith('blob:') ? url : ''
    imageUrl.value = url || null
  }

  /** 云端地址在配置里，本机地址在 IndexedDB / objectURL 里——谁有就用谁 */
  function resolveImageUrl(): string | null {
    return imageUrl.value ?? config.value.imageUrl ?? null
  }

  // ---- getters ----
  /** 是否有生效的壁纸（none 时容器不必加背景层） */
  const isActive = computed<boolean>(() => config.value.kind !== 'none')

  /**
   * 直接绑到容器上的 CSS 声明。
   * 给设置页预览和仪表板共用：各处理解「image 但图还没恢复」这种中间态，
   * 迟早会有一处拼出 url(undefined)——统一从这里出，规则只有一份。
   */
  const style = computed<Record<string, string>>(() =>
    wallpaperStyle(config.value, resolveImageUrl()),
  )

  // ---- actions ----
  function setKind(kind: WallpaperKind) {
    config.value.kind = kind
  }

  /**
   * 选一个纯色，并顺带把 kind 切成 solid。
   * 取舍：点色块这个动作本身就表达了「我要用它」，还要再点一次「应用」才算数的话，
   * 设置页最常见的反馈就成了「点了没反应」；想撤销就点「关闭壁纸」。
   */
  function setSolid(color: string) {
    config.value.color = color
    config.value.kind = 'solid'
  }

  /** 选一个渐变（同样顺带切 kind，理由见 setSolid） */
  function setGradient(gradient: string) {
    config.value.gradient = gradient
    config.value.kind = 'gradient'
  }

  /**
   * 关闭壁纸（回到 none）。
   * 只改 kind，**不删图片本体、也不清 color/gradient**：
   * 删图是 removeImage 的职责；保留上次的选择，重新打开设置页时才能继续高亮用户原来挑的那块，
   * 否则「关掉再打开」等于把他刚选的颜色偷偷丢了。
   */
  function clear() {
    config.value.kind = 'none'
  }

  /**
   * 保存本地上传的图片。
   * 先校验再落盘：不合法时既不写 IndexedDB 也不改配置——否则会留下一个
   * 「kind 已经是 image、图却没进去」的状态，用户切过去只会看到一片空白。
   *
   * 第九阶段：已登录时**顺带传一份到 Storage**，配置里记下公开地址，
   * 于是换设备登录也能看到同一张壁纸；上传失败不影响本机使用（只会在设置页提示未上云）。
   */
  async function saveImage(file: Blob): Promise<WallpaperSaveResult> {
    const checked = isValidImageFile({ type: file.type, size: file.size })
    if (!checked.ok) return { ok: false, error: checked.error }

    await putBlob(WALLPAPER_IMAGE_KEY, file)
    setObjectUrl(URL.createObjectURL(file))
    config.value.imageKey = WALLPAPER_IMAGE_KEY
    config.value.kind = 'image'

    const userId = authStore.user?.id
    if (userId && isSupabaseConfigured()) {
      const previousUrl = config.value.imageUrl
      try {
        const url = await uploadUserAsset(userId, 'wallpaper', file)
        config.value.imageUrl = url
        // 换了新对象，旧对象留着只会白占额度（删不掉也不算错）
        if (previousUrl && previousUrl !== url) {
          void removeUserAssetByUrl(userId, previousUrl).catch(() => {})
        }
      } catch {
        // 上传失败就是把"换设备也能看到"这条降级掉，本机壁纸照常生效
        config.value.imageUrl = undefined
      }
    }

    return { ok: true }
  }

  /**
   * 移除本地图片：删 blob + 释放 objectURL + 回落 none（配置里也不该再指着一个已删的键）。
   * 云端对象一并删除：用户点的是"移除壁纸"，不是"只在这台设备上隐藏"。
   */
  async function removeImage(): Promise<void> {
    await deleteBlob(WALLPAPER_IMAGE_KEY)
    setObjectUrl('')

    const userId = authStore.user?.id
    const remoteUrl = config.value.imageUrl
    if (userId && remoteUrl && isSupabaseConfigured()) {
      void removeUserAssetByUrl(userId, remoteUrl).catch(() => {})
    }

    config.value.imageKey = undefined
    config.value.imageUrl = undefined
    config.value.kind = 'none'
  }

  /**
   * 恢复上次的图片。
   * 两条来源，优先级：**云端地址**（任意设备都成立）→ 本机 IndexedDB 的 blob（离线/未登录）。
   * 不管当前 kind 是什么都尝试恢复：用户切回「本地图片」时该立刻见到图，
   * 而不是先白一下再出现（配置与图片是分开存的，两者不一定同时存在）。
   */
  async function init(): Promise<void> {
    if (restored) return
    restored = true

    // 云端地址已经在同步回来的配置里了，直接用它（不发请求，浏览器自己走缓存）
    if (config.value.imageUrl) {
      imageUrl.value = config.value.imageUrl
      return
    }
    if (imageUrl.value) return

    const blob = await getBlob(WALLPAPER_IMAGE_KEY)
    if (!blob) return
    // 只生成展示用的 objectURL，不回写配置：刷新页面不该悄悄改写用户的持久化设置
    setObjectUrl(URL.createObjectURL(blob))
  }

  /** 释放 objectURL（组件卸载时调用；下次 init 会重新生成） */
  function dispose() {
    if (lastObjectUrl) {
      URL.revokeObjectURL(lastObjectUrl)
      lastObjectUrl = ''
    }
    imageUrl.value = null
    restored = false
  }

  return {
    config,
    imageUrl,
    isActive,
    style,
    setKind,
    setSolid,
    setGradient,
    clear,
    saveImage,
    removeImage,
    init,
    dispose,
  }
})
