import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'src/components.d.ts',
      'src/auto-imports.d.ts',
      // 桌面壳的构建产物（cargo 输出里带着 Tauri 生成的 JS 胶水文件）与生成的 schema
      // 都在 .gitignore 里，也不该被前端 lint 扫到
      'src-tauri/target/**',
      'src-tauri/gen/**',
      // 部署打包的暂存目录（里面是整份压缩后的 dist 产物）：
      // git 已用 .gitignore 忽略 /build/，ESLint 也要忽略，
      // 否则 `pnpm lint` 会对压缩 JS 报出几千条 no-unused-expressions，
      // 把真正的代码问题淹掉（实测：漏了这一行会红 5821 条）。
      'build/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
  },
  {
    files: ['**/*.{ts,vue}'],
    rules: {
      // DOM 全局由 TypeScript lib.dom 负责，禁用 no-undef
      'no-undef': 'off',
      // 页面/根组件使用单英文单词命名（如 App、Dashboard、Settings）
      'vue/multi-word-component-names': 'off',
      // 下划线前缀 = 「故意不用」：用于解构剔除字段（const { archived: _a, ...rest } = todo）
      // 与忽略回调参数等场景，是 TS 里表达「这个值我确实不需要」的通行写法
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Node 侧脚本（构建/打包工具）：全局是 node:fs / node:path 这些，与浏览器代码不同
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'writable',
      },
    },
  },
  prettier,
)
