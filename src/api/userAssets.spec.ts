import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SupabaseUnavailableError } from './supabase'

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('./supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./supabase')>()
  return {
    ...actual,
    requireSupabaseClient: () => {
      if (!holder.client) throw new actual.SupabaseUnavailableError()
      return holder.client
    },
  }
})

import {
  assetExtensionFromType,
  removeUserAssetByUrl,
  uploadUserAsset,
  userAssetPath,
  userAssetPathFromUrl,
} from './userAssets'

/** 带 storage 的客户端桩（getPublicUrl 按真实形态由路径拼出地址） */
function storageClient(
  options: { uploadError?: unknown; removeError?: unknown; publicUrl?: string } = {},
) {
  const upload = vi.fn(async () => ({ error: options.uploadError ?? null }))
  const remove = vi.fn(async () => ({ error: options.removeError ?? null }))
  const base = 'https://x.supabase.co/storage/v1/object/public/user-assets/'
  const getPublicUrl = vi.fn((path: string) => ({
    data: { publicUrl: options.publicUrl ?? `${base}${path}` },
  }))
  const from = vi.fn(() => ({ upload, remove, getPublicUrl }))
  return { client: { storage: { from } }, from, upload, remove, getPublicUrl }
}

beforeEach(() => {
  holder.client = null
})

describe('资源名与路径', () => {
  it('按 MIME 推扩展名（未知类型回落 jpg）', () => {
    expect(assetExtensionFromType('image/png')).toBe('png')
    expect(assetExtensionFromType('image/WebP')).toBe('webp')
    expect(assetExtensionFromType('image/avif')).toBe('avif')
    expect(assetExtensionFromType('image/jpeg')).toBe('jpg')
    expect(assetExtensionFromType('')).toBe('jpg')
    expect(assetExtensionFromType('application/zip')).toBe('jpg')
  })

  it('路径第一段必须是 user_id（与 Storage RLS 策略一一对应）', () => {
    expect(userAssetPath('u1', 'wallpaper', 'webp', 1700000000000)).toBe(
      'u1/wallpaper-1700000000000.webp',
    )
  })

  it('从公开地址反解对象路径（带签名地址与编码也认）', () => {
    expect(
      userAssetPathFromUrl(
        'https://x.supabase.co/storage/v1/object/public/user-assets/u1/wallpaper-1.jpg',
      ),
    ).toBe('u1/wallpaper-1.jpg')
    expect(
      userAssetPathFromUrl(
        'https://x.supabase.co/storage/v1/object/sign/user-assets/u1/图%20片.webp?token=abc',
      ),
    ).toBe('u1/图 片.webp')
    expect(
      userAssetPathFromUrl('https://x.supabase.co/storage/v1/object/public/user-assets/'),
    ).toBeNull()
    expect(userAssetPathFromUrl('https://example.com/other/u1/a.jpg')).toBeNull()
    expect(userAssetPathFromUrl('')).toBeNull()
  })
})

describe('uploadUserAsset', () => {
  it('上传成功后返回带时间戳路径的公开地址', async () => {
    const stub = storageClient()
    holder.client = stub.client

    const url = await uploadUserAsset('u1', 'wallpaper', new Blob(['x'], { type: 'image/webp' }), {
      stamp: 123,
    })
    expect(url).toBe(
      'https://x.supabase.co/storage/v1/object/public/user-assets/u1/wallpaper-123.webp',
    )
    expect(stub.getPublicUrl).toHaveBeenCalledWith('u1/wallpaper-123.webp')
    expect(stub.from).toHaveBeenCalledWith('user-assets')
    expect(stub.upload).toHaveBeenCalledWith(
      'u1/wallpaper-123.webp',
      expect.any(Blob),
      expect.objectContaining({ upsert: true, contentType: 'image/webp' }),
    )
  })

  it('没有 MIME 时按 jpg + image/jpeg 兜底（部分系统认不出扩展名）', async () => {
    const stub = storageClient()
    holder.client = stub.client

    await uploadUserAsset('u1', 'wallpaper', new Blob(['x']), { stamp: 9 })
    expect(stub.upload).toHaveBeenCalledWith(
      'u1/wallpaper-9.jpg',
      expect.any(Blob),
      expect.objectContaining({ contentType: 'image/jpeg' }),
    )
  })

  it('上传失败时抛出（由 store 降级：本机壁纸照常生效，只是不上云）', async () => {
    holder.client = storageClient({ uploadError: { message: 'quota' } }).client
    await expect(
      uploadUserAsset('u1', 'wallpaper', new Blob(['x'], { type: 'image/png' })),
    ).rejects.toEqual({
      message: 'quota',
    })
  })

  it('未配置 Supabase 时抛 SupabaseUnavailableError', async () => {
    await expect(uploadUserAsset('u1', 'wallpaper', new Blob(['x']))).rejects.toBeInstanceOf(
      SupabaseUnavailableError,
    )
  })
})

describe('removeUserAssetByUrl', () => {
  it('删自己目录下的对象并返回 true', async () => {
    const stub = storageClient()
    holder.client = stub.client

    const ok = await removeUserAssetByUrl(
      'u1',
      'https://x.supabase.co/storage/v1/object/public/user-assets/u1/wallpaper-1.jpg',
    )
    expect(ok).toBe(true)
    expect(stub.remove).toHaveBeenCalledWith(['u1/wallpaper-1.jpg'])
  })

  it('不是本人目录 / 地址解析不出来时直接跳过（不抛，也不误删）', async () => {
    const stub = storageClient()
    holder.client = stub.client

    expect(
      await removeUserAssetByUrl(
        'u1',
        'https://x.supabase.co/storage/v1/object/public/user-assets/u2/a.jpg',
      ),
    ).toBe(false)
    expect(await removeUserAssetByUrl('u1', 'not-a-url')).toBe(false)
    expect(stub.remove).not.toHaveBeenCalled()
  })

  it('删除报错时抛出', async () => {
    holder.client = storageClient({ removeError: { message: 'denied' } }).client
    await expect(
      removeUserAssetByUrl(
        'u1',
        'https://x.supabase.co/storage/v1/object/public/user-assets/u1/a.jpg',
      ),
    ).rejects.toEqual({ message: 'denied' })
  })
})
