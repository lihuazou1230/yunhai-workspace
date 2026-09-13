/**
 * 用户上传的图片 Storage API（Supabase Storage · `user-assets` bucket，第九阶段）
 *
 * 用途：壁纸这类「二进制大对象」也要跟账号走。做法与头像一致：
 * - 公开读（bucket public）：壁纸要以 `background-image: url(...)` 直接引用，
 *   私有桶得每次生成签名 URL（会过期、要刷新）——复杂度不值当
 * - 仅本人可写：路径第一段必须是自己的 user_id，RLS 按 `storage.foldername(name)[1]` 校验
 * - **路径带时间戳**（与头像的固定路径不同）：换图就是新地址，天然绕开浏览器与 CDN 缓存，
 *   不需要像头像那样再挂一个 `?v=` 版本号
 */

import { SUPABASE_BUCKETS, requireSupabaseClient } from './supabase'

/** 允许上传的资源名（收敛成白名单，避免路径拼接被注入奇怪字符） */
export type UserAssetName = 'wallpaper'

/** 由 MIME 推断扩展名（只处理白名单里的图片类型，其余回落 jpg） */
export function assetExtensionFromType(type: string): string {
  switch ((type || '').toLowerCase()) {
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/avif':
      return 'avif'
    case 'image/jpeg':
    default:
      return 'jpg'
  }
}

/** 云端对象路径：`<userId>/<name>-<时间戳>.<ext>` */
export function userAssetPath(
  userId: string,
  name: UserAssetName,
  extension: string,
  stamp: number,
): string {
  return `${userId}/${name}-${stamp}.${extension}`
}

/**
 * 上传一张图片，返回可直接引用的公开地址。
 * @param type 原文件的 MIME（决定扩展名；Storage 会保留 contentType）
 */
export async function uploadUserAsset(
  userId: string,
  name: UserAssetName,
  blob: Blob,
  options: { stamp?: number } = {},
): Promise<string> {
  const client = requireSupabaseClient()
  const stamp = options.stamp ?? Date.now()
  const path = userAssetPath(userId, name, assetExtensionFromType(blob.type), stamp)

  const { error } = await client.storage.from(SUPABASE_BUCKETS.userAssets).upload(path, blob, {
    upsert: true,
    contentType: blob.type || 'image/jpeg',
    // 路径本身带时间戳，可以放心长缓存（换图即换地址）
    cacheControl: '31536000',
  })
  if (error) throw error

  const { data } = client.storage.from(SUPABASE_BUCKETS.userAssets).getPublicUrl(path)
  return data.publicUrl
}

/**
 * 删除自己目录下的某个对象。
 * @param url 公开地址（从里面反解出对象路径）；不是本人目录或解析不出来时**直接跳过**，
 *   避免把「删除失败」变成一个会中断壁纸更换流程的异常
 */
export async function removeUserAssetByUrl(userId: string, url: string): Promise<boolean> {
  const path = userAssetPathFromUrl(url)
  if (!path || !path.startsWith(`${userId}/`)) return false

  const client = requireSupabaseClient()
  const { error } = await client.storage.from(SUPABASE_BUCKETS.userAssets).remove([path])
  if (error) throw error
  return true
}

/**
 * 从公开地址里解出对象路径。
 * 地址形如 `https://<ref>.supabase.co/storage/v1/object/public/user-assets/<userId>/<file>`
 * （也兼容签名地址 `.../object/sign/user-assets/...`）。
 */
export function userAssetPathFromUrl(url: string): string | null {
  if (typeof url !== 'string' || url === '') return null
  const marker = `/${SUPABASE_BUCKETS.userAssets}/`
  const index = url.indexOf(marker)
  if (index < 0) return null
  const rest = url.slice(index + marker.length).split('?')[0]
  return rest === '' ? null : decodeURIComponent(rest)
}
