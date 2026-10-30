#!/usr/bin/env node
/**
 * dsh-journal 一键安装器
 *
 * 做四件事：
 *   1. 把两个插件登记到 DSH profile（dependency + bundle）
 *   2. 在 profile 的 node_modules 下建链接，让 `@local/*` 能被解析
 *   3. 初始化数据目录（空账本，不含任何示例数据）
 *   4. 在 profile 的 cordis.patch.yml 里写入 dataDir 覆盖
 *
 * 幂等：重复运行结果一致；改配置前会备份 profile 的 package.json / cordis.patch.yml。
 *
 *   node install.mjs                     # 默认装到 ~/.dsh/profiles/desktop
 *   node install.mjs --data D:/my/journal
 *   node install.mjs --profile myprofile
 *   node install.mjs --dry-run           # 只打印将要做的事
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, lstatSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGINS = ['reading-inbox', 'journal-panel']
const BLOCK_START = '# >>> dsh-journal installer >>>'
const BLOCK_END = '# <<< dsh-journal installer <<<'

function parseArgs(argv) {
  const out = { data: '', profile: 'desktop', dry: false, python: 'python' }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--dry-run') out.dry = true
    else if (a === '--data') out.data = argv[++i] || ''
    else if (a === '--profile') out.profile = argv[++i] || 'desktop'
    else if (a === '--python') out.python = argv[++i] || 'python'
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(join(HERE, 'INSTALL.md'), 'utf8'))
      process.exit(0)
    }
  }
  return out
}

const yamlString = (value) => JSON.stringify(value.replace(/\\/g, '/'))

const args = parseArgs(process.argv.slice(2))
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', args.profile)
const dataDir = resolve(args.data || join(homedir(), '.dsh-journal', 'data'))

const log = (msg) => console.log(msg)
const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}
// Windows 编辑器经常写入 BOM，JSON.parse / YAML 都不认，读的时候先剥掉
const readText = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '')

if (!existsSync(join(profileDir, 'package.json'))) {
  fail(`找不到 DSH profile：${profileDir}\n  先确认 DSH 装好并至少启动过一次，或用 --profile 指定名称。`)
}

const profilePkgPath = join(profileDir, 'package.json')
const profilePatchPath = join(profileDir, 'cordis.patch.yml')

log(`\ndsh-journal 安装器`)
log(`  DSH profile : ${profileDir}`)
log(`  数据目录    : ${dataDir}`)
log(`  仓库位置    : ${HERE}`)
if (args.dry) log(`  （dry-run，不会写入任何文件）`)

/* ------------------------------------------------------------------ 1. 数据 */

const templateDir = join(HERE, 'templates', 'journal')
const seed = [
  ['store.json', 'store.json'],
  ['notebook.md', 'notebook.md'],
]
const seedDirs = ['projects', 'capture', 'reports']

if (!existsSync(dataDir)) {
  if (!args.dry) mkdirSync(dataDir, { recursive: true })
  log(`\n[1/4] 新建数据目录`)
} else {
  log(`\n[1/4] 数据目录已存在，只补缺的文件`)
}
for (const dir of seedDirs) {
  if (!args.dry) mkdirSync(join(dataDir, dir), { recursive: true })
}
// 阅读收件箱的数据目录（插件会自己建，但先建好可以让面板第一次打开就有内容）
if (!args.dry) mkdirSync(join(dataDir, '..', 'reading-inbox-data'), { recursive: true })
for (const [from, to] of seed) {
  const src = join(templateDir, from)
  const dst = join(dataDir, to)
  if (!existsSync(dst)) {
    if (!args.dry) copyFileSync(src, dst)
    log(`  + ${to}`)
  }
}
// RULES.md 是这套系统的规则文件，随代码走；数据目录里缺就补一份
const rulesSrc = join(HERE, 'journal', 'RULES.md')
const rulesDst = join(dataDir, 'RULES.md')
if (!existsSync(rulesDst)) {
  if (!args.dry) copyFileSync(rulesSrc, rulesDst)
  log(`  + RULES.md`)
}

// journal.py 及其模块也放进数据目录：插件按「数据目录里有 journal.py」调用，
// 这样整个数据目录是自包含的，搬机器/备份只需要搬一个文件夹。
const pyFiles = ['journal.py', 'journal_evidence.py', 'journal_sources.py', 'journal_notebook.py', 'journal_handoff.py']
let copied = 0
for (const file of pyFiles) {
  const src = join(HERE, 'journal', file)
  const dst = join(dataDir, file)
  if (!args.dry) copyFileSync(src, dst)
  copied += 1
}
log(`  ~ ${copied} 个 .py 已同步（git pull 后重跑本脚本即可更新）`)

/* ------------------------------------------------- 2. profile package.json */

const pkg = JSON.parse(readText(profilePkgPath))
pkg.dependencies = pkg.dependencies || {}
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []

log(`\n[2/4] 登记到 profile`)
for (const name of PLUGINS) {
  const target = join(HERE, 'plugins', name)
  const link = `link:${target.replace(/\\/g, '/')}`
  const changed = pkg.dependencies[`@local/${name}`] !== link
  pkg.dependencies[`@local/${name}`] = link
  if (!pkg.dsh.profile.bundles.includes(`@local/${name}`)) pkg.dsh.profile.bundles.push(`@local/${name}`)
  log(`  @local/${name} ${changed ? '(已登记)' : '(无变化)'}`)
}
if (!args.dry) {
  copyFileSync(profilePkgPath, `${profilePkgPath}.dsh-journal.bak`)
  writeFileSync(profilePkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
}

/* ------------------------------------------------ 3. node_modules 链接 */

log(`\n[3/4] 建立链接`)
const nmLocal = join(profileDir, 'node_modules', '@local')
if (!args.dry) mkdirSync(nmLocal, { recursive: true })
for (const name of PLUGINS) {
  const target = join(HERE, 'plugins', name)
  const linkPath = join(nmLocal, name)
  let exists = false
  try {
    lstatSync(linkPath)
    exists = true
  } catch {
    exists = false
  }
  if (exists) {
    log(`  ${name} 已存在，跳过`)
    continue
  }
  if (!args.dry) {
    symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
  }
  log(`  + ${name}`)
}

/* ------------------------------------------- 4. profile cordis.patch.yml */

log(`\n[4/4] 写入 dataDir 覆盖`)
const block = [
  BLOCK_START,
  `# 由 install.mjs 写入；改完重启 DSH 生效。`,
  `- id: reading-inbox`,
  `  config:`,
  `    dataDir: ${yamlString(join(dataDir, '..', 'reading-inbox-data'))}`,
  `    journalDir: ${yamlString(dataDir)}`,
  `    python: ${yamlString(args.python)}`,
  `- id: journal-panel`,
  `  config:`,
  `    dataDir: ${yamlString(dataDir)}`,
  `    readingInbox: ${yamlString(join(dataDir, '..', 'reading-inbox-data'))}`,
  `    python: ${yamlString(args.python)}`,
  BLOCK_END,
  '',
].join('\n')

let patch = existsSync(profilePatchPath) ? readText(profilePatchPath) : ''
const start = patch.indexOf(BLOCK_START)
const end = patch.indexOf(BLOCK_END)
if (start >= 0 && end > start) {
  patch = patch.slice(0, start) + block + patch.slice(end + BLOCK_END.length + 1)
} else {
  // 空 profile 的 patch 文件里常常只有一个 `[]` 占位符；
  // 直接在它后面追加会得到非法 YAML（流式序列 + 块式序列混用），所以先清掉。
  const bare = patch.replace(/#.*$/gm, '').trim()
  if (bare === '[]' || bare === '---' || bare === '') patch = ''
  if (patch && !patch.endsWith('\n')) patch += '\n'
  patch += (patch ? '\n' : '') + block
}
if (!args.dry) {
  if (existsSync(profilePatchPath)) copyFileSync(profilePatchPath, `${profilePatchPath}.dsh-journal.bak`)
  writeFileSync(profilePatchPath, patch, 'utf8')
}
log(`  已写入 ${profilePatchPath}`)

/* ------------------------------------------------- 5. 渲染定时任务提示词 */

const schedulesDir = join(HERE, 'schedules')
const readyPath = join(dataDir, '..', 'schedules-ready.md')
log(`\n[5/5] 生成定时任务提示词`)
if (existsSync(schedulesDir)) {
  const order = readdirSync(schedulesDir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()
  const parts = [
    '# dsh-journal 定时任务（路径已填好）',
    '',
    '> 由 install.mjs 生成，占位符已替换成你机器上的真实路径。',
    '> 把整个文件交给 agent，让它按每节开头的 `<!-- schedule -->` 建三个定时任务。',
    '',
  ]
  for (const file of order) {
    const body = readFileSync(join(schedulesDir, file), 'utf8')
      .replaceAll('{{JOURNAL_DIR}}', dataDir.replace(/\\/g, '/'))
      .replaceAll('{{PYTHON}}', args.python)
    parts.push('---', '', body.trim(), '')
  }
  if (!args.dry) writeFileSync(readyPath, parts.join('\n'), 'utf8')
  log(`  + ${order.length} 个任务 → ${readyPath}`)
} else {
  log(`  ! 找不到 schedules/ 目录，跳过`)
}

/* ------------------------------------------------------------------ 收尾 */

log(`
装完了。还差三步（都必须手动）：

  1. 重启 DSH。插件的 HTTP 路由和面板只有重启后才挂载。
  2. 建三个定时任务。把这句话发给 agent：
       「读 ${readyPath}，按里面的 schedule 元信息建三个定时任务」
     没有它们，系统只有面板和消息通道，没有「晚间收口 / 每周压实」。
  3. 第一次用微信通道：左侧栏「碎片阅读」→ 接入微信 → 手机扫码。

验证：
  python "${join(dataDir, 'journal.py')}" status

数据在哪里：
  账本      ${dataDir}
  阅读收件  ${join(dataDir, '..', 'reading-inbox-data')}

这两个目录都是纯本地文件，想备份直接复制，想换机器整个搬过去即可。
${args.dry ? '\n（dry-run：以上都没有真的执行）' : ''}
`)
