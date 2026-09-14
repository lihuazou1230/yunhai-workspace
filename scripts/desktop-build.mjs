#!/usr/bin/env node
/**
 * 桌面端一键构建 + 同步产物
 *
 * 为什么要有这个脚本：
 * 1. 网页端（Vite/`dist`）和桌面端（Tauri/exe）是两份产物，
 *    改完网页代码必须重新打包桌面端，否则 exe 里跑的还是旧页面。
 *    这里把「构建前端 → 打包 Tauri → 把产物拷到项目根」固定成一条命令。
 * 2. 打包全程要 cargo 在 PATH 里，但本机 cargo 装在 `~/.cargo/bin` 且**不在系统 PATH**
 *    （见 _tauri_build*.log），脚本自己补上，避免每次构建都先失败一次。
 * 3. **exe 正在运行就打包不了**（cargo 删不掉被占用的 target 产物，报
 *    `failed to remove file ... 拒绝访问 (os error 5)`）。脚本先查进程，
 *    要么明确拒绝并让你关掉，要么按 `--kill` 结束它——省掉一次两分钟的无效编译。
 * 4. 产物不再翻 `src-tauri/target/release/bundle/nsis/` 去找，统一落在项目根目录。
 *
 * 用法：
 *   node scripts/desktop-build.mjs                # 只构建（应用在跑就直接拒绝）
 *   node scripts/desktop-build.mjs --verify       # 先跑 typecheck + 单测 + lint，通过才构建
 *   node scripts/desktop-build.mjs --no-frontend  # 跳过 `pnpm build`（前端产物没变时省时间）
 *   node scripts/desktop-build.mjs --kill         # 先结束正在运行的桌面版再构建
 *
 * 产物（拷到 workspace 的上一级，即 C:\Users\asus\Desktop\个人项目）：
 *   云海工作台.exe                      —— 绿色版主程序，双击即用
 *   云海工作台_0.1.0_x64-setup.exe      —— NSIS 安装包（名字跟着 tauri.conf.json）
 *   _desktop_build.log                  —— 完整构建日志（含 cargo 输出，失败先看它）
 */

import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** 产物落地目录：workspace 的上一级（个人项目 文件夹） */
const outputDir = resolve(workspaceRoot, '..')
const logPath = join(outputDir, '_desktop_build.log')
const tauriConfPath = join(workspaceRoot, 'src-tauri', 'tauri.conf.json')
/** cargo 的产物名来自 Cargo.toml 的 crate 名（Rust 侧只能是 ASCII） */
const RUST_BIN_NAME = 'smart-workspace.exe'

const argv = process.argv.slice(2)
const shouldVerify = argv.includes('--verify')
const skipFrontend = argv.includes('--no-frontend')
const shouldKillRunning = argv.includes('--kill')

// ---- 日志：终端照常实时打印，文件里留一份完整记录（含子进程输出） ----

/** 脚本自身输出的一行：终端 + 日志文件（追加） */
function log(line = '') {
  console.log(line)
  appendFileSync(logPath, `${line}\n`, 'utf8')
}

/**
 * 跑一条命令并等它结束。
 *
 * 子进程的 stdout/stderr 直接接**当前终端**，同时把日志文件的写流作为第 4 个 stdio
 * 传给子进程 —— 这样终端能实时看到 cargo 进度，文件里也留一份完整输出（tee）。
 *
 * `tolerateFailure` 用于「失败也要看输出内容」的场景（判断是不是 exe 被占用）：
 * 这时不接继承的终端，改成管道，再把每一块手工同时写给终端和日志文件——
 * 效果同样是 tee，额外好处是能拿到输出尾部（`tail`）给调用方判断。
 */
function run(command, label, { quiet = false, tolerateFailure = false } = {}) {
  if (!quiet) {
    log(`\n>>> ${label}`)
    log(`    ${command}`)
  }
  // 用 openSync 的 fd 而不是 stream：spawnSync 的 stdio 需要「已经打开」的句柄，
  // createWriteStream 的打开是异步的，传进去会直接报 `The argument 'stdio' is invalid`
  const logFd = openSync(logPath, 'a')
  try {
    if (!tolerateFailure) {
      const result = spawnSync(command, {
        cwd: workspaceRoot,
        shell: true,
        stdio: ['ignore', process.stdout, process.stderr, logFd],
      })
      if (result.status !== 0) {
        throw new Error(`${label} 失败（退出码 ${result.status ?? '未知'}）`)
      }
      return { ok: true, status: 0, tail: '' }
    }

    // 需要读输出的场景：改管道，再把整段内容补写进日志（终端在这条路径上不是实时的，
    // 只用于「可能与占用有关」的 tauri build，失败重试时 cargo 有缓存、很快）
    const result = spawnSync(command, {
      cwd: workspaceRoot,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = result.stdout?.toString() ?? ''
    const stderr = result.stderr?.toString() ?? ''
    process.stdout.write(stdout)
    process.stderr.write(stderr)
    appendFileSync(logPath, `${stdout}${stderr}`, 'utf8')
    const tail = `${stdout}\n${stderr}`.slice(-4000)
    const status = result.status ?? -1
    return { ok: status === 0, status, tail }
  } finally {
    closeSync(logFd)
  }
}

/** 补上 cargo 所在目录（本机 rustup 默认装这里，但系统 PATH 里没有） */
function resolveCargoBin() {
  const cargoBin = join(homedir(), '.cargo', 'bin')
  if (existsSync(join(cargoBin, 'cargo.exe')) || existsSync(join(cargoBin, 'cargo'))) {
    process.env.PATH = `${cargoBin};${process.env.PATH}`
    return cargoBin
  }
  return null
}

/** 同步睡眠（构建脚本不需要事件循环，阻塞等待最省事） */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * 正在运行的桌面版进程。
 *
 * 要查**两个映像名**：用户可能跑 `target\release\smart-workspace.exe`，
 * 也可能直接双击项目根里那份 `云海工作台.exe`（产品名来自 tauri.conf.json）——
 * 两个都会锁住构建产物。按映像名查即可，不限定路径。
 */
function findRunningApp(productName) {
  const names = [RUST_BIN_NAME, `${productName}.exe`]
  const found = []
  for (const name of names) {
    const result = spawnSync(`tasklist /FI "IMAGENAME eq ${name}" /NH`, {
      encoding: 'utf8',
      shell: true,
    })
    const output = result.stdout ?? ''
    if (!output.includes(name)) continue
    for (const line of output.split(/\r?\n/)) {
      if (!line.includes(name)) continue
      const [procName, pid] = line.trim().split(/\s+/)
      found.push({ name: procName, pid })
    }
  }
  return found
}

/** 结束所有运行中的桌面版实例（含从项目根双击启动的那份） */
function killRunningApp(processes, productName) {
  for (const proc of processes) {
    log(`\n[kill] 结束正在运行的桌面版：${proc.name} (PID ${proc.pid})`)
    spawnSync(`taskkill /PID ${proc.pid} /F`, { stdio: 'inherit', shell: true })
  }
  // 等进程真的退出（taskkill /F 是异步收尾），避免紧接着的文件操作又撞上占用
  for (let i = 0; i < 30 && findRunningApp(productName).length > 0; i += 1) sleep(500)
}

/**
 * 确认被占用的 exe 已经能改写了。
 *
 * 为什么不能只看 `tasklist`：进程退出后 Windows 释放文件句柄有延迟；
 * 更要紧的是**用户在构建期间又双击了一次应用**——那一次 cargo 会白编译两分钟，
 * 最后死在 `failed to remove file ... 拒绝访问 (os error 5)`。
 *
 * 判据用「能不能以写方式打开它」：运行中的程序会锁住自己的映像，
 * `r+` 会直接 EACCES/EPERM；能打开就说明 cargo 删得掉（**不真删**，避免白白触发一次全量重链接）。
 */
function waitForExeUnlocked(exePath, productName, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      // 产物还没生成过（首次构建）时，只要没有实例在跑就算通过
      if (!existsSync(exePath)) {
        if (findRunningApp(productName).length === 0) return true
      } else {
        closeSync(openSync(exePath, 'r+'))
        // 能写不代表没有新实例起来——再问一次进程列表，双保险
        if (findRunningApp(productName).length === 0) return true
      }
    } catch {
      // 仍被占用：下面的提示会告诉用户怎么关
    }
    if (Date.now() > deadline) return false
    log('    …… exe 仍被占用（应用在运行 / 句柄还没释放），1 秒后重试（最多等 60 秒）')
    sleep(1000)
  }
}

/** 产物名跟着 tauri.conf.json 走（改 productName / version 不用动本脚本） */
function readProductName() {
  try {
    const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'))
    return { productName: conf.productName ?? '云海工作台', version: conf.version ?? '0.1.0' }
  } catch {
    return { productName: '云海工作台', version: '0.1.0' }
  }
}

function humanSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/**
 * 拷贝产物，遇到「目标被占用」自动重试。
 *
 * 拦住构建的最后一步是最冤的：目标目录里那份 `云海工作台.exe` 很可能正被当成
 * 绿色版跑着（占住自己的映像），也可能被别的程序打开。这里先等 10 秒，
 * 若用户说过 `--kill` 就直接结束占用它的实例，再不行才报错。
 */
function copyWithRetry(source, target, { productName, timeoutMs = 20_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let killedOnce = false
  for (;;) {
    try {
      copyFileSync(source, target)
      return
    } catch (error) {
      const expired = Date.now() > deadline
      const running = findRunningApp(productName)
      if (expired && shouldKillRunning && running.length > 0 && !killedOnce) {
        log(`\n[kill] ${target} 被运行中的桌面版占用，结束它后重试拷贝`)
        killRunningApp(running, productName)
        killedOnce = true
        if (waitForExeUnlocked(target, productName, 15_000)) continue
      }
      if (expired) {
        throw new Error(
          `拷贝产物失败：${target} 打不开（EBUSY）。\n` +
            `        多半是这个文件正被占用：跑着的桌面版（托盘里那份也算）、或打开它的资源管理器预览。\n` +
            `        用 \`pnpm desktop:build:kill\` 可以自动结束占用的实例。\n` +
            `        原始错误：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
      log(`    …… ${productName}.exe 暂时写不进去，1 秒后重试（最多等 ${timeoutMs / 1000} 秒）`)
      sleep(1000)
    }
  }
}

/** tauri 覆盖不了运行中的 exe 时打印的那句（中英两版 Windows 文案不同，都认） */
const EXE_LOCK_SIGNS = ['failed to remove file', '拒绝访问', 'Access is denied']

/**
 * 打包桌面端。
 *
 * cargo 在**链接最后一步**才覆盖 exe，所以「用户编译到一半又双击了一次应用」这种
 * 情况只会白等两分钟再失败。这里捕到占用报错就强杀一次再重试（故意只重试一次：
 * 第二次还失败说明不是占用问题，继续重试只会掩盖真实错误）。
 */
function runTauriBuild(productName) {
  const first = run('pnpm exec tauri build', '打包桌面端（tauri build）', {
    tolerateFailure: true,
  })
  if (first.ok) return

  const locked = EXE_LOCK_SIGNS.some((sign) => first.tail.includes(sign))
  if (!locked) {
    throw new Error(`打包桌面端失败（退出码 ${first.status}），报错见上方输出与 ${logPath}`)
  }

  const running = findRunningApp(productName)
  if (running.length === 0) {
    throw new Error(
      'target 里的 exe 被别的进程占用（不是桌面版本身，可能是杀软在扫描），' +
        '关掉相关程序后重跑即可',
    )
  }

  killRunningApp(running, productName)
  const targetExe = join(workspaceRoot, 'src-tauri', 'target', 'release', RUST_BIN_NAME)
  if (!waitForExeUnlocked(targetExe, productName)) {
    throw new Error('桌面版仍在运行，无法覆盖 exe；请从托盘菜单「退出」后重跑')
  }

  log('\n[retry] 已结束占用 exe 的进程，重新打包一次（cargo 有缓存，这轮很快）')
  run('pnpm exec tauri build', '打包桌面端（tauri build · 重试）')
}

// ---- 主流程 ----

const startedAt = new Date()
// 每次构建重写日志（后续输出一律追加）
writeFileSync(logPath, '', 'utf8')

log('============================================================')
log('  桌面端构建（网页端改动 → 重新打包 → 产物同步到项目根）')
log(`  开始时间：${startedAt.toLocaleString('zh-CN')}`)
log(`  工作目录：${workspaceRoot}`)
log(`  产物目录：${outputDir}`)
log('============================================================')

const cargoBin = resolveCargoBin()
log(
  cargoBin
    ? `\n[env] cargo 目录已加入 PATH：${cargoBin}`
    : '\n[env] 未在 ~/.cargo/bin 找到 cargo，改用系统 PATH',
)

try {
  // 「产物被占用」要在编译**之前**解决：否则 cargo 白编译两分钟，
  // 最后倒在「failed to remove file ... 拒绝访问」上。占用来源有两个：
  //   1) target\release 里的 exe 被运行中的实例锁住
  //   2) 项目根里拷出来的 云海工作台.exe 正被当绿色版跑着（用户直接双击的那份）
  const { productName, version } = readProductName()
  const targetExe = join(workspaceRoot, 'src-tauri', 'target', 'release', RUST_BIN_NAME)
  const exeTarget = join(outputDir, `${productName}.exe`)

  const running = findRunningApp(productName)
  if (running.length > 0) {
    if (!shouldKillRunning) {
      // 明确知道是谁占着就别干等，直接把人叫回来关
      const pids = running.map((p) => p.pid).join(', ')
      throw new Error(
        `桌面版正在运行（PID ${pids}），cargo 无法覆盖被占用的 exe。\n` +
          '        请退出桌面版：点窗口关闭按钮只是最小化到托盘，要从托盘菜单选「退出」，\n' +
          '        或直接跑 `pnpm desktop:build:kill` 让脚本强制结束它。',
      )
    }
    killRunningApp(running, productName)
  }
  if (!waitForExeUnlocked(targetExe, productName)) {
    throw new Error(
      'target 里的 exe 仍被占用（不是桌面版本身在跑，可能是杀软正在扫描），稍后重跑即可',
    )
  }
  // 项目根那份也要能写：它常年被当作绿色版双击，是最容易忘掉的一个占用源
  if (!waitForExeUnlocked(exeTarget, productName, 10_000)) {
    throw new Error(
      `项目根里的 ${productName}.exe 正被占用（多半是你双击运行的那份）——` +
        '请先退出它，或跑 `pnpm desktop:build:kill`',
    )
  }

  if (shouldVerify) {
    run('pnpm exec vue-tsc -b', '类型检查')
    run('pnpm exec vitest run', '单元测试')
    run('pnpm exec eslint .', 'ESLint')
  }

  if (skipFrontend) {
    log('\n[skip] --no-frontend：沿用现有 dist（Tauri 会把 dist 打进 exe）')
  } else {
    run('pnpm build', '构建网页端产物（dist）')
  }

  runTauriBuild(productName)

  // ---- 拷产物 ----
  const releaseDir = join(workspaceRoot, 'src-tauri', 'target', 'release')
  const exeSource = join(releaseDir, RUST_BIN_NAME)
  const setupSource = join(releaseDir, 'bundle', 'nsis', `${productName}_${version}_x64-setup.exe`)

  if (!existsSync(exeSource)) throw new Error(`没找到主程序：${exeSource}`)
  if (!existsSync(setupSource)) throw new Error(`没找到安装包：${setupSource}`)

  mkdirSync(outputDir, { recursive: true })

  const setupTarget = join(outputDir, `${productName}_${version}_x64-setup.exe`)
  copyWithRetry(exeSource, exeTarget, { productName })
  copyWithRetry(setupSource, setupTarget, { productName })

  log('\n============================================================')
  log(`  构建完成：${new Date().toLocaleString('zh-CN')}`)
  log(`  耗时：${((Date.now() - startedAt.getTime()) / 1000).toFixed(1)} 秒`)
  log('------------------------------------------------------------')
  log(`  绿色版主程序  ${exeTarget}  (${humanSize(statSync(exeTarget).size)})`)
  log(`  安装包        ${setupTarget}  (${humanSize(statSync(setupTarget).size)})`)
  log(`  构建日志      ${logPath}`)
  log('============================================================')
} catch (error) {
  log(`\n[FAILED] ${error instanceof Error ? error.message : String(error)}`)
  log(`完整日志已写入：${logPath}`)
  process.exit(1)
}
