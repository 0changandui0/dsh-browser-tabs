import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pickSettings, readHistory, readSettings, settingsFile, writeSettings, SETTINGS_KEYS } from '../lib/settings.mjs'
import { normalizeConfig } from '../lib/policy.mjs'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-browser-tabs-'))
}

test('没有设置文件时读出来是空对象', () => {
  const dir = tempDir()
  try {
    assert.deepEqual(readSettings(dir), {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('写进去再读出来只保留设置页那几个键', () => {
  const dir = tempDir()
  try {
    writeSettings(dir, {
      enabled: false,
      intervalMs: 45000,
      maxTabsTotal: 20,
      keepPatterns: ['a\\.com', 'b\\.com'],
      cdpUrl: 'http://127.0.0.1:9999',
      dataDir: 'D:/nope',
    })
    const got = readSettings(dir)
    assert.deepEqual(got, {
      enabled: false,
      intervalMs: 45000,
      maxTabsTotal: 20,
      keepPatterns: ['a\\.com', 'b\\.com'],
    })
    assert.deepEqual(Object.keys(got).sort(), Object.keys(got).filter((k) => SETTINGS_KEYS.includes(k)).sort())
    const raw = JSON.parse(readFileSync(settingsFile(dir), 'utf8'))
    assert.equal(raw.version, 1)
    assert.ok(raw.updatedAt)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('坏掉的设置文件不拖垮启动', () => {
  const dir = tempDir()
  try {
    writeFileSync(settingsFile(dir), '{not json')
    assert.deepEqual(readSettings(dir), {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pickSettings 不下发 null/undefined', () => {
  assert.deepEqual(pickSettings({ enabled: true, intervalMs: null, maxTabsTotal: undefined }), { enabled: true })
})

test('历史记录读最近几条，坏行跳过', () => {
  const dir = tempDir()
  try {
    mkdirSync(dir, { recursive: true })
    const lines = []
    for (let i = 0; i < 12; i++) lines.push(JSON.stringify({ at: '2026-01-01T00:00:0' + (i % 10) + 'Z', closed: new Array(i).fill({}) }))
    lines.push('{bad json')
    writeFileSync(join(dir, 'history.jsonl'), lines.join('\n'))
    const got = readHistory(dir, 5)
    assert.equal(got.length, 5)
    assert.equal(got[0].closed.length, 7)
    assert.equal(got[4].closed.length, 11)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('保留规则支持换行和逗号', () => {
  const cfg = normalizeConfig({ keepPatterns: 'a\\.com/\\?x=1\nb\\.com\nc\\.com' })
  assert.deepEqual(cfg.keepPatterns, ['a\\.com/\\?x=1', 'b\\.com', 'c\\.com'])
})
