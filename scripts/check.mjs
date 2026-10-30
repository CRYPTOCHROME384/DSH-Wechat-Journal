import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (['node_modules', '.git', '__pycache__'].includes(e.name)) return []
    const path = join(dir, e.name)
    return e.isDirectory() ? walk(path) : [path]
  })
}
const files = walk('.')
for (const path of files) {
  if (path.endsWith('.json')) JSON.parse(readFileSync(path, 'utf8'))
  if (/\.(mjs|js)$/.test(path)) {
    const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' })
    if (result.status !== 0) process.exit(1)
  }
}
const py = files.filter(p => p.endsWith('.py'))
const result = spawnSync(process.env.DSH_PYTHON || 'python', ['-c',
  'import ast, pathlib, sys; [ast.parse(pathlib.Path(p).read_text(encoding="utf-8-sig"), filename=p, feature_version=(3,10)) for p in sys.argv[1:]]', ...py], { stdio: 'inherit' })
if (result.status !== 0) process.exit(1)
console.log('JavaScript, JSON and Python syntax checks passed.')
