<script setup lang="ts">
/**
 * 原子组件：界面图标（自绘 SVG，一套笔触）
 *
 * 为什么不用 emoji 当图标（这是最容易被眼睛抓到、也最难自查的一类「拼凑感」）：
 * 1. **字形由字体提供方决定**：同样是 🚪，Windows 上是纯色橙色方块、苹果上是拟物木门、
 *    安卓上又是第三个样子——它不受我们的设计控制
 * 2. **不跟 `currentColor`**：彩色 emoji 无法随主题色/深浅模式变化，
 *    所以激活态、悬停态只能改文字，图标本身永远不变（侧边栏尤其明显）
 * 3. **基线与视觉重量对不齐**：emoji 自带内边距且各字不一，和相邻的 1.6px 描边图标混排时
 *    大小、粗细、垂直位置都会差一点，正好是「差一点」最刺眼
 *
 * 这里统一 24 视窗、1.6px 描边、圆角端点、`fill: none`，尺寸由 `size` 传入（默认 20px）。
 */

withDefaults(
  defineProps<{
    name:
      | 'home'
      | 'check-square'
      | 'chart'
      | 'settings'
      | 'bell'
      | 'log-out'
      | 'help'
      | 'chevron-left'
      | 'chevron-right'
      | 'pencil'
    /** 尺寸类（默认 20px） */
    size?: string
  }>(),
  { size: 'h-5 w-5' },
)
</script>

<template>
  <svg
    :class="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <!-- 仪表板：房子 -->
    <template v-if="name === 'home'">
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.8V19a1 1 0 0 0 1 1h3.2v-4.6a1.8 1.8 0 0 1 3.6 0V20H17a1 1 0 0 0 1-1V9.8" />
    </template>

    <!-- 任务：方框 + 勾 -->
    <template v-else-if="name === 'check-square'">
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M8.4 12.2l2.5 2.5 4.7-5" />
    </template>

    <!-- 统计：柱状图 -->
    <template v-else-if="name === 'chart'">
      <path d="M4 20h16" />
      <path d="M7 20v-6.5" />
      <path d="M12 20V8.5" />
      <path d="M17 20v-9.5" />
    </template>

    <!-- 设置：齿轮（简化 8 齿，小尺寸下不糊成一团） -->
    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 3.2v2.1M12 18.7v2.1M4.8 4.8l1.5 1.5M17.7 17.7l1.5 1.5M3.2 12h2.1M18.7 12h2.1M4.8 19.2l1.5-1.5M17.7 6.3l1.5-1.5"
      />
    </template>

    <!-- 提醒：铃铛 + 铃舌（比 emoji 更克制的轮廓，20px 下仍读得出是铃） -->
    <template v-else-if="name === 'bell'">
      <path
        d="M6 9.5a6 6 0 1 1 12 0c0 2.6.5 4.2 1 5.2.3.6-.1 1.3-.8 1.3H5.8c-.7 0-1.1-.7-.8-1.3.5-1 1-2.6 1-5.2Z"
      />
      <path d="M10.2 19.2a2 2 0 0 0 3.6 0" />
    </template>

    <!-- 退出登录：门 + 向外箭头 -->
    <template v-else-if="name === 'log-out'">
      <path d="M14.5 4.5H6.2A1.7 1.7 0 0 0 4.5 6.2v11.6a1.7 1.7 0 0 0 1.7 1.7h8.3" />
      <path d="M15.5 8.5 19 12l-3.5 3.5" />
      <path d="M19 12h-8" />
    </template>

    <!-- 帮助：问号圆环 -->
    <template v-else-if="name === 'help'">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.6a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.4v.4" />
      <path d="M12 16.8h.01" />
    </template>

    <!-- 收起 / 展开：chevron（替代 « » —— CJK 字体里它们是全角字形，单放会像错位的标点） -->
    <template v-else-if="name === 'chevron-left'">
      <path d="M14 6l-6 6 6 6" />
    </template>
    <template v-else-if="name === 'chevron-right'">
      <path d="M10 6l6 6-6 6" />
    </template>

    <!-- 编辑布局：铅笔 -->
    <template v-else>
      <path d="M4 20h4.2L19 9.2a2 2 0 0 0 0-2.8l-1.4-1.4a2 2 0 0 0-2.8 0L4 15.8V20Z" />
      <path d="M14.2 6.4l3.4 3.4" />
    </template>
  </svg>
</template>
