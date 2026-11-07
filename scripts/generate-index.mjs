#!/usr/bin/env node
/**
 * Generate the DSH plugin market index (`index.json`, format 1) for this repository.
 *
 * Every version of every plugin is pinned to the Git commit that contains the
 * plugin directory, so an install always fetches exactly the code from that
 * commit. Regenerate (and commit) this file after changing plugin code:
 *
 *   git commit -am "feat(...): ..."     # commit plugin code first
 *   node scripts/generate-index.mjs
 *   git add index.json && git commit -m "chore: refresh plugin index"
 *
 * Usage:
 *   node scripts/generate-index.mjs [--commit <40-hex-sha>] [--repo <github url>]
 *
 * No third-party dependencies; requires only Node and the `git` executable.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INDEX_FILE = join(ROOT, 'index.json')

/** Repository facts used in every entry. */
const REPO_URL = 'https://github.com/stuPETER12138/dsh-plugins'
const AUTHOR = 'stuPETER12138'
const PLUGIN_LIST_FILE = join(ROOT, 'scripts', 'plugin-list.json')

/** Index-level categories (ids referenced by plugins below). */
const CATEGORIES = {
  assistant: {
    title: { en: 'Assistant workflow', zh: '助手工作流' },
  },
  interface: {
    title: { en: 'Interface', zh: '界面增强' },
  },
  insight: {
    title: { en: 'Insights', zh: '数据洞察' },
  },
}

/**
 * Per-plugin index metadata: directory, category id and search keywords.
 * Keep in sync when adding or removing a plugin.
 */
const PLUGINS = [
  {
    dir: 'dsh-completion-notify',
    category: 'assistant',
    keywords: ['notification', 'toast', 'session', 'approval', 'notify', '任务通知', '系统通知'],
  },
  {
    dir: 'dsh-session-share',
    category: 'assistant',
    keywords: ['session', 'share', 'export', 'markdown', 'pdf', 'png', '导出', '分享'],
  },
  {
    dir: 'dsh-sticky-wall',
    category: 'interface',
    keywords: ['sticky', 'notes', 'sidebar', 'todo', 'memo', '便签', '灵感'],
  },
  {
    dir: 'dsh-style-studio',
    category: 'interface',
    keywords: ['theme', 'style', 'appearance', 'skin', 'dark', '主题', '风格'],
  },
  {
    dir: 'dsh-usage-stats',
    category: 'insight',
    keywords: ['usage', 'tokens', 'cost', 'statistics', 'dashboard', '用量', '成本'],
  },
]

function die(message) {
  console.error(`generate-index: ${message}`)
  process.exit(1)
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function parseArgs(argv) {
  const options = { commit: undefined, repo: REPO_URL }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--commit') {
      options.commit = argv[i + 1]
      i += 1
    } else if (arg.startsWith('--commit=')) {
      options.commit = arg.slice('--commit='.length)
    } else if (arg === '--repo') {
      options.repo = argv[i + 1]
      i += 1
    } else if (arg.startsWith('--repo=')) {
      options.repo = arg.slice('--repo='.length)
    } else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/generate-index.mjs [--commit <sha>] [--repo <url>]')
      process.exit(0)
    } else {
      die(`unknown argument ${JSON.stringify(arg)}`)
    }
  }
  return options
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    die(`cannot read ${file}: ${error.message}`)
  }
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    die(`cannot read ${file}: ${error.message}`)
  }
}

/** Read the localized title/description the plugin manager shows, falling back to the manifest. */
function displayMeta(dir, manifest) {
  const title = {}
  const description = {}
  for (const language of ['en', 'zh']) {
    const file = join(ROOT, dir, 'locale', `${language}.json`)
    if (!existsSync(file)) continue
    const locale = readJson(file)
    const meta = locale.meta ?? {}
    if (typeof meta.title === 'string' && meta.title.trim() !== '') title[language] = meta.title
    if (typeof meta.description === 'string' && meta.description.trim() !== '') {
      description[language] = meta.description
    }
  }
  if (title.en === undefined) title.en = manifest.name
  if (description.en === undefined && typeof manifest.description === 'string') {
    description.en = manifest.description
  }
  return { title, description }
}

function inlineIcon(dir) {
  const file = join(ROOT, dir, 'icon.svg')
  if (!existsSync(file)) return undefined
  const svg = readFileSync(file)
  return `data:image/svg+xml;base64,${svg.toString('base64')}`
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const repo = options.repo.replace(/\.git$/, '').replace(/\/$/, '')
  const commit = options.commit ?? git(['rev-parse', 'HEAD'])
  if (!/^[0-9a-f]{40}$/.test(commit)) die(`commit must be a full lowercase 40-hex SHA, got ${JSON.stringify(commit)}`)
  git(['cat-file', '-e', `${commit}^{commit}`])
  const publishTimestamp = Number(git(['log', '-1', '--format=%ct', commit]))
  if (!Number.isInteger(publishTimestamp) || publishTimestamp <= 0) die('cannot read the commit time')

  const plugins = PLUGINS.map((entry) => {
    const manifestFile = join(ROOT, entry.dir, 'package.json')
    if (!existsSync(manifestFile)) die(`missing ${manifestFile}`)
    const manifest = readJson(manifestFile)
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@local/')) {
      die(`${entry.dir}/package.json: expected an @local/ package name`)
    }
    if (typeof manifest.version !== 'string') die(`${entry.dir}/package.json: missing version`)
    if (manifest.dsh?.bundle?.patch === undefined) die(`${entry.dir}/package.json: not a DSH bundle`)
    try {
      git(['cat-file', '-e', `${commit}:${entry.dir}/package.json`])
    } catch {
      die(`commit ${commit} does not contain ${entry.dir}/package.json; commit the plugin first`)
    }
    const { title, description } = displayMeta(entry.dir, manifest)
    const icon = inlineIcon(entry.dir)
    return {
      name: manifest.name,
      title,
      ...(description.en === undefined ? {} : { description }),
      ...(icon === undefined ? {} : { icon }),
      author: AUTHOR,
      homepage: `${repo}/tree/main/${entry.dir}`,
      repository: { url: repo, directory: entry.dir },
      metadata: { category: entry.category, keywords: entry.keywords },
      versions: [
        {
          version: manifest.version,
          publishTimestamp,
          source: { type: 'git', url: repo, commit, path: entry.dir },
        },
      ],
    }
  })

  const index = {
    format: 1,
    title: {
      en: 'stuPETER12138 DSH plugins',
      zh: 'stuPETER12138 的 DSH 插件集',
    },
    description: {
      en: 'Personal DeepSeek Harness web plugins: notifications, session sharing, sticky notes, visual styles, and usage statistics.',
      zh: '自用的 DeepSeek Harness Web 插件集：任务通知、会话分享、便签墙、视觉风格与用量统计。',
    },
    metadata: { categories: CATEGORIES },
    plugins,
  }

  const names = new Set()
  for (const plugin of plugins) {
    if (names.has(plugin.name)) die(`duplicate plugin name ${plugin.name}`)
    names.add(plugin.name)
  }

  writeFileSync(INDEX_FILE, `${JSON.stringify(index, undefined, 2)}\n`, 'utf8')
  console.log(`generate-index: wrote ${INDEX_FILE}`)
  console.log(`generate-index: commit ${commit}, published ${new Date(publishTimestamp * 1000).toISOString()}`)
  for (const plugin of plugins) {
    console.log(`  - ${plugin.name}@${plugin.versions[0].version} (path: ${plugin.repository.directory})`)
  }
  if (PLUGIN_LIST_FILE !== undefined && existsSync(PLUGIN_LIST_FILE)) {
    // The list file is documentation-only; nothing to do.
  }
}

main()
