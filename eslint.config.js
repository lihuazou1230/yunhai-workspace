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
  prettier,
)
