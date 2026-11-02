/**
 * 选择逻辑：纯函数，不碰网络/磁盘，方便单测。
 *
 * 一条原则：宁可少关，不能错关。
 * 正在用的、刚打开的、命中保留规则的、窗口最小化看不见的，一律不动。
 */

export const DEFAULTS = Object.freeze({
  enabled: true,
  autoClose: true,
  dryRun: false,
  cdpUrl: 'http://127.0.0.1:9227',
  intervalMs: 30000,
  startDelayMs: 10000,
  cooldownMs: 90000,
  activeGuardMs: 120000,
  requestTimeoutMs: 4000,
  probeTimeoutMs: 1500,
  maxTabsPerWindow: 8,
  maxTabsTotal: 12,
  minTabsPerWindow: 1,
  maxClosePerRun: 3,
  minAgeMs: 120000,
  keepRecentPerWindow: 1,
  maxWindows: 3,
  closeExtraWindows: false,
  keepPatterns: ['douyin\\.com/\\?recommend=1'],
  dataDir: '',
  opsPath: '',
})

const LIMITS = {
  intervalMs: [5000, 3600000],
  startDelayMs: [0, 600000],
  cooldownMs: [0, 3600000],
  activeGuardMs: [0, 3600000],
  requestTimeoutMs: [500, 30000],
  probeTimeoutMs: [300, 10000],
  maxTabsPerWindow: [1, 100],
  maxTabsTotal: [1, 500],
  minTabsPerWindow: [0, 10],
  maxClosePerRun: [1, 50],
  minAgeMs: [0, 86400000],
  keepRecentPerWindow: [0, 10],
  maxWindows: [1, 50],
}

function clamp(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function toPatterns(value) {
  let arr = []
  if (Array.isArray(value)) arr = value
  else if (typeof value === 'string') arr = value.split(/[\n,]/)
  return arr.map((s) => String(s).trim()).filter(Boolean)
}

export function normalizeConfig(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const cfg = Object.assign({}, DEFAULTS)
  for (const key of Object.keys(raw)) {
    if (raw[key] === undefined || raw[key] === null) continue
    cfg[key] = raw[key]
  }
  cfg.enabled = cfg.enabled !== false
  cfg.autoClose = cfg.autoClose !== false
  cfg.dryRun = cfg.dryRun === true
  cfg.closeExtraWindows = cfg.closeExtraWindows === true
  for (const key of Object.keys(LIMITS)) {
    const pair = LIMITS[key]
    cfg[key] = clamp(cfg[key], DEFAULTS[key], pair[0], pair[1])
  }
  cfg.cdpUrl = String(cfg.cdpUrl || DEFAULTS.cdpUrl).replace(/\/+$/, '')
  cfg.keepPatterns = toPatterns(cfg.keepPatterns)
  cfg.dataDir = String(cfg.dataDir || '')
  cfg.opsPath = String(cfg.opsPath || '')
  return cfg
}

export function matchesKeep(url, patterns) {
  const text = String(url || '')
  for (const pattern of patterns || []) {
    try {
      if (new RegExp(pattern, 'i').test(text)) return true
    } catch (err) {
      if (text.toLowerCase().includes(String(pattern).toLowerCase())) return true
    }
  }
  return false
}

function isBlankUrl(url) {
  return !url || /^(about:blank|edge:\/\/newtab|edge:\/\/startpage|chrome:\/\/newtab)\/?$/i.test(url)
}

function isErrorUrl(url) {
  return /error\.html|err_|chrome-error|about:neterror|\/404(?:[?#/]|$)/i.test(url)
}

function normalizeUrl(url) {
  return String(url || '').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()
}

/**
 * 返回 { over, victims, protected, counts, overBy }。
 * pages: [{ id, url, title, windowId, windowState, visible, focus, firstSeen }]
 */
export function decide(input) {
  const cfg = normalizeConfig((input && input.config) || {})
  const now = input && Number.isFinite(input.now) ? input.now : Date.now()
  const source = input && Array.isArray(input.pages) ? input.pages : []
  const pages = source.map((p) => ({
    id: String(p.id),
    url: String(p.url || ''),
    title: String(p.title || ''),
    windowId: Number.isFinite(p.windowId) ? p.windowId : 0,
    windowState: String(p.windowState || 'normal'),
    visible: p.visible === true ? true : p.visible === false ? false : null,
    focus: p.focus === true,
    firstSeen: Number.isFinite(p.firstSeen) ? p.firstSeen : now,
  }))

  const counts = new Map()
  const byWindow = new Map()
  for (const page of pages) {
    counts.set(page.windowId, (counts.get(page.windowId) || 0) + 1)
    if (!byWindow.has(page.windowId)) byWindow.set(page.windowId, [])
    byWindow.get(page.windowId).push(page)
  }

  const protectedMap = new Map()
  const protect = (id, reason) => {
    if (!protectedMap.has(id)) protectedMap.set(id, reason)
  }

  const urlCounts = new Map()
  for (const page of pages) {
    const key = normalizeUrl(page.url)
    urlCounts.set(key, (urlCounts.get(key) || 0) + 1)
  }

  for (const page of pages) {
    if (matchesKeep(page.url, cfg.keepPatterns)) {
      protect(page.id, 'keep')
    } else if (page.focus === true) {
      protect(page.id, 'active')
    } else if (page.windowState !== 'minimized' && page.visible === true) {
      protect(page.id, 'active')
    } else if (now - page.firstSeen < cfg.minAgeMs) {
      protect(page.id, 'new')
    }
  }

  for (const list of byWindow.values()) {
    const recent = list.slice().sort((a, b) => b.firstSeen - a.firstSeen).slice(0, cfg.keepRecentPerWindow)
    for (const page of recent) protect(page.id, 'recent')
  }

  const overTotal = pages.length > cfg.maxTabsTotal
  const overWindows = [...counts.entries()].filter(([, count]) => count > cfg.maxTabsPerWindow)
  const over = overTotal || overWindows.length > 0

  const bucketOf = (page) => {
    if (isBlankUrl(page.url)) return 0
    if (isErrorUrl(page.url)) return 1
    if ((urlCounts.get(normalizeUrl(page.url)) || 0) > 1) return 2
    return 3
  }
  const compare = (a, b) => {
    const ba = bucketOf(a)
    const bb = bucketOf(b)
    if (ba !== bb) return ba - bb
    if (a.firstSeen !== b.firstSeen) return a.firstSeen - b.firstSeen
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }

  const victims = []
  const remaining = new Set(pages.map((page) => page.id))
  const liveCounts = new Map(counts)
  const liveUrlCounts = new Map(urlCounts)
  if (over) {
    while (victims.length < cfg.maxClosePerRun) {
      const stillOverTotal = remaining.size > cfg.maxTabsTotal
      const stillOverWindow = [...liveCounts.entries()].some(([, count]) => count > cfg.maxTabsPerWindow)
      if (!stillOverTotal && !stillOverWindow) break
      const candidates = pages.filter((page) => {
        if (!remaining.has(page.id)) return false
        if (protectedMap.has(page.id)) return false
        if ((liveCounts.get(page.windowId) || 0) <= cfg.minTabsPerWindow) return false
        const urlKey = normalizeUrl(page.url)
        if ((urlCounts.get(urlKey) || 0) > 1 && (liveUrlCounts.get(urlKey) || 0) <= 1) return false
        return true
      })
      if (candidates.length === 0) break
      candidates.sort(compare)
      const pick = candidates[0]
      victims.push(pick)
      remaining.delete(pick.id)
      liveCounts.set(pick.windowId, (liveCounts.get(pick.windowId) || 0) - 1)
      const pickedUrl = normalizeUrl(pick.url)
      if (liveUrlCounts.has(pickedUrl)) liveUrlCounts.set(pickedUrl, Math.max(0, liveUrlCounts.get(pickedUrl) - 1))
    }
  }

  const windows = [...counts.entries()].map(([id, tabs]) => {
    const list = byWindow.get(id) || []
    const minimized = list.some((page) => page.windowState === 'minimized')
    const newest = list.reduce((acc, page) => Math.max(acc, page.firstSeen), 0)
    return { id, tabs, minimized, newestAt: newest }
  })

  return {
    over,
    overBy: {
      total: Math.max(0, pages.length - cfg.maxTabsTotal),
      windows: Math.max(0, ...windows.map((w) => w.tabs - cfg.maxTabsPerWindow)),
    },
    victims,
    protected: Object.fromEntries(protectedMap),
    counts: Object.fromEntries(counts),
    windows,
  }
}
