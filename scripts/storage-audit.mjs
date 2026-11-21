#!/usr/bin/env node
/**
 * Dry run for the Usage & Resources cleanup card, usable without DSH running.
 *
 * It answers exactly the question the panel's "Reclaimable space" card answers:
 * which session logs are archived, not running, and untouched for `--days`,
 * how big each one is, and how much space removing them would return.
 *
 * Nothing is deleted unless `--apply --confirm` is passed, and even then the
 * same guards the Host route uses apply: every directory must be a session
 * directory found by a fresh scan, two levels below the sessions root, and named
 * after the id it was found under.
 *
 * Usage:
 *   node scripts/storage-audit.mjs [--days 90] [--json]
 *   node scripts/storage-audit.mjs --apply --confirm [--days 90]
 *
 *   --home <dir>       Harness home (default: $DSH_HOME, else ~/.dsh)
 *   --sessions <dir>   sessions root (default: <home>/sessions)
 *   --workspace <file> workspace state carrying the archive set
 *                      (default: <home>/storages/workspace.json)
 *   --days <n>         minimum age in days (default 90)
 *   --json             print the plan as JSON instead of a table
 *   --apply            delete the listed sessions (needs --confirm)
 *   --confirm          acknowledge that deleted logs cannot be recovered
 */
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { deleteSessionDirs, scanSessions, selectCleanup } from '../dsh-usage-stats/storage.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const values = new Map()
  const flags = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const name = token.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      values.set(name, next)
      index += 1
    } else {
      flags.add(name)
    }
  }
  return { values, flags }
}

function fail(message) {
  console.error('storage-audit: ' + message)
  process.exit(2)
}

const { values, flags } = parseArgs(process.argv.slice(2))

const home = path.resolve(
  values.get('home') ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'),
)
const sessionsRoot = path.resolve(values.get('sessions') ?? path.join(home, 'sessions'))
const workspaceFile = path.resolve(values.get('workspace') ?? path.join(home, 'storages', 'workspace.json'))
const days = Number.parseInt(values.get('days') ?? '90', 10)
if (!Number.isFinite(days) || days <= 0) fail('--days must be a positive integer')

const apply = flags.has('apply')
const confirmed = flags.has('confirm')
if (apply && !confirmed) fail('--apply needs --confirm: deleted session logs cannot be recovered')

if (!existsSync(sessionsRoot)) fail('sessions root not found: ' + sessionsRoot)
if (!existsSync(workspaceFile)) fail('workspace state not found: ' + workspaceFile)

/** The durable archive set lives in the workspace domain's global state. */
function readArchivedIds() {
  const raw = JSON.parse(readFileSync(workspaceFile, 'utf8'))
  const ids = raw?.global?.archivedSessionIds
  if (!Array.isArray(ids)) fail('workspace state has no global.archivedSessionIds array: ' + workspaceFile)
  return ids.map(String)
}

/** Titles are cosmetic here: the projection cache has one when the panel has run. */
function readTitle(id) {
  const file = path.join(home, 'storages', 'session_projcache', 'sessions', id + '.json')
  if (!existsSync(file)) return ''
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const value = raw?.record?.rows?.title?.val
    return typeof value === 'string' ? value.trim() : ''
  } catch (_error) {
    return ''
  }
}

function bytes(value) {
  if (value >= 1024 ** 3) return (value / 1024 ** 3).toFixed(1) + ' GB'
  if (value >= 1024 ** 2) return (value / 1024 ** 2).toFixed(1) + ' MB'
  if (value >= 1024) return Math.round(value / 1024) + ' KB'
  return Math.round(value) + ' B'
}

function stamp(ms) {
  const date = new Date(ms)
  const pad = (value) => String(value).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/** Pad by code point count so a CJK title does not blow the column up. */
function pad(text, width) {
  const points = [...String(text)]
  if (points.length >= width) return points.slice(0, width - 1).join('') + '…'
  return String(text) + ' '.repeat(width - points.length)
}

const scan = await scanSessions(sessionsRoot)
const plan = selectCleanup({
  sessions: scan.sessions,
  archivedIds: readArchivedIds(),
  liveIds: [],
  days,
  now: Date.now(),
})
const rows = plan.candidates.map((candidate) => ({ ...candidate, title: readTitle(candidate.id) }))

if (flags.has('json')) {
  console.log(JSON.stringify({ sessionsRoot, workspaceFile, days, plan: { ...plan, candidates: rows } }, undefined, 2))
} else {
  console.log('')
  console.log('sessions root : ' + sessionsRoot)
  console.log('archive set   : ' + workspaceFile)
  console.log('rule          : archived + last write older than ' + plan.days + ' days (before ' + stamp(plan.cutoff) + ')')
  console.log('archive total : ' + plan.archived.sessions + ' sessions, ' + bytes(plan.archived.bytes))
  console.log('scanned       : ' + scan.sessions.length + ' sessions, ' + bytes(scan.sessions.reduce((sum, session) => sum + session.bytes, 0)))
  console.log('')
  if (rows.length === 0) {
    console.log('No session matches. Nothing to reclaim.')
  } else {
    console.log('  #  ' + pad('size', 10) + pad('last write', 12) + pad('age', 6) + 'title')
    console.log('  ' + '-'.repeat(96))
    rows.forEach((row, index) => {
      console.log(
        '  ' + pad(String(index + 1), 3) + pad(bytes(row.bytes), 10) + pad(stamp(row.lastWrite), 12) + pad(row.ageDays + 'd', 6) + pad(row.title || '(untitled)', 44) + ' ' + row.id,
      )
    })
    console.log('')
    console.log('ELIGIBLE: ' + plan.total.count + ' sessions, ' + bytes(plan.total.bytes) + ' reclaimable')
  }
  if (plan.skipped.recent > 0) {
    console.log('skipped  : ' + plan.skipped.recent + ' archived sessions written within the window (' + bytes(plan.skipped.recentBytes) + ')')
  }
}

if (apply) {
  if (rows.length === 0) {
    console.log('storage-audit: nothing to delete')
    process.exit(0)
  }
  // Re-plan right before deleting: the archive set or the files may have moved.
  const fresh = await scanSessions(sessionsRoot)
  const freshPlan = selectCleanup({
    sessions: fresh.sessions,
    archivedIds: readArchivedIds(),
    liveIds: [],
    days,
    now: Date.now(),
  })
  const ids = freshPlan.candidates.map((candidate) => candidate.id)
  const result = await deleteSessionDirs({ root: fresh.root, sessions: fresh.sessions, ids })
  console.log('')
  console.log('DELETED: ' + result.deleted.length + ' sessions, ' + bytes(result.freedBytes) + ' freed')
  if (result.failed.length > 0) {
    for (const failure of result.failed) console.log('  FAILED ' + failure.id + ': ' + failure.error)
    process.exit(1)
  }
}
