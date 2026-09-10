import { describe, expect, it } from 'vitest'

import {
  DEFAULT_WALLPAPER,
  GRADIENT_PRESETS,
  SOLID_PRESETS,
  WALLPAPER_MAX_BYTES,
  isValidImageFile,
  wallpaperStyle,
} from './wallpaper'
import type { WallpaperConfig, WallpaperFileLike } from './wallpaper'

const MB = 1024 * 1024

const BASE: WallpaperConfig = {
  kind: 'none',
  color: '#f8fafc',
  gradient: 'linear-gradient(160deg, #f8fafc 0%, #e2e8f0 100%)',
}

/** 断言被拒绝并拿到中文错误信息（避免每条用例都写一遍类型收窄） */
function rejectionOf(file: WallpaperFileLike | null | undefined): string {
  const result = isValidImageFile(file)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('预期被拒绝，实际通过了校验')
  return result.error
}

describe('wallpaperStyle', () => {
  it('none：不产生任何声明', () => {
    expect(wallpaperStyle({ ...BASE, kind: 'none' })).toEqual({})
  })

  it('solid：只设背景色，并随视口固定', () => {
    expect(wallpaperStyle({ ...BASE, kind: 'solid', color: '#d1fae5' })).toEqual({
      backgroundColor: '#d1fae5',
      backgroundAttachment: 'fixed',
    })
  })

  it('gradient：把整串 CSS 渐变交给 backgroundImage，并随视口固定', () => {
    expect(wallpaperStyle({ ...BASE, kind: 'gradient' })).toEqual({
      backgroundImage: BASE.gradient,
      backgroundAttachment: 'fixed',
    })
  })

  it('image：url + cover + center，并随视口固定', () => {
    expect(wallpaperStyle({ ...BASE, kind: 'image' }, 'blob:mock-1')).toEqual({
      backgroundImage: 'url(blob:mock-1)',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundAttachment: 'fixed',
    })
  })

  it('image 但地址为空：回落空对象，绝不产出 url(undefined)', () => {
    const config = { ...BASE, kind: 'image' as const }

    expect(wallpaperStyle(config)).toEqual({})
    expect(wallpaperStyle(config, null)).toEqual({})
    expect(wallpaperStyle(config, '')).toEqual({})
    // 整串序列化里不能出现 undefined，否则浏览器会去请求一个假地址
    expect(JSON.stringify(wallpaperStyle(config))).not.toContain('undefined')
  })

  it('none 不理会传入的图片地址', () => {
    expect(wallpaperStyle({ ...BASE, kind: 'none' }, 'blob:mock-1')).toEqual({})
  })
})

describe('预设', () => {
  it('纯色预设：至少 6 个，label 非空且值以 # 开头', () => {
    expect(SOLID_PRESETS.length).toBeGreaterThanOrEqual(6)
    for (const preset of SOLID_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0)
      expect(preset.value.startsWith('#')).toBe(true)
    }
  })

  it('渐变预设：至少 6 个，值是完整 CSS 串', () => {
    expect(GRADIENT_PRESETS.length).toBeGreaterThanOrEqual(6)
    for (const preset of GRADIENT_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0)
      expect(preset.value.startsWith('linear-gradient(')).toBe(true)
      expect(preset.value.endsWith(')')).toBe(true)
    }
  })

  it('默认壁纸是「关闭」，但已带上可用的纯色与渐变', () => {
    expect(DEFAULT_WALLPAPER.kind).toBe('none')
    expect(SOLID_PRESETS.some((preset) => preset.value === DEFAULT_WALLPAPER.color)).toBe(true)
    expect(GRADIENT_PRESETS.some((preset) => preset.value === DEFAULT_WALLPAPER.gradient)).toBe(
      true,
    )
    // 关闭状态下不该产出任何样式
    expect(wallpaperStyle(DEFAULT_WALLPAPER)).toEqual({})
  })
})

describe('isValidImageFile', () => {
  it('接受白名单内的四种格式', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) {
      expect(isValidImageFile({ type, size: 1024 })).toEqual({ ok: true })
    }
  })

  it('类型大小写不敏感', () => {
    expect(isValidImageFile({ type: 'IMAGE/PNG', size: 1024 }).ok).toBe(true)
    expect(isValidImageFile({ type: ' Image/WebP ', size: 1024 }).ok).toBe(true)
  })

  it('拒绝白名单外的类型，并报出当前格式', () => {
    expect(rejectionOf({ type: 'image/gif', size: 1024 })).toBe(
      '仅支持 JPG / PNG / WebP / AVIF 格式（当前：image/gif）',
    )
    expect(rejectionOf({ type: 'application/pdf', size: 1024 })).toContain('application/pdf')
  })

  it('type 为空的脏数据报「未知格式」而不是空括号', () => {
    expect(rejectionOf({ type: '', size: 1024 })).toContain('未知格式')
  })

  it('刚好 8MB 通过（边界包含）', () => {
    expect(isValidImageFile({ type: 'image/png', size: WALLPAPER_MAX_BYTES })).toEqual({ ok: true })
    expect(isValidImageFile({ type: 'image/avif', size: 8 * MB })).toEqual({ ok: true })
  })

  it('8MB 多 1 字节即被拒', () => {
    expect(isValidImageFile({ type: 'image/png', size: WALLPAPER_MAX_BYTES + 1 }).ok).toBe(false)
  })

  it('超限文案同时给出上限与实际体积', () => {
    expect(rejectionOf({ type: 'image/jpeg', size: 9 * MB })).toBe(
      '图片不能超过 8.00 MB（当前 9.00 MB）',
    )
  })

  it('体积为 0 视为空文件', () => {
    expect(rejectionOf({ type: 'image/png', size: 0 })).toBe('图片内容为空，请重新选择')
  })

  it('脏数据一律不抛异常，按不合法处理', () => {
    const dirty: Array<WallpaperFileLike | null | undefined> = [
      undefined,
      null,
      {},
      { type: 'image/png' },
      { type: 'image/png', size: Number.NaN },
      { type: 'image/png', size: -1 },
      { type: undefined, size: undefined },
    ]

    for (const file of dirty) {
      expect(() => isValidImageFile(file)).not.toThrow()
      expect(isValidImageFile(file).ok).toBe(false)
    }
  })
})
