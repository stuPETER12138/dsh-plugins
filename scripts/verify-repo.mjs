#!/usr/bin/env node
/**
 * Static checks for every plugin in this repository.
 *
 * Verifies the pieces the DSH plugin manager and loader rely on, without
 * mounting anything into a running DSH:
 *
 *  - package.json parses and carries the bundle metadata (`dsh.bundle.patch`);
 *  - every path in `exports` / `main` exists;
 *  - `cordis.patch.yml` inserts a row whose `name` matches the package name;
 *  - `files` covers the runtime files a Git install needs;
 *  - `locale/en.json` and `locale/zh.json` parse and expose meta title/description;
 *  - `icon.svg` exists;
 *  - every JavaScript file parses (`node --check`);
 *  - README.md exists with install/uninstall sections;
 *  - no machine-specific absolute paths, credentials, or proxy addresses leak in;
 *  - repository/homepage metadata points at the shared GitHub repository.
 *
 * Usage:
 *   node scripts/verify-repo.mjs
 *
 * Exit code 0 = all checks passed; 1 = at least one failure.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_URL = 'https://github.com/stuPETER12138/dsh-plugins'
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const failures = []
const warnings = []
let checks = 0

function pass() {
  checks += 1
}

function fail(where, message) {
  checks += 1
  failures.push(`${where}: ${message}`)
}

function warn(where, message) {
  warnings.push(`${where}: ${message}`)
}

function check(condition, where, message) {
  if (condition) pass()
  else fail(where, message)
}

function readText(file) {
  return readFileSync(file, 'utf8')
}

function readJson(file) {
  try {
    return JSON.parse(readText(file))
  } catch (error) {
    fail(file, `invalid JSON: ${error.message}`)
    return undefined
  }
}

function walkFiles(dir, predicate = () => true, output = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const file = join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(file, predicate, output)
    else if (predicate(file)) output.push(file)
  }
  return output
}

/** Machine-specific path / secret patterns that must not appear in plugin code or docs. */
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.md', '.ps1', '.txt'])

const FORBIDDEN_PATTERNS = [
  { name: 'machine user path', pattern: /[A-Za-z]:\\{1,2}Users\\{1,2}(?!<|\$|user|you)[^\\\s"']/i },
  { name: 'developer workspace path', pattern: /[A-Za-z]:\\{1,2}Project\\{1,2}dsh-(?:normal|dev)/i },
  { name: 'local proxy address', pattern: /127\.0\.0\.1:(?:7890|7891|7892|7893|7897|10808|10809)\b/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: 'private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'hard-coded password', pattern: /\bpassword\s*[:=]\s*['"][^'"]{6,}['"]/i },
]

function scanText(file, where) {
  const text = readText(file)
  for (const { name, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) fail(where, `contains ${name} (${pattern})`)
  }
  pass()
}

function checkJsSyntax(file, where) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
    pass()
  } catch (error) {
    fail(where, `JavaScript syntax error: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`)
  }
}

function pluginDirs() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(ROOT, name, 'package.json')))
    .filter((name) => {
      const manifest = readJson(join(ROOT, name, 'package.json'))
      return manifest?.dsh?.bundle !== undefined
    })
}

function verifyExports(dir, manifest, where) {
  const exported = Object.values(manifest.exports ?? {}).filter((value) => typeof value === 'string')
  for (const value of exported) {
    const target = value.replace(/^\.\//, '')
    if (target.includes('*')) {
      const [prefix, suffix] = target.split('*')
      const baseDir = join(dir, prefix.replace(/\/$/, ''))
      if (!existsSync(baseDir)) {
        fail(where, `exports wildcard ${JSON.stringify(value)} points at missing directory ${prefix}`)
        continue
      }
      const candidates = walkFiles(baseDir, (file) => file.endsWith(suffix === undefined ? '' : suffix))
      check(candidates.length > 0, where, `exports wildcard ${JSON.stringify(value)} matches no file`)
    } else {
      check(existsSync(join(dir, target)), where, `exports target ${JSON.stringify(value)} does not exist`)
    }
  }
  if (manifest.main !== undefined) {
    check(existsSync(join(dir, manifest.main)), where, `main ${JSON.stringify(manifest.main)} does not exist`)
  }
}

function verifyFilesList(dir, manifest, where) {
  const required = ['index.js', 'client.js', 'cordis.patch.yml', 'README.md']
  const listed = Array.isArray(manifest.files) ? manifest.files : undefined
  if (listed === undefined) {
    warn(where, 'package.json has no "files" list; a Git install would pack the whole directory')
  } else {
    for (const entry of listed) {
      if (entry.includes('*')) {
        const [prefix] = entry.split('*')
        check(existsSync(join(dir, prefix.replace(/\/$/, ''))), where, `files entry ${JSON.stringify(entry)} matches nothing`)
      } else {
        check(existsSync(join(dir, entry)), where, `files entry ${JSON.stringify(entry)} does not exist`)
      }
    }
    for (const needed of required) {
      const covered = listed.some((entry) => entry === needed || entry === `./${needed}` || entry.startsWith(needed.split('.').pop()))
      if (!covered) warn(where, `package.json "files" does not obviously include ${needed}; a Git install may omit it`)
    }
    if (!listed.some((entry) => entry.startsWith('locale'))) {
      fail(where, 'package.json "files" must include locale/*.json (the plugin manager reads it)')
    }
    if (!listed.some((entry) => entry.startsWith('icon'))) {
      warn(where, 'package.json "files" does not list icon.svg')
    }
  }
}

function verifyBundlePatch(dir, manifest, where) {
  const patchPath = manifest.dsh?.bundle?.patch
  check(typeof patchPath === 'string' && patchPath !== '', where, 'dsh.bundle.patch is missing')
  if (typeof patchPath !== 'string') return
  const file = join(dir, patchPath.replace(/^\.\//, ''))
  if (!existsSync(file)) {
    fail(where, `bundle patch ${JSON.stringify(patchPath)} does not exist`)
    return
  }
  const text = readText(file)
  check(/^\s*-\s*insert:/m.test(text), where, 'bundle patch has no top-level "- insert:" list')
  const names = [...text.matchAll(/name:\s*(['"])([^'"]+)\1/g)].map((match) => match[2])
  check(names.includes(manifest.name), where, `bundle patch does not insert a row named ${manifest.name} (found: ${names.join(', ') || 'none'})`)
  const ids = [...text.matchAll(/(?:^|\s)id:\s*([A-Za-z0-9_.-]+)/gm)].map((match) => match[1])
  check(ids.length > 0, where, 'bundle patch has no row id')
}

function verifyLocale(dir, where) {
  const seen = new Set()
  for (const language of ['en', 'zh']) {
    const file = join(dir, 'locale', `${language}.json`)
    if (!existsSync(file)) {
      fail(where, `missing locale/${language}.json`)
      continue
    }
    const locale = readJson(file)
    if (locale === undefined) continue
    const meta = locale?.meta ?? {}
    check(typeof meta.title === 'string' && meta.title.trim() !== '', where, `locale/${language}.json meta.title is missing`)
    check(typeof meta.description === 'string' && meta.description.trim() !== '', where, `locale/${language}.json meta.description is missing`)
    if (typeof meta.title === 'string') seen.add(meta.title)
  }
  check(seen.size === 2 || seen.size === 0, where, 'locale titles for en and zh should differ')
}

function verifyManifestMetadata(manifest, where) {
  check(typeof manifest.description === 'string' && manifest.description.trim() !== '', where, 'package.json description is missing')
  check(manifest.license === 'MIT', where, 'package.json license should be "MIT"')
  check(manifest.author !== undefined, where, 'package.json author is missing')
  check(typeof manifest.version === 'string' && SEMVER.test(manifest.version), where, `package.json version ${JSON.stringify(manifest.version)} is not SemVer`)
  check(manifest.type === 'module', where, 'package.json type should be "module"')
  const repository = manifest.repository
  check(
    repository !== undefined && `${repository.url ?? ''}`.includes('stuPETER12138/dsh-plugins'),
    where,
    'package.json repository should point at stuPETER12138/dsh-plugins',
  )
  check(
    typeof manifest.homepage === 'string' && manifest.homepage.startsWith(`${REPO_URL}/tree/main/`),
    where,
    'package.json homepage should point at the plugin directory on GitHub',
  )
  const client = manifest.dsh?.client
  check(client !== undefined, where, 'dsh.client is missing')
  if (client !== undefined) {
    check(client.platform === 'web', where, 'dsh.client.platform should be "web"')
    check(client.inject === undefined || Array.isArray(client.inject), where, 'dsh.client.inject should be an array when present')
  }
}

function verifyReadme(dir, where) {
  const file = join(dir, 'README.md')
  if (!existsSync(file)) {
    fail(where, 'README.md is missing')
    return
  }
  const text = readText(file)
  check(text.length >= 1200, where, 'README.md looks too short for a shared plugin (>= 1200 bytes)')
  for (const heading of ['安装', '卸载']) {
    if (!text.includes(heading)) fail(where, `README.md has no "${heading}" section`)
    else pass()
  }
}

function verifyPlugin(name) {
  const dir = join(ROOT, name)
  const where = name
  if (!existsSync(join(dir, 'node_modules'))) pass()
  else fail(where, 'node_modules directory must not be committed')

  const manifest = readJson(join(dir, 'package.json'))
  if (manifest === undefined) return
  check(typeof manifest.name === 'string' && manifest.name.startsWith('@local/'), where, 'package name should start with @local/')
  check(manifest.name === `@local/${name}`, where, `package name ${manifest.name} does not match directory ${name}`)
  verifyManifestMetadata(manifest, where)
  verifyExports(dir, manifest, where)
  verifyFilesList(dir, manifest, where)
  verifyBundlePatch(dir, manifest, where)
  verifyLocale(dir, where)
  verifyReadme(dir, where)
  check(existsSync(join(dir, 'icon.svg')), where, 'icon.svg is missing')

  const scripts = walkFiles(dir, (file) => extname(file) === '.js' || extname(file) === '.mjs')
  for (const file of scripts) checkJsSyntax(file, `${where}/${file.slice(dir.length + 1)}`)
  for (const file of walkFiles(dir, (file) => TEXT_EXTENSIONS.has(extname(file)))) {
    scanText(file, `${where}/${file.slice(dir.length + 1)}`)
  }
}

function verifyRoot() {
  for (const file of ['README.md', 'LICENSE', '.gitignore']) {
    check(existsSync(join(ROOT, file)), 'repo', `${file} is missing`)
  }
  for (const file of ['docs/INSTALL.md', 'docs/COMPATIBILITY.md', 'docs/DEVELOPMENT.md']) {
    check(existsSync(join(ROOT, file)), 'repo', `${file} is missing`)
  }
  const indexPath = join(ROOT, 'index.json')
  if (!existsSync(indexPath)) {
    warn('repo', 'index.json does not exist yet; run node scripts/generate-index.mjs')
  } else {
    const index = readJson(indexPath)
    check(index?.format === 1, 'index.json', 'format must be 1')
    check(Array.isArray(index?.plugins) && index.plugins.length === pluginDirs().length, 'index.json', 'plugins must list every plugin directory')
    for (const plugin of index?.plugins ?? []) {
      const source = plugin?.versions?.[0]?.source
      check(source?.type === 'git', `index.json:${plugin.name}`, 'version source must be git')
      check(/^[0-9a-f]{40}$/.test(source?.commit ?? ''), `index.json:${plugin.name}`, 'commit must be a full 40-hex SHA')
      check(source?.url === REPO_URL, `index.json:${plugin.name}`, `source.url must be ${REPO_URL}`)
      check(typeof source?.path === 'string' && existsSync(join(ROOT, source.path)), `index.json:${plugin.name}`, `source.path ${JSON.stringify(source?.path)} is not a plugin directory`)
      check(typeof plugin?.icon === 'string' && plugin.icon.startsWith('data:image/'), `index.json:${plugin.name}`, 'icon should be an inline data: image')
    }
  }
}

function main() {
  const dirs = pluginDirs()
  if (dirs.length === 0) {
    console.error('verify-repo: no plugin directories found')
    process.exit(1)
  }
  for (const name of dirs) verifyPlugin(name)
  verifyRoot()

  for (const warning of warnings) console.warn(`WARN  ${warning}`)
  for (const failure of failures) console.error(`FAIL  ${failure}`)
  console.log('')
  console.log(`verify-repo: ${dirs.length} plugin(s), ${checks} checks, ${failures.length} failure(s), ${warnings.length} warning(s)`)
  if (failures.length > 0) {
    console.error('verify-repo: FAILED')
    process.exit(1)
  }
  console.log('verify-repo: OK')
}

main()
