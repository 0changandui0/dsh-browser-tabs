/**
 * 设置页的可写覆盖项：只存用户在设置页改过的那几项，落在 dataDir/settings.json。
 *
 * 为什么要单独一份文件：
 *   · 插件包里的 cordis.patch.yml 是「出厂默认」，重装/更新时会被覆盖；
 *   · profile 的 cordis.patch.yml 是全局配置，设置页写它容易和手写配置打架；
 *   · 这里只存 UI 能改的键，启动时覆盖在 bundle 配置之上，优先级清楚。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 设置页能改的键；顺序也是表单里的顺序。 */
export const SETTINGS_KEYS = Object.freeze([
  'enabled',
  'autoClose',
  'intervalMs',
  'cooldownMs',
  'activeGuardMs',
  'maxTabsPerWindow',
  'maxTabsTotal',
  'maxClosePerRun',
  'minAgeMs',
  'keepRecentPerWindow',
  'keepPatterns',
])

export function settingsFile(dataDir) {
  return join(String(dataDir || ''), 'settings.json')
}

/** 从一份配置里挑出设置页能写的键；null/undefined 不写，避免把默认值误当覆盖。 */
export function pickSettings(input) {
  const src = input && typeof input === 'object' ? input : {}
  const out = {}
  for (const key of SETTINGS_KEYS) {
    if (src[key] === undefined || src[key] === null) continue
    out[key] = key === 'keepPatterns' && !Array.isArray(src[key]) ? String(src[key]) : src[key]
  }
  return out
}

/** 读覆盖项。文件不存在、坏了、形状不对都当没有，绝不让设置文件拖垮插件启动。 */
export function readSettings(dataDir) {
  if (!dataDir) return {}
  try {
    const parsed = JSON.parse(readFileSync(settingsFile(dataDir), 'utf8'))
    const payload = parsed && typeof parsed.config === 'object' && parsed.config ? parsed.config : parsed
    return pickSettings(payload)
  } catch (err) {
    return {}
  }
}

/** 原子写：先写临时文件再 rename，避免断电/崩溃留下半截 JSON。 */
export function writeSettings(dataDir, config) {
  if (!dataDir) throw new Error('没有数据目录，设置无法保存')
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    config: pickSettings(config),
  }
  mkdirSync(dataDir, { recursive: true })
  const file = settingsFile(dataDir)
  const tmp = file + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  return payload
}

/** 读最近几条清理记录（新的在后），给设置页的「最近清理」用。 */
export function readHistory(dataDir, limit) {
  if (!dataDir) return []
  const max = Math.max(1, Math.min(50, Number(limit) || 10))
  try {
    const text = readFileSync(join(dataDir, 'history.jsonl'), 'utf8')
    const lines = text.split('\n').filter(Boolean)
    const out = []
    for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
      try {
        out.push(JSON.parse(lines[i]))
      } catch (err) {
        // 坏行跳过，继续往前凑够 max 条
      }
    }
    return out.reverse()
  } catch (err) {
    return []
  }
}
