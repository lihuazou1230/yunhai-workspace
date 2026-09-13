/**
 * 壁纸相关的纯函数工具
 *
 * 只做「配置 -> CSS 声明」的纯转换与上传前置校验：不碰 DOM、不碰 IndexedDB、不碰网络。
 * 好处是样式规则可以直接单测——真实背景（IndexedDB 里的 blob + objectURL）在 happy-dom 里跑不起来，
 * 但「哪种 kind 该产出哪些 CSS 声明」「空地址绝不能拼出 url(undefined)」这些恰恰是最容易出错的地方。
 */

// 体积文案复用头像那边的 formatBytes：它本来就是个通用工具（只是当年跟着头像一起落的户），
// 再抄一份就会出现「同一个 8MB，头像提示 8.00 MB、壁纸提示 8.0 MB」这种前后不一致。
import { formatBytes } from '@/utils/avatarImage'

/** 壁纸类型：关闭 / 纯色 / 渐变 / 本地图片 */
export type WallpaperKind = 'none' | 'solid' | 'gradient' | 'image'

/** 壁纸配置（可整份序列化进 localStorage，所以这里不存图片本体，只存地址/键） */
export interface WallpaperConfig {
  kind: WallpaperKind
  /** solid 用 */
  color: string
  /** gradient 用（CSS 渐变串） */
  gradient: string
  /** image 用：IndexedDB 里的键（本机离线副本） */
  imageKey?: string
  /**
   * image 用：云端公开地址（Supabase Storage，第九阶段）。
   * 与 imageKey 是**两条来源**，不是互斥：登录后地址跟着账号走，
   * 未登录/离线时靠本机 blob。展示优先用地址（任意设备都成立）。
   */
  imageUrl?: string
}

/** 单个预设色块/渐变（label 只用于无障碍与 tooltip） */
export interface WallpaperPreset {
  label: string
  value: string
}

/**
 * 纯色预设：克制的 slate / emerald 系浅色底。
 * 壁纸是整页背景，卡片、文字都压在上面，所以只用高明度低饱和的色，
 * 避免深色底把卡片对比度打乱（深色由主题的 dark 模式负责，不靠壁纸）。
 */
export const SOLID_PRESETS: WallpaperPreset[] = [
  { label: '石板灰', value: '#f8fafc' },
  { label: '云雾白', value: '#f1f5f9' },
  { label: '浅岩灰', value: '#e2e8f0' },
  { label: '薄荷白', value: '#ecfdf5' },
  { label: '翡翠浅', value: '#d1fae5' },
  { label: '青瓷', value: '#f0fdfa' },
  { label: '暖沙', value: '#fafaf9' },
  { label: '淡石色', value: '#f5f5f4' },
  { label: '浅湖蓝', value: '#f0f9ff' },
]

/** 渐变预设：值必须是**完整 CSS 串**（可直接绑到 backgroundImage），同样走浅色低饱和。 */
export const GRADIENT_PRESETS: WallpaperPreset[] = [
  { label: '晨雾', value: 'linear-gradient(160deg, #f8fafc 0%, #e2e8f0 100%)' },
  { label: '薄荷青', value: 'linear-gradient(160deg, #ecfdf5 0%, #d1fae5 100%)' },
  { label: '湖光', value: 'linear-gradient(200deg, #f0f9ff 0%, #e0f2fe 100%)' },
  { label: '青瓷雨', value: 'linear-gradient(180deg, #f0fdfa 0%, #ccfbf1 100%)' },
  { label: '暖沙丘', value: 'linear-gradient(180deg, #fafaf9 0%, #e7e5e4 100%)' },
  { label: '暮色藤', value: 'linear-gradient(180deg, #faf5ff 0%, #f3e8ff 100%)' },
  { label: '松间照', value: 'linear-gradient(135deg, #f8fafc 0%, #ecfdf5 50%, #d1fae5 100%)' },
  { label: '远山黛', value: 'linear-gradient(135deg, #f1f5f9 0%, #e0e7ff 100%)' },
]

/** 默认壁纸：关闭，但预置一组可用的纯色/渐变（用户切到 solid/gradient 时立刻有东西可看） */
export const DEFAULT_WALLPAPER: WallpaperConfig = {
  kind: 'none',
  color: SOLID_PRESETS[0].value,
  gradient: GRADIENT_PRESETS[0].value,
}

/** 允许的图片 MIME 白名单（统一小写比较） */
export const WALLPAPER_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const

/** 壁纸上限 8MB：整页背景图比头像大得多，但再大就该让用户先压一下了 */
export const WALLPAPER_MAX_BYTES = 8 * 1024 * 1024

/** 文件对象的最小子集（`File`/`Blob` 都满足该结构；脏数据也可直接传入） */
export interface WallpaperFileLike {
  type?: string
  size?: number
}

/** 校验结果：成功时**没有** error 字段，界面可直接按 ok 分支使用 */
export type WallpaperFileCheck = { ok: true } | { ok: false; error: string }

/**
 * 上传前置校验：MIME 白名单 + 体积 (0, 8MB]。
 * 浏览器端先拦一道，避免把一个 30MB 的原图塞进 IndexedDB——写进去容易，删起来用户是找不到入口的。
 *
 * `type`/`size` 一律当脏数据看：`File` 的 type 可能是空串（部分系统认不出扩展名），
 * size 可能是 NaN，甚至整个对象是 undefined。所以这里只做防御式判断，任何情况都不抛异常——
 * 校验函数本身抛错会把「传个文件」这种日常操作变成白屏。
 */
export function isValidImageFile(file: WallpaperFileLike | null | undefined): WallpaperFileCheck {
  const type = (file?.type ?? '').trim().toLowerCase()
  if (!(WALLPAPER_ALLOWED_TYPES as readonly string[]).includes(type)) {
    return {
      ok: false,
      error: `仅支持 JPG / PNG / WebP / AVIF 格式（当前：${type || '未知格式'}）`,
    }
  }

  const size = typeof file?.size === 'number' && Number.isFinite(file.size) ? file.size : 0
  if (size <= 0) return { ok: false, error: '图片内容为空，请重新选择' }
  if (size > WALLPAPER_MAX_BYTES) {
    return {
      ok: false,
      error: `图片不能超过 ${formatBytes(WALLPAPER_MAX_BYTES)}（当前 ${formatBytes(size)}）`,
    }
  }

  return { ok: true }
}

/**
 * 配置 -> 要绑到容器上的 CSS 声明（Vue `:style` 的 camelCase 形态）。
 *
 * 三种背景都带 `backgroundAttachment: 'fixed'`：仪表板/设置页是可以滚动很长的页面，
 * 默认的 scroll 会让壁纸跟着内容一起走、并在内容超出一屏时平铺重复——看起来像「贴了张图」；
 * fixed 让壁纸贴在视口上，滚动时内容从壁纸上滑过，才是「壁纸」该有的观感。
 *
 * @param imageUrl 本地图片的 objectURL（只有 image 类型用得上）
 */
export function wallpaperStyle(
  config: WallpaperConfig,
  imageUrl?: string | null,
): Record<string, string> {
  const attachment = { backgroundAttachment: 'fixed' }

  switch (config.kind) {
    case 'solid':
      return { backgroundColor: config.color, ...attachment }
    case 'gradient':
      return { backgroundImage: config.gradient, ...attachment }
    case 'image':
      // 图片还没恢复/已被删时按「没有壁纸」处理：绝不能退化成 url(undefined)，
      // 那会让浏览器去请求一个不存在的地址并留下一条无意义的 404
      if (!imageUrl) return {}
      return {
        backgroundImage: `url(${imageUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        ...attachment,
      }
    case 'none':
    default:
      return {}
  }
}
