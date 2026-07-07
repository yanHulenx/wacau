import fs from 'fs/promises'
import path from 'path'
import type { ChatSession } from './types'

const dbPath = path.join(process.cwd(), 'sessions.json')
const TTL_MS = 24 * 60 * 60 * 1000

let cache: Record<string, ChatSessionWithMeta> | null = null

interface ChatSessionWithMeta extends ChatSession {
  _ts: number
}

async function loadAll(): Promise<Record<string, ChatSessionWithMeta>> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(dbPath, 'utf-8')
    cache = JSON.parse(raw)
  } catch {
    cache = {}
  }
  return cache!
}

async function saveAll(): Promise<void> {
  if (!cache) return
  await fs.writeFile(dbPath, JSON.stringify(cache, null, 2), 'utf-8')
}

function cleanup() {
  if (!cache) return
  const now = Date.now()
  let changed = false
  for (const key of Object.keys(cache)) {
    if (now - cache[key]._ts > TTL_MS) {
      delete cache[key]
      changed = true
    }
  }
  if (changed) saveAll()
}

setInterval(cleanup, 60 * 60 * 1000)

export async function loadSession(key: string): Promise<ChatSession | null> {
  const all = await loadAll()
  cleanup()
  const s = all[key]
  if (!s) return null
  s.lastActive = Date.now()
  s._ts = Date.now()
  return s
}

export async function saveSession(key: string, session: ChatSession): Promise<void> {
  const all = await loadAll()
  all[key] = { ...session, _ts: Date.now() }
  if (all[key].history.length > 0) all[key].lastActive = Date.now()
  await saveAll()
}

export async function deleteSession(key: string): Promise<void> {
  cache = null
  const all = await loadAll()
  delete all[key]
  await saveAll()
}

export function cleanupNow() {
  cleanup()
}
