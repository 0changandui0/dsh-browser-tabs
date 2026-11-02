import { appendFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { appendHistory, emptyState, loadState, saveState } from './state.mjs'
import { decide, normalizeConfig } from './policy.mjs'
import { closeTarget, listPages, mapWindows, probeVisibility, sleep } from './cdp.mjs'

function errText(err) {
  return String((err && err.message) || err || '未知错误')
}

function idleMsOf(file) {
  try {
    return Date.now() - statSync(file).mtimeMs
  } catch (err) {
    return null
  }
}

export class BrowserTabKeeper {
  constructor(options) {
    const opts = options || {}
    this.config = normalizeConfig(opts.config || {})
    this.dataDir = String(opts.dataDir || '')
    this.logger = opts.logger || null
    this.state = this.dataDir ? loadState(this.dataDir) : emptyState()
    this.timer = null
    this.kickTimer = null
    this.busy = false
    this.lastAttemptAt = 0
  }

  trace(message) {
    if (!this.dataDir) return
    try {
      appendFileSync(join(this.dataDir, 'trace.log'), new Date().toISOString() + ' ' + message + '\n')
    } catch (err) {}
  }

  log(level, message) {
    const logger = this.logger
    if (!logger) return
    const fn = logger[level] || logger.info || logger.log
    if (typeof fn !== 'function') return
    try {
      fn.call(logger, '[browser-tabs] ' + message)
    } catch (err) {}
  }

  /** 设置页保存后热更新：合并、夹取、重设定时器；dataDir / opsPath 不变。 */
  updateConfig(patch) {
    const merged = Object.assign({}, this.config, patch && typeof patch === 'object' ? patch : {})
    this.config = normalizeConfig(merged)
    this.lastAttemptAt = 0
    this.stop()
    this.start()
    this.trace('config updated enabled=' + this.config.enabled + ' autoClose=' + this.config.autoClose)
    return this.config
  }

  limits() {
    const cfg = this.config
    return {
      maxTabsPerWindow: cfg.maxTabsPerWindow,
      maxTabsTotal: cfg.maxTabsTotal,
      maxClosePerRun: cfg.maxClosePerRun,
      minAgeMs: cfg.minAgeMs,
      activeGuardMs: cfg.activeGuardMs,
      autoClose: cfg.autoClose,
      enabled: cfg.enabled,
    }
  }

  guard() {
    const file = this.config.opsPath
    if (!file) return { active: false, idleMs: null, opsPath: '', thresholdMs: this.config.activeGuardMs }
    const idleMs = idleMsOf(file)
    if (idleMs === null) return { active: false, idleMs: null, opsPath: file, thresholdMs: this.config.activeGuardMs }
    return {
      active: idleMs < this.config.activeGuardMs,
      idleMs: idleMs,
      opsPath: file,
      thresholdMs: this.config.activeGuardMs,
    }
  }

  baseSummary(extra) {
    const base = {
      ok: true,
      at: Date.now(),
      source: 'auto',
      dryRun: this.config.dryRun,
      pages: 0,
      windows: 0,
      limits: this.limits(),
      over: false,
      overBy: { total: 0, windows: 0 },
      tabs: [],
      windowsInfo: [],
      guard: this.guard(),
      planned: [],
      closed: [],
      failed: [],
      remaining: 0,
      visibilityOk: true,
      windowsOk: true,
      reason: 'within-limits',
    }
    return Object.assign(base, extra || {})
  }

  async scan(options) {
    const opts = options || {}
    const cfg = this.config
    const source = opts.source || 'manual'
    const dryRun = opts.dryRun === undefined ? cfg.dryRun : opts.dryRun === true
    const force = opts.force === true
    if (this.busy) {
      return this.baseSummary({ source: source, dryRun: dryRun, ok: false, reason: 'busy', error: '上一次检查还没结束' })
    }
    this.busy = true
    const startedAt = Date.now()
    try {
      let listed
      try {
        listed = await listPages(cfg.cdpUrl, cfg.requestTimeoutMs)
      } catch (err) {
        const summary = this.baseSummary({ source: source, dryRun: dryRun })
        summary.ok = false
        summary.reason = 'cdp-unreachable'
        summary.error = '连不上浏览器调试口 ' + cfg.cdpUrl + '：' + errText(err)
        this.state.lastResult = this.compact(summary)
        this.trace('scan cdp error ' + summary.error)
        this.log('warn', summary.error)
        return summary
      }

      const beforeIds = new Set(Object.keys(this.state.firstSeen || {}))
      const seen = this.state.firstSeen && typeof this.state.firstSeen === 'object' ? this.state.firstSeen : {}
      const live = new Set()
      const pages = listed.map((item) => {
        const id = String(item.id)
        live.add(id)
        if (!Number.isFinite(seen[id])) seen[id] = startedAt
        return {
          id: id,
          url: item.url,
          title: item.title,
          ws: item.ws,
          firstSeen: seen[id],
          windowId: 0,
          windowState: 'unknown',
          visible: null,
          focus: false,
        }
      })
      for (const id of Object.keys(seen)) if (!live.has(id)) delete seen[id]
      this.state.firstSeen = seen
      const newIds = pages.filter((page) => !beforeIds.has(page.id)).length

      let windowsOk = true
      let windowMap = new Map()
      try {
        windowMap = await mapWindows(cfg.cdpUrl, pages, Math.max(cfg.requestTimeoutMs, 4000))
      } catch (err) {
        windowsOk = false
        this.log('warn', '读窗口信息失败，先按单窗口处理：' + errText(err))
      }
      for (const page of pages) {
        const win = windowMap.get(page.id)
        page.windowId = win ? win.windowId : 0
        page.windowState = win ? win.windowState : 'unknown'
      }

      const counts0 = new Map()
      for (const page of pages) counts0.set(page.windowId, (counts0.get(page.windowId) || 0) + 1)
      const overBefore = pages.length > cfg.maxTabsTotal || [...counts0.values()].some((n) => n > cfg.maxTabsPerWindow)

      let visibilityOk = true
      if (overBefore || source === 'status') {
        const vis = await probeVisibility(pages, cfg.probeTimeoutMs, 4)
        for (const page of pages) {
          const value = vis.get(page.id)
          if (value) {
            page.visible = value.visible
            page.focus = value.focus
          } else {
            page.visible = true
            page.focus = false
            visibilityOk = false
          }
        }
      }

      const plan = decide({ pages: pages, config: cfg, now: Date.now() })
      const guard = this.guard()
      const auto = source === 'auto'
      const blockedByMode = auto && !cfg.autoClose
      const blockedByGuard = guard.active && !force
      const shouldClose = !dryRun && !blockedByMode && !blockedByGuard && plan.victims.length > 0

      const closed = []
      const failed = []
      if (shouldClose) {
        for (const victim of plan.victims) {
          try {
            await closeTarget(cfg.cdpUrl, victim.id, cfg.requestTimeoutMs)
            closed.push({ id: victim.id, url: victim.url, title: victim.title })
          } catch (err) {
            failed.push({ id: victim.id, url: victim.url, error: errText(err) })
          }
          await sleep(120)
        }
        if (closed.length) {
          this.state.lastCleanupAt = Date.now()
          this.state.totalClosed = (Number(this.state.totalClosed) || 0) + closed.length
        }
      }

      let remaining = pages.length
      if (closed.length) {
        await sleep(400)
        try {
          remaining = (await listPages(cfg.cdpUrl, cfg.requestTimeoutMs)).length
        } catch (err) {
          remaining = Math.max(0, pages.length - closed.length)
        }
      }

      const closedIds = new Set(closed.map((item) => item.id))
      const plannedIds = new Set(plan.victims.map((item) => item.id))
      const tabs = pages.map((page) => ({
        id: page.id,
        url: page.url,
        title: page.title,
        windowId: page.windowId,
        windowState: page.windowState,
        ageSec: Math.max(0, Math.round((Date.now() - page.firstSeen) / 1000)),
        visible: page.visible,
        keep: plan.protected[page.id] || '',
        planned: plannedIds.has(page.id),
        closed: closedIds.has(page.id),
      }))

      const windowInfo = plan.windows.map((win) => Object.assign({}, win, {
        count: plan.counts[win.id] || 0,
      }))

      let reason = 'within-limits'
      if (plan.over) {
        if (plan.victims.length === 0) reason = 'nothing-safe-to-close'
        else if (dryRun) reason = 'dry-run'
        else if (blockedByMode) reason = 'auto-close-off'
        else if (blockedByGuard) reason = 'guard-active'
        else if (closed.length) reason = 'closed'
        else if (failed.length) reason = 'close-failed'
        else reason = 'nothing-closed'
      }
      if (source === 'status' && plan.over) reason = 'over'

      const summary = this.baseSummary({
        source: source,
        dryRun: dryRun,
        pages: pages.length,
        windows: plan.windows.length,
        over: plan.over,
        overBy: plan.overBy,
        tabs: tabs,
        windowsInfo: windowInfo,
        guard: guard,
        planned: plan.victims.map((item) => ({ id: item.id, url: item.url, title: item.title })),
        closed: closed,
        failed: failed,
        remaining: remaining,
        visibilityOk: visibilityOk,
        windowsOk: windowsOk,
        reason: reason,
      })
      this.state.lastResult = this.compact(summary)
      this.lastResult = summary
      this.state.lastScanAt = startedAt

      const changed = source !== 'auto' || newIds > 0 || closed.length > 0
      if (this.dataDir && changed) saveState(this.dataDir, this.state)
      if (this.dataDir && closed.length) {
        appendHistory(this.dataDir, {
          at: new Date().toISOString(),
          source: source,
          pages: pages.length,
          remaining: remaining,
          closed: closed,
          failed: failed,
        })
      }
      if (plan.over || closed.length) {
        this.trace('scan done pages=' + pages.length + ' windows=' + plan.windows.length + ' over=' + plan.over + ' closed=' + closed.length + ' reason=' + reason)
      }
      this.log(closed.length ? 'info' : 'debug', '检查完成：' + pages.length + ' 个标签页 / ' + plan.windows.length + ' 个窗口，关了 ' + closed.length + ' 个，剩 ' + remaining + ' 个')
      return summary
    } finally {
      this.busy = false
    }
  }

  compact(summary) {
    return {
      at: summary.at,
      source: summary.source,
      ok: summary.ok,
      reason: summary.reason,
      pages: summary.pages,
      windows: summary.windows,
      closed: Array.isArray(summary.closed) ? summary.closed.length : 0,
      remaining: summary.remaining,
      error: summary.error || '',
    }
  }

  tick() {
    if (!this.config.enabled || this.busy) return
    const now = Date.now()
    if (now - this.lastAttemptAt < this.config.cooldownMs) return
    this.lastAttemptAt = now
    this.scan({ source: 'auto' }).catch((err) => this.log('warn', '自动检查失败：' + errText(err)))
  }

  start() {
    if (this.timer || this.kickTimer) return
    if (!this.config.enabled) {
      this.log('info', '自动清理已关闭（enabled=false）')
      return
    }
    const delay = Math.max(0, Math.min(this.config.startDelayMs, this.config.intervalMs))
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null
      this.tick()
    }, delay)
    if (this.kickTimer.unref) this.kickTimer.unref()
    this.timer = setInterval(() => this.tick(), this.config.intervalMs)
    if (this.timer.unref) this.timer.unref()
    this.trace('started interval=' + this.config.intervalMs + ' delay=' + delay)
    this.log('info', '自动清理已启动：每 ' + Math.round(this.config.intervalMs / 1000) + ' 秒检查一次，上限每窗口 ' + this.config.maxTabsPerWindow + ' 个、总共 ' + this.config.maxTabsTotal + ' 个')
  }

  stop() {
    this.trace('stopped')
    if (this.kickTimer) {
      clearTimeout(this.kickTimer)
      this.kickTimer = null
    }
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
