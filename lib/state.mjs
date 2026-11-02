import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function emptyState() {
  return { version: 1, firstSeen: {}, lastCleanupAt: 0, totalClosed: 0, lastResult: null }
}

export function stateFile(dataDir) {
  return join(dataDir, 'state.json')
}

export function historyFile(dataDir) {
  return join(dataDir, 'history.jsonl')
}

export function loadState(dataDir) {
  try {
    mkdirSync(dataDir, { recursive: true })
    const parsed = JSON.parse(readFileSync(stateFile(dataDir), 'utf8'))
    const state = emptyState()
    if (parsed && typeof parsed === 'object') {
      if (parsed.firstSeen && typeof parsed.firstSeen === 'object') state.firstSeen = parsed.firstSeen
      if (Number.isFinite(parsed.lastCleanupAt)) state.lastCleanupAt = parsed.lastCleanupAt
      if (Number.isFinite(parsed.totalClosed)) state.totalClosed = parsed.totalClosed
      if (parsed.lastResult && typeof parsed.lastResult === 'object') state.lastResult = parsed.lastResult
    }
    return state
  } catch (err) {
    return emptyState()
  }
}

export function saveState(dataDir, state) {
  try {
    mkdirSync(dataDir, { recursive: true })
    const target = stateFile(dataDir)
    const temp = target + '.tmp'
    writeFileSync(temp, JSON.stringify(state, null, 2))
    renameSync(temp, target)
    return true
  } catch (err) {
    return false
  }
}

export function appendHistory(dataDir, entry) {
  try {
    mkdirSync(dataDir, { recursive: true })
    appendFileSync(historyFile(dataDir), JSON.stringify(entry) + '\n')
    return true
  } catch (err) {
    return false
  }
}
