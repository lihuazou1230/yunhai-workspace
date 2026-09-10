/**
 * 壁纸状态（Pinia）：纯色 / 渐变 / 本地上传图片，作为仪表板的整页背景。
 *
 * 分两层存，各自放在合适的地方：
 * - 配置（kind/color/gradient/imageKey）很小、改得勤，走 localStorage（useLocalStorage 自动落盘）
 * - 图片本体是二进制大对象，走 IndexedDB（见 useIndexedDb），用时才生成本次会话的 objectURL
 */

import { computed, ref } from 'vue'

import { defineStore } from 'pinia'

import { useLocalStorage } from '@/composables/useLocalStorage'
import { deleteBlob, getBlob, putBlob } from '@/composables/useIndexedDb'
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
  const config = useLocalStorage<WallpaperConfig>(WALLPAPER_STORAGE_KEY, { ...DEFAULT_WALLPAPER })

  /** 本地图片的 objectURL（仅本次会话有效，刷新后由 init 重新生成） */
  const imageUrl = ref<string | null>(null)
  /** 是否已经尝试从 IndexedDB 读过一次 */
  let restored = false
  /** 上一个 objectURL，替换时释放，避免内存泄漏 */
  let lastObjectUrl = ''

  function setObjectUrl(url: string) {
    if (lastObjectUrl && lastObjectUrl !== url) URL.revokeObjectURL(lastObjectUrl)
    lastObjectUrl = url
    imageUrl.value = url || null
  }

  // ---- getters ----
  /** 是否有生效的壁纸（none 时容器不必加背景层） */
  const isActive = computed<boolean>(() => config.value.kind !== 'none')

  /**
   * 直接绑到容器上的 CSS 声明。
   * 给设置页预览和仪表板共用：各处理解「image 但图还没恢复」这种中间态，
   * 迟早会有一处拼出 url(undefined)——统一从这里出，规则只有一份。
   */
  const style = computed<Record<string, string>>(() => wallpaperStyle(config.value, imageUrl.value))

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
   */
  async function saveImage(file: Blob): Promise<WallpaperSaveResult> {
    const checked = isValidImageFile({ type: file.type, size: file.size })
    if (!checked.ok) return { ok: false, error: checked.error }

    await putBlob(WALLPAPER_IMAGE_KEY, file)
    setObjectUrl(URL.createObjectURL(file))
    config.value.imageKey = WALLPAPER_IMAGE_KEY
    config.value.kind = 'image'
    return { ok: true }
  }

  /** 移除本地图片：删 blob + 释放 objectURL + 回落 none（配置里也不该再指着一个已删的键） */
  async function removeImage(): Promise<void> {
    await deleteBlob(WALLPAPER_IMAGE_KEY)
    setObjectUrl('')
    config.value.imageKey = undefined
    config.value.kind = 'none'
  }

  /**
   * 从 IndexedDB 恢复上次存的图片。
   * 不管当前 kind 是什么都尝试恢复：用户切回「本地图片」时该立刻见到图，
   * 而不是先白一下再出现（配置与图片是分开存的，两者不一定同时存在）。
   * 已经恢复过就不再生成，避免每次进设置页都多造一个 objectURL。
   */
  async function init(): Promise<void> {
    if (restored || imageUrl.value) return
    restored = true

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
