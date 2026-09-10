import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import { GRADIENT_PRESETS, SOLID_PRESETS } from '@/utils/wallpaper'
import { deleteBlob, getBlob, putBlob } from '@/composables/useIndexedDb'
import { WALLPAPER_IMAGE_KEY, useWallpaperStore } from './wallpaperStore'

/** happy-dom 的 objectURL 支持不完整，这里统一打桩 */
function stubObjectUrl() {
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:raw' })
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })
  }
  let seq = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-${++seq}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
}

/** 等 useLocalStorage 的 deep watch 落盘（默认 pre flush，跑在微任务里） */
async function flush() {
  await nextTick()
  await Promise.resolve()
}

describe('wallpaperStore', () => {
  beforeEach(async () => {
    localStorage.clear()
    setActivePinia(createPinia())
    await deleteBlob(WALLPAPER_IMAGE_KEY)
    stubObjectUrl()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('默认配置：关闭壁纸、没有图片、样式为空', () => {
    const store = useWallpaperStore()

    expect(store.config.kind).toBe('none')
    expect(store.isActive).toBe(false)
    expect(store.imageUrl).toBeNull()
    expect(store.style).toEqual({})
  })

  it('setKind 切换类型并影响 isActive', () => {
    const store = useWallpaperStore()

    store.setKind('image')
    expect(store.config.kind).toBe('image')
    expect(store.isActive).toBe(true)

    store.setKind('none')
    expect(store.isActive).toBe(false)
  })

  it('setSolid：顺带把 kind 切成 solid，样式只含背景色', () => {
    const store = useWallpaperStore()

    store.setSolid(SOLID_PRESETS[3].value)

    expect(store.config.color).toBe(SOLID_PRESETS[3].value)
    expect(store.config.kind).toBe('solid')
    expect(store.isActive).toBe(true)
    expect(store.style).toEqual({
      backgroundColor: SOLID_PRESETS[3].value,
      backgroundAttachment: 'fixed',
    })
  })

  it('setGradient：顺带把 kind 切成 gradient，样式用整串渐变', () => {
    const store = useWallpaperStore()

    store.setGradient(GRADIENT_PRESETS[1].value)

    expect(store.config.gradient).toBe(GRADIENT_PRESETS[1].value)
    expect(store.config.kind).toBe('gradient')
    expect(store.style).toEqual({
      backgroundImage: GRADIENT_PRESETS[1].value,
      backgroundAttachment: 'fixed',
    })
  })

  it('clear：只关闭壁纸，保留 color/gradient 让设置页还能高亮上次的选择', () => {
    const store = useWallpaperStore()
    store.setSolid(SOLID_PRESETS[2].value)
    store.setGradient(GRADIENT_PRESETS[2].value)

    store.clear()

    expect(store.config.kind).toBe('none')
    expect(store.isActive).toBe(false)
    expect(store.style).toEqual({})
    expect(store.config.color).toBe(SOLID_PRESETS[2].value)
    expect(store.config.gradient).toBe(GRADIENT_PRESETS[2].value)
  })

  it('clear 不删图片本体（删图是 removeImage 的职责）', async () => {
    const store = useWallpaperStore()
    await store.saveImage(new Blob(['img'], { type: 'image/png' }))

    store.clear()

    expect(store.config.kind).toBe('none')
    expect(await getBlob(WALLPAPER_IMAGE_KEY)).toBeTruthy()
    // 图片还在，切回 image 立刻可见
    store.setKind('image')
    expect(store.style.backgroundImage).toBe('url(blob:mock-1)')
  })

  it('saveImage 拒绝非白名单类型：不写 IndexedDB、不改配置', async () => {
    const store = useWallpaperStore()
    store.setSolid(SOLID_PRESETS[0].value)

    const result = await store.saveImage(new Blob(['gif'], { type: 'image/gif' }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('预期被拒绝')
    expect(result.error).toContain('仅支持 JPG / PNG / WebP / AVIF')
    expect(result.error).toContain('image/gif')
    expect(await getBlob(WALLPAPER_IMAGE_KEY)).toBeNull()
    expect(store.config.kind).toBe('solid')
    expect(store.imageUrl).toBeNull()
  })

  it('saveImage 拒绝超过 8MB 的图片', async () => {
    const store = useWallpaperStore()
    const big = new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'image/png' })

    const result = await store.saveImage(big)

    expect(result.ok).toBe(false)
    expect(await getBlob(WALLPAPER_IMAGE_KEY)).toBeNull()
    expect(store.config.kind).toBe('none')
  })

  it('saveImage 接受合法 Blob：落 IndexedDB、切到 image、生成 objectURL', async () => {
    const store = useWallpaperStore()
    const blob = new Blob(['img'], { type: 'image/webp' })

    const result = await store.saveImage(blob)

    expect(result).toEqual({ ok: true })
    expect(await getBlob(WALLPAPER_IMAGE_KEY)).toBeTruthy()
    expect(store.config.kind).toBe('image')
    expect(store.config.imageKey).toBe(WALLPAPER_IMAGE_KEY)
    expect(store.imageUrl).toBe('blob:mock-1')
    expect(store.style).toEqual({
      backgroundImage: 'url(blob:mock-1)',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundAttachment: 'fixed',
    })
  })

  it('removeImage：删 blob、释放 objectURL、回落 none', async () => {
    const store = useWallpaperStore()
    await store.saveImage(new Blob(['img'], { type: 'image/png' }))

    await store.removeImage()

    expect(await getBlob(WALLPAPER_IMAGE_KEY)).toBeNull()
    expect(store.imageUrl).toBeNull()
    expect(store.config.kind).toBe('none')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1')
  })

  it('init：从 IndexedDB 恢复图片地址', async () => {
    await putBlob(WALLPAPER_IMAGE_KEY, new Blob(['old'], { type: 'image/png' }))
    const store = useWallpaperStore()

    await store.init()

    expect(store.imageUrl).toBe('blob:mock-1')
  })

  it('init：没有 blob 时是 no-op（不生成多余的 objectURL）', async () => {
    const store = useWallpaperStore()

    await store.init()

    expect(store.imageUrl).toBeNull()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('init：已经恢复过就不再重复生成 objectURL', async () => {
    await putBlob(WALLPAPER_IMAGE_KEY, new Blob(['old'], { type: 'image/png' }))
    const store = useWallpaperStore()

    await store.init()
    await store.init()

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(store.imageUrl).toBe('blob:mock-1')
  })

  it('配置跨 store 实例重建后仍能读回（localStorage 持久化）', async () => {
    const store = useWallpaperStore()
    store.setGradient(GRADIENT_PRESETS[3].value)
    await flush()

    // 模拟刷新页面：新的 pinia + 新的 store 实例
    setActivePinia(createPinia())
    const rebuilt = useWallpaperStore()

    expect(rebuilt.config.kind).toBe('gradient')
    expect(rebuilt.config.gradient).toBe(GRADIENT_PRESETS[3].value)
    expect(rebuilt.isActive).toBe(true)
  })

  it('dispose：释放 objectURL 并清空图片地址', async () => {
    const store = useWallpaperStore()
    await store.saveImage(new Blob(['img'], { type: 'image/png' }))

    store.dispose()

    expect(URL.revokeObjectURL).toHaveBeenCalled()
    expect(store.imageUrl).toBeNull()
    expect(store.style).toEqual({})
  })
})
