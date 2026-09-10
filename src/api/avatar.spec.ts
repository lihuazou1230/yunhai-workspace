import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SupabaseUnavailableError } from './supabase'

/** 把 supabase 客户端换成 Storage 桩 */
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

import { removeAvatarObject, uploadAvatar } from './avatar'

function storageStub(overrides: Record<string, unknown> = {}) {
  const storage = {
    upload: vi.fn(async () => ({ data: { path: 'u1/avatar.webp' }, error: null as unknown })),
    remove: vi.fn(async () => ({ data: [], error: null as unknown })),
    getPublicUrl: vi.fn(() => ({
      data: {
        publicUrl: 'https://demo.supabase.co/storage/v1/object/public/avatars/u1/avatar.webp',
      },
    })),
  }
  Object.assign(storage, overrides)
  const from = vi.fn<(bucket: string) => typeof storage>()
  from.mockReturnValue(storage)
  return {
    client: { storage: { from } },
    from,
    upload: storage.upload,
    remove: storage.remove,
    getPublicUrl: storage.getPublicUrl,
  }
}

describe('头像 Storage API', () => {
  beforeEach(() => {
    holder.client = null
  })

  it('上传：固定路径覆盖上传、声明 webp、返回带版本号的公开地址', async () => {
    const stub = storageStub()
    holder.client = stub.client

    const url = await uploadAvatar('u1', new Blob(['x'], { type: 'image/webp' }))

    expect(stub.upload).toHaveBeenCalledTimes(1)
    expect(stub.from).toHaveBeenCalledWith('avatars')
    const [path, , options] = stub.upload.mock.calls[0] as unknown as [
      string,
      Blob,
      Record<string, unknown>,
    ]
    expect(path).toBe('u1/avatar.webp')
    expect(options).toMatchObject({ upsert: true, contentType: 'image/webp' })
    expect(url).toContain('/avatars/u1/avatar.webp')
    // 版本号用于避免 CDN 继续返回旧头像
    expect(url).toMatch(/\?v=\d+/)
  })

  it('上传失败时抛出错误（由组件提示用户）', async () => {
    const stub = storageStub({
      upload: vi.fn(async () => ({ data: null, error: { message: 'bucket not found' } })),
    })
    holder.client = stub.client

    await expect(uploadAvatar('u1', new Blob(['x']))).rejects.toMatchObject({
      message: 'bucket not found',
    })
  })

  it('移除：只删自己目录下的那个对象', async () => {
    const stub = storageStub()
    holder.client = stub.client

    await removeAvatarObject('u1')
    expect(stub.remove).toHaveBeenCalledWith(['u1/avatar.webp'])
  })

  it('移除失败（RLS 拒绝 / 网络问题）时抛错，由调用方提示用户', async () => {
    // 静默吞掉这个错误会让用户以为「头像已移除」，但刷新后又回来了
    const stub = storageStub({
      remove: vi.fn(async () => ({ data: null, error: { message: 'permission denied' } })),
    })
    holder.client = stub.client

    await expect(removeAvatarObject('u1')).rejects.toMatchObject({ message: 'permission denied' })
  })

  it('未配置 Supabase 时抛出引导错误', async () => {
    await expect(uploadAvatar('u1', new Blob(['x']))).rejects.toBeInstanceOf(
      SupabaseUnavailableError,
    )
    await expect(removeAvatarObject('u1')).rejects.toBeInstanceOf(SupabaseUnavailableError)
  })
})
