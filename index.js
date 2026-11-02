import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BrowserTabKeeper } from './lib/keeper.mjs'
import { DEFAULTS, normalizeConfig } from './lib/policy.mjs'
import { pickSettings, readHistory, readSettings, settingsFile, writeSettings } from './lib/settings.mjs'

export const name = 'dsh-browser-tabs'

const KEEP_LABEL = {
  keep: '保留规则',
  active: '正在用',
  new: '刚打开',
  recent: '最近的',
  minimized: '窗口最小化',
}

function shortUrl(url, max) {
  let text = String(url || '')
  text = text.replace(/^https?:\/\//, '')
  const limit = max || 100
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text
}

function formatStatus(summary) {
  if (!summary || summary.ok !== true) {
    return '看不了浏览器：' + ((summary && (summary.error || summary.reason)) || '未知错误')
  }
  const lines = []
  lines.push('浏览器：' + summary.pages + ' 个标签页 / ' + summary.windows + ' 个窗口' + (summary.over ? '（超过上限）' : '（在上限内）'))
  const limits = summary.limits || {}
  lines.push('上限：每窗口 ' + limits.maxTabsPerWindow + ' 个、总共 ' + limits.maxTabsTotal + ' 个；一次最多关 ' + limits.maxClosePerRun + ' 个；新标签 ' + Math.round((limits.minAgeMs || 0) / 1000) + ' 秒内不关')
  const guard = summary.guard || {}
  if (guard.active) {
    lines.push('现在有会话正在操作浏览器（' + Math.round((guard.idleMs || 0) / 1000) + ' 秒前），自动清理会让路')
  } else if (Number.isFinite(guard.idleMs)) {
    lines.push('浏览器已闲置 ' + Math.round(guard.idleMs / 1000) + ' 秒')
  }
  if (!summary.windowsOk) lines.push('窗口归属没读到，已按单窗口保守处理')
  if (!summary.visibilityOk) lines.push('有页面没回应“是否可见”，已按正在用保守保留')
  for (const win of summary.windowsInfo || []) {
    lines.push('窗口 ' + win.id + '：' + win.tabs + ' 个' + (win.minimized ? '（最小化）' : ''))
  }
  const tabs = (summary.tabs || []).slice().sort((a, b) => b.ageSec - a.ageSec)
  const shown = tabs.slice(0, 40)
  for (const tab of shown) {
    const flags = []
    if (tab.closed) flags.push('已关')
    else if (tab.planned) flags.push(summary.dryRun ? '预演会关' : '计划关')
    if (tab.keep) flags.push(KEEP_LABEL[tab.keep] || tab.keep)
    const prefix = tab.visible && tab.windowState !== 'minimized' ? '[在用] ' : ''
    lines.push('  ' + prefix + shortUrl(tab.url, 95) + (flags.length ? '  <- ' + flags.join('、') : '') + '  (' + tab.ageSec + ' 秒)')
  }
  if (tabs.length > shown.length) lines.push('  ……还有 ' + (tabs.length - shown.length) + ' 个没列出')
  if (summary.over && summary.reason === 'nothing-safe-to-close') lines.push('超了，但没有能安全关的（都被规则留着）')
  return lines.join('\n')
}

function formatClean(summary, dryRun) {
  if (!summary || summary.ok !== true) {
    return '没清成：' + ((summary && (summary.error || summary.reason)) || '未知错误')
  }
  const lines = []
  const closed = summary.closed || []
  const planned = summary.planned || []
  if (dryRun) {
    lines.push(planned.length ? '预演：会关 ' + planned.length + ' 个，现在有 ' + summary.pages + ' 个' : '预演：没有要关的，现在 ' + summary.pages + ' 个标签页' + (summary.over ? '（超了但都被规则留着）' : ''))
  } else if (closed.length) {
    lines.push('关了 ' + closed.length + ' 个，剩 ' + summary.remaining + ' 个')
  } else if (summary.reason === 'guard-active') {
    lines.push('没动手：浏览器刚刚还有人操作（' + Math.round((summary.guard.idleMs || 0) / 1000) + ' 秒前），自动清理先让路；确实要关可以 force=true')
  } else if (summary.reason === 'nothing-safe-to-close') {
    lines.push('没动手：虽然超了，但剩下的都被规则留着（正在用/刚打开/保留规则）')
  } else if (summary.over) {
    lines.push('没动手：没有可安全关闭的页面')
  } else {
    lines.push('没动手：现在 ' + summary.pages + ' 个标签页，在上限内')
  }
  const targets = dryRun ? planned : closed
  for (const item of targets) lines.push('  - ' + shortUrl(item.url || item.title, 110))
  for (const item of summary.failed || []) lines.push('  ! 关失败 ' + shortUrl(item.url, 90) + '：' + (item.error || ''))
  lines.push('上限：每窗口 ' + summary.limits.maxTabsPerWindow + ' 个、总共 ' + summary.limits.maxTabsTotal + ' 个')
  return lines.join('\n')
}

function errorSummary(err) {
  return { ok: false, error: String((err && err.message) || err) }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function isSameOrigin(origin, host) {
  if (!origin) return true
  try {
    const url = new URL(origin)
    return !!host && url.host.toLowerCase() === String(host).toLowerCase()
  } catch (err) {
    return false
  }
}

function readJsonBody(req, limit) {
  const max = limit || 256 * 1024
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (status, message) => {
      if (settled) return
      settled = true
      const err = new Error(message)
      err.statusCode = status
      reject(err)
    }
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > max) {
        fail(413, '请求体太大')
        try { req.destroy() } catch (err) {}
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        const bad = new Error('请求体不是 JSON')
        bad.statusCode = 400
        reject(bad)
      }
    })
    req.on('error', (err) => fail(400, err && err.message ? err.message : '读取请求失败'))
  })
}

function publicConfig(cfg) {
  return pickSettings(cfg)
}

export function apply(ctx, config) {
  const logger = ctx && ctx.logger
  let keeper = null
  let dataDir = ''
  let boot = () => {}
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    const baseCfg = normalizeConfig(config || {})
    const baseDir = baseCfg.dataDir || join(home, 'browser-tabs')
    mkdirSync(baseDir, { recursive: true })
    // 设置页只写 UI 能改的键；启动时覆盖在 bundle 默认之上。
    const overrides = readSettings(baseDir)
    const cfg = normalizeConfig(Object.assign({}, baseCfg, overrides))
    dataDir = cfg.dataDir || baseDir
    mkdirSync(dataDir, { recursive: true })
    boot = (step, extra) => {
      try {
        appendFileSync(join(dataDir, 'boot.log'), JSON.stringify(Object.assign({
          at: new Date().toISOString(),
          pid: process.pid,
          step: step,
        }, extra || {})) + '\n')
      } catch (err) {}
    }
    boot('init', {
      enabled: cfg.enabled,
      autoClose: cfg.autoClose,
      maxTabsPerWindow: cfg.maxTabsPerWindow,
      maxTabsTotal: cfg.maxTabsTotal,
      keepPatterns: cfg.keepPatterns.join('|'),
      settings: Object.keys(overrides).length,
      settingsFile: settingsFile(dataDir),
    })
    keeper = new BrowserTabKeeper({
      config: Object.assign({}, cfg, { opsPath: cfg.opsPath || join(home, 'browser-service', 'ops.jsonl') }),
      dataDir: dataDir,
      logger: logger,
    })
    boot('keeper-created')
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => keeper.stop(), 'browser-tabs: 定时清理')
    }
    boot('effect-registered')
    boot('init-ok')
  } catch (err) {
    boot('init-error', { error: String((err && err.message) || err) })
    if (logger && logger.warn) logger.warn('[browser-tabs] 初始化失败：' + ((err && err.message) || err))
    return
  }

  try {
  const tools = ctx.get('tools')
  if (!tools || typeof tools.register !== 'function') {
    if (logger && logger.warn) logger.warn('[browser-tabs] 没有 tools 服务，只跑定时清理，不注册工具')
  } else {
    tools.register({
      name: 'browser_tabs_status',
      description: '看一眼 DSH 浏览器（CDP 9227）现在有多少窗口/标签页、有没有超过上限、哪些会被保留、哪些可能被自动清理。只读，不会关任何页面。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            pages: { type: 'number' },
            windows: { type: 'number' },
            over: { type: 'boolean' },
            text: { type: 'string' },
          },
          required: ['ok', 'pages', 'windows', 'over', 'text'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: value && value.text ? value.text : '' }],
      },
      async execute() {
        try {
          const summary = await keeper.scan({ dryRun: true, source: 'status' })
          return {
            ok: summary.ok === true,
            pages: summary.pages || 0,
            windows: summary.windows || 0,
            over: summary.over === true,
            text: formatStatus(summary),
          }
        } catch (err) {
          const summary = errorSummary(err)
          return { ok: false, pages: 0, windows: 0, over: false, text: '看不了浏览器：' + summary.error }
        }
      },
    })

    tools.register({
      name: 'browser_tabs_clean',
      description: '清理 DSH 浏览器里过多的标签页：默认只预演（dryRun=true）不真关；传 dryRun=false 才动手。关的顺序是空白页/报错页/重复页/最老的普通页，正在用的、刚开的、命中保留规则的一律不动。',
      parameters: {
        type: 'object',
        properties: {
          dryRun: { type: 'boolean', description: 'true=只预演不关（默认），false=真的关' },
          force: { type: 'boolean', description: 'true=无视“浏览器刚被操作过”的保护，强制清理' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            dryRun: { type: 'boolean' },
            closed: { type: 'number' },
            remaining: { type: 'number' },
            text: { type: 'string' },
          },
          required: ['ok', 'dryRun', 'closed', 'remaining', 'text'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: value && value.text ? value.text : '' }],
      },
      async execute(args) {
        const dryRun = !(args && args.dryRun === false)
        const force = !!(args && args.force === true)
        try {
          const summary = await keeper.scan({ dryRun: dryRun, force: force, source: 'manual' })
          return {
            ok: summary.ok === true,
            dryRun: dryRun,
            closed: Array.isArray(summary.closed) ? summary.closed.length : 0,
            remaining: summary.remaining || 0,
            text: formatClean(summary, dryRun),
          }
        } catch (err) {
          return {
            ok: false,
            dryRun: dryRun,
            closed: 0,
            remaining: 0,
            text: '清理失败：' + String((err && err.message) || err),
          }
        }
      },
    })
  }
  boot('tools-ok')
  } catch (err) {
    boot('tools-error', { error: String((err && err.message) || err) })
  }


  // ── 设置页的宿主接口 ────────────────────────────────────────────────
  // webServer 不能写进静态 inject：headless profile 没有它，整个插件会 pending。
  // 用 ctx.inject 等服务就绪，再退到每秒轮询；定时器 unref，不挡进程退出。
  try {
    const handleApi = async (req, res) => {
      if (!isSameOrigin(req.headers && req.headers.origin, req.headers && req.headers.host)) {
        return sendJson(res, 403, { ok: false, error: '跨站请求被拒（只接受同源）' })
      }
      const url = new URL(req.url, 'http://127.0.0.1')
      const sub = url.pathname.replace(/^\/api\/browser-tabs/, '').replace(/\/+$/, '') || '/'
      try {
        if (req.method === 'GET' && sub === '/state') {
          const summary = await keeper.scan({ dryRun: true, source: 'status' })
          return sendJson(res, 200, {
            ok: true,
            summary: summary,
            text: formatStatus(summary),
            config: publicConfig(keeper.config),
            defaults: pickSettings(DEFAULTS),
            history: readHistory(dataDir, 8),
            dataDir: dataDir,
            settingsFile: settingsFile(dataDir),
          })
        }
        if (req.method === 'POST' && sub === '/config') {
          const body = await readJsonBody(req)
          const source = body && typeof body.config === 'object' && body.config ? body.config : body
          const patch = pickSettings(source)
          if (!Object.keys(patch).length) {
            return sendJson(res, 400, { ok: false, error: '没有可保存的设置项' })
          }
          const next = normalizeConfig(Object.assign({}, keeper.config, patch))
          writeSettings(dataDir, next)
          const applied = keeper.updateConfig(patch)
          boot('settings-saved', { keys: Object.keys(patch) })
          return sendJson(res, 200, {
            ok: true,
            config: publicConfig(applied),
            text: '设置已保存，新的节奏马上生效',
          })
        }
        if (req.method === 'POST' && sub === '/clean') {
          const body = await readJsonBody(req)
          const dryRun = body.dryRun !== false
          const force = body.force === true
          const summary = await keeper.scan({ dryRun: dryRun, force: force, source: 'manual' })
          const text = formatClean(summary, dryRun)
          return sendJson(res, 200, {
            ok: summary.ok === true,
            dryRun: dryRun,
            force: force,
            summary: summary,
            text: text,
            config: publicConfig(keeper.config),
            history: readHistory(dataDir, 8),
          })
        }

        return sendJson(res, 404, { ok: false, error: '没有这个接口' })
      } catch (err) {
        const status = Number(err && err.statusCode) || 500
        const message = String((err && err.message) || err)
        if (status >= 500) boot('route-error', { error: message })
        return sendJson(res, status, { ok: false, error: message })
      }
    }

    let mounted = false
    const mountRoutes = (webServer) => {
      if (mounted || !webServer || typeof webServer.register !== 'function') return false
      try {
        ctx.effect(() => webServer.register({
          kind: 'prefix',
          path: '/api/browser-tabs',
          handler: handleApi,
        }), 'browser-tabs: 设置页接口')
        mounted = true
        boot('routes-ok')
        return true
      } catch (err) {
        boot('routes-error', { error: String((err && err.message) || err) })
        return false
      }
    }

    let server
    try { server = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined } catch (err) { server = undefined }
    if (!mountRoutes(server) && typeof ctx.inject === 'function') {
      try {
        ctx.inject(['webServer'], (c) => { mountRoutes(c && c.webServer) })
      } catch (err) {
        boot('routes-inject-error', { error: String((err && err.message) || err) })
      }
    }
    if (!mounted) {
      boot('routes-wait')
      const timer = setInterval(() => {
        try {
          let s
          try { s = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined } catch (err) { s = undefined }
          if (mountRoutes(s)) clearInterval(timer)
        } catch (err) {}
      }, 1000)
      if (timer.unref) timer.unref()
      if (typeof ctx.effect === 'function') ctx.effect(() => () => clearInterval(timer), 'browser-tabs: 等 webServer')
    }
  } catch (err) {
    boot('routes-fatal', { error: String((err && err.message) || err) })
  }

  try {
    if (keeper) keeper.start()
    boot('started')
  } catch (err) {
    boot('start-error', { error: String((err && err.message) || err) })
  }
}
