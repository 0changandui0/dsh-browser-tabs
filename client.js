/**
 * dsh-browser-tabs —— 浏览器半端（设置里的「浏览器标签页」）
 *
 * 只做一件事：把管家跑出来的状态画出来，并让用户改阈值。
 * 数据全部走 /api/browser-tabs，不在这里直接连 CDP。
 */
window.__ModuleLoader__.load({
  id: 'dsh-browser-tabs',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/browser-tabs'

    const parse = async (res) => {
      const text = await res.text()
      let value
      try {
        value = JSON.parse(text)
      } catch (err) {
        throw new Error('接口返回的不是 JSON（HTTP ' + res.status + '）：' + text.slice(0, 120))
      }
      if (!res.ok || value.ok === false) throw new Error(value.error || ('HTTP ' + res.status))
      return value
    }
    const jget = async (path) => parse(await fetch(API + path, { credentials: 'same-origin' }))
    const jpost = async (path, body) => parse(await fetch(API + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))

    const CSS = `
      .bt {
        --bt-bg: #f5f7fb;
        --bt-surface: #ffffff;
        --bt-soft: #f8fafc;
        --bt-border: #e3e9f2;
        --bt-border-strong: #cbd5e1;
        --bt-text: #0f172a;
        --bt-sec: #475569;
        --bt-muted: #7c8ba1;
        --bt-primary: #2563eb;
        --bt-primary-hover: #1d4ed8;
        --bt-primary-soft: #eff6ff;
        --bt-ok: #15803d;
        --bt-ok-bg: #f0fdf4;
        --bt-warn: #b45309;
        --bt-warn-bg: #fffbeb;
        --bt-bad: #b91c1c;
        --bt-bad-bg: #fef2f2;
        --bt-radius: 14px;
        --bt-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 8px 24px rgba(15, 23, 42, .04);
        padding: 18px 20px 40px;
        max-width: 860px;
        margin: 0 auto;
        font-size: 13.5px;
        line-height: 1.55;
        color: var(--bt-text);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
      }
      .bt *, .bt *::before, .bt *::after { box-sizing: border-box; }
      .bt-hero {
        background: linear-gradient(135deg, #ffffff 0%, #f2f7ff 100%);
        border: 1px solid #dbe7f7;
        border-radius: 18px;
        padding: 18px 20px;
        box-shadow: var(--bt-shadow);
        margin-bottom: 14px;
      }
      .bt-kicker {
        font-size: 11px;
        letter-spacing: .12em;
        text-transform: uppercase;
        color: var(--bt-muted);
        font-weight: 700;
        margin-bottom: 4px;
      }
      .bt-title { margin: 0; font-size: 20px; line-height: 1.3; letter-spacing: -.01em; }
      .bt-sub { margin: 6px 0 0; color: var(--bt-sec); font-size: 13px; }
      .bt-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      .bt-chip {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 4px 10px; border-radius: 999px;
        font-size: 12px; font-weight: 600;
        background: #f1f5f9; color: var(--bt-sec);
        border: 1px solid transparent;
      }
      .bt-chip.ok { background: var(--bt-ok-bg); color: var(--bt-ok); border-color: #bbf7d0; }
      .bt-chip.warn { background: var(--bt-warn-bg); color: var(--bt-warn); border-color: #fde68a; }
      .bt-chip.bad { background: var(--bt-bad-bg); color: var(--bt-bad); border-color: #fecaca; }
      .bt-toast {
        display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;
        padding: 10px 14px; margin-bottom: 12px;
        border-radius: 12px; font-size: 13px; white-space: pre-wrap;
        box-shadow: var(--bt-shadow);
      }
      .bt-toast.ok { background: var(--bt-ok-bg); border: 1px solid #bbf7d0; color: var(--bt-ok); }
      .bt-toast.err { background: var(--bt-bad-bg); border: 1px solid #fecaca; color: var(--bt-bad); }
      .bt-toast.info { background: var(--bt-primary-soft); border: 1px solid #bfdbfe; color: #1e40af; }
      .bt-toast-x {
        border: 0; background: transparent; color: inherit; opacity: .6;
        cursor: pointer; font-size: 16px; line-height: 1; padding: 1px 5px; border-radius: 5px;
      }
      .bt-toast-x:hover { opacity: 1; background: rgba(0,0,0,.06); }
      .bt-stats {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 10px; margin-bottom: 14px;
      }
      .bt-stat {
        background: var(--bt-surface); border: 1px solid var(--bt-border);
        border-radius: var(--bt-radius); padding: 12px 14px; box-shadow: var(--bt-shadow);
      }
      .bt-stat-k { font-size: 12px; color: var(--bt-muted); margin-bottom: 4px; }
      .bt-stat-v { font-size: 20px; font-weight: 700; letter-spacing: -.01em; }
      .bt-stat-v small { font-size: 12px; font-weight: 600; color: var(--bt-muted); margin-left: 4px; }
      .bt-stat.ok .bt-stat-v { color: var(--bt-ok); }
      .bt-stat.warn .bt-stat-v { color: var(--bt-warn); }
      .bt-card {
        background: var(--bt-surface); border: 1px solid var(--bt-border);
        border-radius: var(--bt-radius); padding: 16px 18px;
        box-shadow: var(--bt-shadow); margin-bottom: 14px;
      }
      .bt-card-h { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 3px; }
      .bt-card-t { font-size: 14.5px; font-weight: 700; }
      .bt-card-sub { color: var(--bt-muted); font-size: 12px; margin-bottom: 12px; }
      .bt-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
      .bt-field { display: flex; flex-direction: column; gap: 5px; }
      .bt-field > span { font-size: 12px; color: var(--bt-sec); font-weight: 600; }
      .bt-field > em { font-style: normal; color: var(--bt-muted); font-size: 11px; }
      .bt-input, .bt-textarea {
        width: 100%; border: 1px solid var(--bt-border-strong); border-radius: 9px;
        background: #fff; color: var(--bt-text);
        padding: 8px 10px; font-size: 13px; font-family: inherit;
        outline: none; transition: border-color .15s, box-shadow .15s;
      }
      .bt-input:focus, .bt-textarea:focus { border-color: var(--bt-primary); box-shadow: 0 0 0 3px rgba(37,99,235,.12); }
      .bt-textarea { min-height: 76px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.6; }
      .bt-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px dashed var(--bt-border); }
      .bt-switch-row:first-of-type { padding-top: 0; }
      .bt-switch-row:last-of-type { border-bottom: 0; padding-bottom: 0; }
      .bt-switch-copy { min-width: 0; }
      .bt-switch-t { font-weight: 650; font-size: 13px; }
      .bt-switch-d { color: var(--bt-muted); font-size: 12px; margin-top: 1px; }
      .bt-switch { position: relative; display: inline-flex; flex: none; width: 42px; height: 24px; }
      .bt-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
      .bt-switch-track {
        width: 100%; height: 100%; border-radius: 999px; background: #cbd5e1;
        transition: background .18s; pointer-events: none;
      }
      .bt-switch-thumb {
        position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%;
        background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,.28);
        transition: transform .18s; pointer-events: none;
      }
      .bt-switch input:checked + .bt-switch-track { background: var(--bt-primary); }
      .bt-switch input:checked ~ .bt-switch-thumb { transform: translateX(18px); }
      .bt-switch input:focus-visible + .bt-switch-track { box-shadow: 0 0 0 3px rgba(37,99,235,.2); }
      .bt-actions { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; margin-top: 14px; }
      .bt-btn {
        border: 1px solid var(--bt-border-strong); background: #fff; color: var(--bt-text);
        border-radius: 9px; padding: 7px 13px; font-size: 13px; font-weight: 600;
        cursor: pointer; font-family: inherit; transition: background .15s, border-color .15s, transform .06s;
      }
      .bt-btn:hover:not(:disabled) { background: var(--bt-soft); border-color: #b6c2d4; }
      .bt-btn:active:not(:disabled) { transform: translateY(1px); }
      .bt-btn:disabled { opacity: .55; cursor: default; }
      .bt-btn.primary { background: var(--bt-primary); border-color: var(--bt-primary); color: #fff; }
      .bt-btn.primary:hover:not(:disabled) { background: var(--bt-primary-hover); border-color: var(--bt-primary-hover); }
      .bt-btn.danger { background: var(--bt-bad-bg); border-color: #fecaca; color: var(--bt-bad); }
      .bt-btn.danger:hover:not(:disabled) { background: #fee2e2; }
      .bt-hint { color: var(--bt-muted); font-size: 12px; }
      .bt-warn-line { color: var(--bt-bad); font-size: 12px; margin-top: 6px; }
      .bt-check { display: inline-flex; align-items: center; gap: 6px; color: var(--bt-sec); font-size: 12.5px; cursor: pointer; }
      .bt-check input { accent-color: var(--bt-primary); width: 15px; height: 15px; }
      .bt-table-wrap { overflow-x: auto; border: 1px solid var(--bt-border); border-radius: 10px; }
      .bt-table { width: 100%; border-collapse: collapse; min-width: 620px; }
      .bt-table th, .bt-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--bt-border); vertical-align: top; }
      .bt-table tr:last-child td { border-bottom: 0; }
      .bt-table th { font-size: 11.5px; color: var(--bt-muted); font-weight: 700; background: var(--bt-soft); }
      .bt-table td { font-size: 12.5px; }
      .bt-url { max-width: 440px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .bt-tag { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; background: #f1f5f9; color: var(--bt-sec); margin-right: 4px; white-space: nowrap; }
      .bt-tag.ok { background: var(--bt-ok-bg); color: var(--bt-ok); }
      .bt-tag.warn { background: var(--bt-warn-bg); color: var(--bt-warn); }
      .bt-tag.bad { background: var(--bt-bad-bg); color: var(--bt-bad); }
      .bt-pre {
        margin: 10px 0 0; padding: 12px 14px; border-radius: 10px;
        background: #0f172a; color: #dbeafe; font-size: 12px; line-height: 1.65;
        white-space: pre-wrap; word-break: break-word; overflow-x: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .bt-history { margin: 0; padding: 0; list-style: none; }
      .bt-history li { display: flex; gap: 8px; align-items: baseline; padding: 6px 0; border-bottom: 1px dashed var(--bt-border); font-size: 12.5px; }
      .bt-history li:last-child { border-bottom: 0; }
      .bt-history time { color: var(--bt-muted); font-variant-numeric: tabular-nums; flex: none; }
      .bt-empty { padding: 18px; text-align: center; color: var(--bt-muted); font-size: 12.5px; }
      .bt-loading { padding: 40px 20px; text-align: center; color: var(--bt-muted); }
      @media (max-width: 640px) {
        .bt { padding: 14px 14px 32px; }
        .bt-hero { padding: 15px 16px; }
        .bt-card { padding: 14px; }
      }
    `

    const REASON_TEXT = {
      'within-limits': '在上限内',
      over: '超过上限',
      'nothing-safe-to-close': '超了，但都被规则留着',
      'guard-active': '浏览器正在被操作，先让路',
      'auto-close-off': '自动清理已关闭',
      'dry-run': '预演',
      closed: '刚清理过',
      'close-failed': '关闭失败',
      'nothing-closed': '没有关成',
      busy: '上一次检查还没结束',
      'cdp-unreachable': '连不上浏览器',
    }

    const KEEP_TEXT = {
      keep: '保留规则',
      active: '正在用',
      new: '刚打开',
      recent: '最近保留',
      minimized: '窗口最小化',
    }

    function seconds(ms) {
      const n = Number(ms)
      return Number.isFinite(n) ? Math.round(n / 100) / 10 : 0
    }

    function splitPatterns(value) {
      return String(value || '').split(String.fromCharCode(10)).join(',').split(',').map((s) => s.trim()).filter(Boolean)
    }

    function fromConfig(cfg) {
      const c = cfg || {}
      return {
        enabled: c.enabled !== false,
        autoClose: c.autoClose !== false,
        intervalSec: String(seconds(c.intervalMs === undefined ? 30000 : c.intervalMs)),
        cooldownSec: String(seconds(c.cooldownMs === undefined ? 90000 : c.cooldownMs)),
        activeGuardSec: String(seconds(c.activeGuardMs === undefined ? 120000 : c.activeGuardMs)),
        maxTabsPerWindow: String(c.maxTabsPerWindow === undefined ? 8 : c.maxTabsPerWindow),
        maxTabsTotal: String(c.maxTabsTotal === undefined ? 12 : c.maxTabsTotal),
        maxClosePerRun: String(c.maxClosePerRun === undefined ? 3 : c.maxClosePerRun),
        minAgeSec: String(seconds(c.minAgeMs === undefined ? 120000 : c.minAgeMs)),
        keepRecentPerWindow: String(c.keepRecentPerWindow === undefined ? 1 : c.keepRecentPerWindow),
        keepPatterns: Array.isArray(c.keepPatterns) ? c.keepPatterns.join(String.fromCharCode(10)) : String(c.keepPatterns || ''),
      }
    }

    function toConfig(form) {
      const num = (value, fallback) => {
        const n = Number(value)
        return Number.isFinite(n) ? n : fallback
      }
      return {
        enabled: form.enabled,
        autoClose: form.autoClose,
        intervalMs: Math.round(num(form.intervalSec, 30) * 1000),
        cooldownMs: Math.round(num(form.cooldownSec, 90) * 1000),
        activeGuardMs: Math.round(num(form.activeGuardSec, 120) * 1000),
        maxTabsPerWindow: Math.round(num(form.maxTabsPerWindow, 8)),
        maxTabsTotal: Math.round(num(form.maxTabsTotal, 12)),
        maxClosePerRun: Math.round(num(form.maxClosePerRun, 3)),
        minAgeMs: Math.round(num(form.minAgeSec, 120) * 1000),
        keepRecentPerWindow: Math.round(num(form.keepRecentPerWindow, 1)),
        keepPatterns: splitPatterns(form.keepPatterns),
      }
    }

    function ageText(sec) {
      const n = Math.max(0, Number(sec) || 0)
      if (n < 60) return '刚刚'
      if (n < 3600) return Math.floor(n / 60) + ' 分钟'
      if (n < 86400) return Math.floor(n / 3600) + ' 小时'
      return Math.floor(n / 86400) + ' 天'
    }

    function shortUrl(url) {
      let text = String(url || '')
      if (text.startsWith('https://')) text = text.slice(8)
      else if (text.startsWith('http://')) text = text.slice(7)
      return text.length > 80 ? text.slice(0, 79) + '…' : (text || '(空白页)')
    }

    function timeText(iso) {
      if (!iso) return ''
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return String(iso)
      const p = (n) => String(n).padStart(2, '0')
      return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }

    const Switch = ({ on, onChange, title, desc }) => h('div', { className: 'bt-switch-row' }, [
      h('div', { key: 'c', className: 'bt-switch-copy' }, [
        h('div', { key: 't', className: 'bt-switch-t' }, title),
        desc ? h('div', { key: 'd', className: 'bt-switch-d' }, desc) : null,
      ]),
      h('label', { key: 's', className: 'bt-switch' }, [
        h('input', { key: 'i', type: 'checkbox', checked: !!on, onChange: (e) => onChange(e.target.checked) }),
        h('span', { key: 't', className: 'bt-switch-track' }),
        h('span', { key: 'b', className: 'bt-switch-thumb' }),
      ]),
    ])

    const NumField = ({ label, value, onChange, unit, hint, min, max, step }) => h('label', { className: 'bt-field' }, [
      h('span', { key: 'l' }, label),
      h('input', {
        key: 'i',
        className: 'bt-input',
        type: 'number',
        inputMode: 'numeric',
        value: value,
        min: min,
        max: max,
        step: step === undefined ? 1 : step,
        onChange: (e) => onChange(e.target.value),
      }),
      h('em', { key: 'h' }, unit ? unit + (hint ? ' · ' + hint : '') : (hint || '')),
    ])

    function Panel() {
      const [data, setData] = React.useState(null)
      const [form, setForm] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState(null)
      const [result, setResult] = React.useState('')
      const [force, setForce] = React.useState(false)
      const [dirty, setDirty] = React.useState(false)

      const load = React.useCallback(async () => {
        setBusy('load')
        try {
          const d = await jget('/state')
          setData(d)
          setForm(fromConfig(d.config))
          setDirty(false)
          if (d.summary && d.summary.ok === false) {
            setMsg({ kind: 'err', text: d.summary.error || '这次没读到浏览器状态' })
          }
        } catch (err) {
          setMsg({ kind: 'err', text: '读设置失败：' + String(err.message || err) })
        } finally {
          setBusy('')
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      const set = (key, value) => {
        setForm((prev) => Object.assign({}, prev, { [key]: value }))
        setDirty(true)
      }

      const save = async () => {
        if (!form) return
        setBusy('save')
        try {
          const body = toConfig(form)
          const res = await jpost('/config', { config: body })
          setForm(fromConfig(res.config))
          setDirty(false)
          setMsg({ kind: 'ok', text: res.text || '设置已保存' })
          setData((prev) => Object.assign({}, prev, { config: res.config }))
        } catch (err) {
          setMsg({ kind: 'err', text: '保存失败：' + String(err.message || err) })
        } finally {
          setBusy('')
        }
      }

      const reset = () => {
        if (!data || !data.defaults) return
        setForm(fromConfig(data.defaults))
        setDirty(true)
        setMsg({ kind: 'info', text: '已填回默认值；点「保存设置」才会真正写进去。' })
      }

      const clean = async (dryRun) => {
        if (!dryRun) {
          const n = data && data.summary ? data.summary.planned.length : 0
          const text = '真的要关掉这些标签页吗？' + String.fromCharCode(10, 10) + '这次计划关 ' + n + ' 个。正在用的、刚打开的、命中保留规则的都不会动。'
          if (!window.confirm(text)) return
        }
        setBusy(dryRun ? 'preview' : 'clean')
        try {
          const res = await jpost('/clean', { dryRun: dryRun, force: dryRun ? false : force })
          setResult(res.text || '')
          setMsg({
            kind: res.ok ? 'ok' : 'err',
            text: res.ok ? (dryRun ? '预演完成，下面是会关的页面。' : '清理完成。') : '这次没清成，原因见下面的输出。',
          })
          setData((prev) => Object.assign({}, prev, {
            summary: res.summary,
            text: res.text,
            history: res.history || (prev && prev.history) || [],
          }))
        } catch (err) {
          setMsg({ kind: 'err', text: (dryRun ? '预演' : '清理') + '失败：' + String(err.message || err) })
        } finally {
          setBusy('')
        }
      }

      if (!data || !form) {
        return h('div', { className: 'bt' }, [
          h('div', { key: 'l', className: 'bt-loading' }, busy === 'load' ? '正在读取浏览器状态…' : '还没有数据'),
          msg ? h('div', { key: 'm', className: 'bt-toast ' + msg.kind }, msg.text) : null,
        ])
      }

      const s = data.summary || {}
      const over = s.over === true
      const tabs = Array.isArray(s.tabs) ? s.tabs.slice().sort((a, b) => (a.windowId - b.windowId) || (b.ageSec - a.ageSec)) : []
      const badPatterns = splitPatterns(form.keepPatterns).filter((p) => {
        try { new RegExp(p); return false } catch (err) { return true }
      })
      const history = Array.isArray(data.history) ? data.history.slice().reverse() : []
      const overCount = Math.max(0, (s.overBy && s.overBy.total) || 0, (s.overBy && s.overBy.windows) || 0)

      return h('div', { className: 'bt' }, [
        h('div', { key: 'hero', className: 'bt-hero' }, [
          h('div', { key: 'k', className: 'bt-kicker' }, 'DSH · 浏览器管家'),
          h('h1', { key: 't', className: 'bt-title' }, '浏览器标签页'),
          h('p', { key: 's', className: 'bt-sub' }, '标签页/窗口太多时自动关掉闲置的、重复的、报错的页面。正在用的、刚打开的、命中保留规则的永远不动。'),
          h('div', { key: 'c', className: 'bt-chips' }, [
            h('span', { key: 'a', className: 'bt-chip ' + (over ? 'warn' : 'ok') }, over ? '超过上限' : '在上限内'),
            h('span', { key: 'b', className: 'bt-chip ' + (form.enabled ? 'ok' : 'warn') }, form.enabled ? '自动清理开' : '自动清理关'),
            h('span', { key: 'c', className: 'bt-chip' }, '每 ' + form.intervalSec + ' 秒看一次'),
            h('span', { key: 'd', className: 'bt-chip' + (s.reason === 'guard-active' ? ' warn' : '') }, (REASON_TEXT[s.reason] || s.reason || '还没有检查')),
          ]),
        ]),
        msg ? h('div', { key: 'msg', className: 'bt-toast ' + msg.kind }, [
          h('div', { key: 't' }, msg.text),
          h('button', { key: 'x', className: 'bt-toast-x', onClick: () => setMsg(null), title: '关掉' }, '×'),
        ]) : null,
        h('div', { key: 'stats', className: 'bt-stats' }, [
          h('div', { key: 'p', className: 'bt-stat' }, [
            h('div', { key: 'k', className: 'bt-stat-k' }, '标签页'),
            h('div', { key: 'v', className: 'bt-stat-v' }, String(s.pages || 0), h('small', { key: 'u' }, '个')),
          ]),
          h('div', { key: 'w', className: 'bt-stat' }, [
            h('div', { key: 'k', className: 'bt-stat-k' }, '窗口'),
            h('div', { key: 'v', className: 'bt-stat-v' }, String(s.windows || 0), h('small', { key: 'u' }, '个')),
          ]),
          h('div', { key: 'o', className: 'bt-stat ' + (over ? 'warn' : 'ok') }, [
            h('div', { key: 'k', className: 'bt-stat-k' }, '上限'),
            h('div', { key: 'v', className: 'bt-stat-v' }, over ? '超 ' + overCount : '正常', h('small', { key: 'u' }, '每窗 ' + form.maxTabsPerWindow + ' / 总 ' + form.maxTabsTotal)),
          ]),
          h('div', { key: 'a', className: 'bt-stat' }, [
            h('div', { key: 'k', className: 'bt-stat-k' }, '上次检查'),
            h('div', { key: 'v', className: 'bt-stat-v', style: { fontSize: '15px' } }, s.at ? timeText(new Date(s.at).toISOString()) : '—'),
          ]),
        ]),
        h('div', { key: 'auto', className: 'bt-card' }, [
          h('div', { key: 'h', className: 'bt-card-h' }, h('div', { key: 't', className: 'bt-card-t' }, '自动清理')),
          h('div', { key: 's', className: 'bt-card-sub' }, '关掉「自动清理」只停定时器；手动按钮仍然能用。'),
          h(Switch, { key: 'e', on: form.enabled, onChange: (v) => set('enabled', v), title: '启用自动清理', desc: '按下面的节奏巡检，超过上限时自动关页面' }),
          h(Switch, { key: 'a', on: form.autoClose, onChange: (v) => set('autoClose', v), title: '巡检时真的关', desc: '关掉后定时器只看不关，等于只报警' }),
          h('div', { key: 'f', className: 'bt-fields', style: { marginTop: '12px' } }, [
            h(NumField, { key: 'i', label: '巡检间隔', value: form.intervalSec, onChange: (v) => set('intervalSec', v), unit: '秒', min: 5, max: 3600, hint: '默认 30' }),
            h(NumField, { key: 'c', label: '两次清理最小间隔', value: form.cooldownSec, onChange: (v) => set('cooldownSec', v), unit: '秒', min: 0, max: 3600, hint: '默认 90' }),
            h(NumField, { key: 'g', label: '有人在用就让路', value: form.activeGuardSec, onChange: (v) => set('activeGuardSec', v), unit: '秒', min: 0, max: 3600, hint: '默认 120' }),
          ]),
        ]),
        h('div', { key: 'limits', className: 'bt-card' }, [
          h('div', { key: 'h', className: 'bt-card-h' }, h('div', { key: 't', className: 'bt-card-t' }, '上限与保护')),
          h('div', { key: 's', className: 'bt-card-sub' }, '低于上限时不会动任何页面；每轮最多关几个，是给「关错了」留的刹车。'),
          h('div', { key: 'f', className: 'bt-fields' }, [
            h(NumField, { key: 'w', label: '每个窗口最多', value: form.maxTabsPerWindow, onChange: (v) => set('maxTabsPerWindow', v), unit: '个', min: 1, max: 100 }),
            h(NumField, { key: 't', label: '所有窗口合计最多', value: form.maxTabsTotal, onChange: (v) => set('maxTabsTotal', v), unit: '个', min: 1, max: 500 }),
            h(NumField, { key: 'c', label: '每轮最多关', value: form.maxClosePerRun, onChange: (v) => set('maxClosePerRun', v), unit: '个', min: 1, max: 50 }),
            h(NumField, { key: 'n', label: '新标签保护', value: form.minAgeSec, onChange: (v) => set('minAgeSec', v), unit: '秒', min: 0, max: 86400, hint: '默认 120' }),
            h(NumField, { key: 'r', label: '每窗保留最新的', value: form.keepRecentPerWindow, onChange: (v) => set('keepRecentPerWindow', v), unit: '个', min: 0, max: 10 }),
          ]),
          h('label', { key: 'p', className: 'bt-field', style: { marginTop: '14px' } }, [
            h('span', { key: 'l' }, '永远不关的页面（正则，一行一个）'),
            h('textarea', {
              key: 't',
              className: 'bt-textarea',
              value: form.keepPatterns,
              spellCheck: false,
              placeholder: 'douyin\.com/\?recommend=1',
              onChange: (e) => set('keepPatterns', e.target.value),
            }),
            h('em', { key: 'h' }, '默认保留抖音推荐流。留空 = 只按「正在用/刚打开/最近」保护。'),
          ]),
          badPatterns.length ? h('div', { key: 'bad', className: 'bt-warn-line' }, '这些正则不合法，会按字面文本匹配：' + badPatterns.join('、')) : null,
        ]),
        h('div', { key: 'save', className: 'bt-card' }, [
          h('div', { key: 'h', className: 'bt-card-h' }, [
            h('div', { key: 't', className: 'bt-card-t' }, '保存'),
            dirty ? h('span', { key: 'd', className: 'bt-tag warn' }, '有未保存的改动') : h('span', { key: 'd', className: 'bt-tag ok' }, '已保存'),
          ]),
          h('div', { key: 's', className: 'bt-card-sub' }, '保存后立即生效：定时器会按新间隔重启，不会中断正在进行的检查。'),
          h('div', { key: 'a', className: 'bt-actions' }, [
            h('button', { key: 's', className: 'bt-btn primary', disabled: !!busy || !dirty, onClick: save }, busy === 'save' ? '保存中…' : '保存设置'),
            h('button', { key: 'r', className: 'bt-btn', disabled: !!busy, onClick: reset }, '恢复默认值'),
            h('button', { key: 'l', className: 'bt-btn', disabled: !!busy, onClick: load }, busy === 'load' ? '刷新中…' : '刷新状态'),
          ]),
        ]),
        h('div', { key: 'now', className: 'bt-card' }, [
          h('div', { key: 'h', className: 'bt-card-h' }, [
            h('div', { key: 't', className: 'bt-card-t' }, '现在'),
            h('span', { key: 'r', className: 'bt-hint' }, (REASON_TEXT[s.reason] || s.reason || '') + (s.guard && s.guard.active ? ' · 浏览器刚刚还有人操作' : '')),
          ]),
          h('div', { key: 's', className: 'bt-card-sub' }, '「预演」只算不动手；「立即清理」会真的发关闭请求，关之前再确认一次。'),
          h('div', { key: 'a', className: 'bt-actions' }, [
            h('button', { key: 'p', className: 'bt-btn', disabled: !!busy, onClick: () => clean(true) }, busy === 'preview' ? '预演中…' : '预演一次'),
            h('button', { key: 'c', className: 'bt-btn danger', disabled: !!busy, onClick: () => clean(false) }, busy === 'clean' ? '清理中…' : '立即清理'),
            h('label', { key: 'f', className: 'bt-check' }, [
              h('input', { key: 'i', type: 'checkbox', checked: force, onChange: (e) => setForce(e.target.checked) }),
              '无视「正在用」保护（force）',
            ]),
          ]),
          result ? h('pre', { key: 'pre', className: 'bt-pre' }, result) : null,
        ]),
        h('div', { key: 'tabs', className: 'bt-card' }, [
          h('div', { key: 'h', className: 'bt-card-h' }, [
            h('div', { key: 't', className: 'bt-card-t' }, '当前标签页'),
            h('span', { key: 'c', className: 'bt-hint' }, tabs.length + ' 个'),
          ]),
          h('div', { key: 's', className: 'bt-card-sub' }, '「预演会关」是下一次真正清理时会动的页面；带「保留」标签的不会被选中。'),
          tabs.length ? h('div', { key: 'w', className: 'bt-table-wrap' }, h('table', { key: 't', className: 'bt-table' }, [
            h('thead', { key: 'h' }, h('tr', null, [
              h('th', { key: 'w' }, '窗口'),
              h('th', { key: 'u' }, '页面'),
              h('th', { key: 's' }, '状态'),
              h('th', { key: 'a' }, '年龄'),
            ])),
            h('tbody', { key: 'b' }, tabs.slice(0, 120).map((tab) => h('tr', { key: tab.id }, [
              h('td', { key: 'w' }, String(tab.windowId || '?')),
              h('td', { key: 'u' }, h('div', { className: 'bt-url', title: tab.url || '' }, shortUrl(tab.url))),
              h('td', { key: 's' }, [
                tab.closed ? h('span', { key: 'c', className: 'bt-tag ok' }, '已关') : null,
                tab.planned ? h('span', { key: 'p', className: 'bt-tag warn' }, '预演会关') : null,
                tab.keep ? h('span', { key: 'k', className: 'bt-tag' }, KEEP_TEXT[tab.keep] || tab.keep) : null,
                tab.visible && tab.windowState !== 'minimized' ? h('span', { key: 'v', className: 'bt-tag ok' }, '在用') : null,
                !tab.closed && !tab.planned && !tab.keep ? h('span', { key: 'n', className: 'bt-tag' }, '普通') : null,
              ]),
              h('td', { key: 'a' }, ageText(tab.ageSec)),
            ]))),
          ])) : h('div', { key: 'e', className: 'bt-empty' }, '没有标签页，或者还没读到浏览器状态'),
          tabs.length > 120 ? h('div', { key: 'm', className: 'bt-hint', style: { marginTop: '8px' } }, '只显示前 120 个') : null,
        ]),
        history.length ? h('div', { key: 'hist', className: 'bt-card' }, [
          h('div', { key: 'h', className: 'bt-card-h' }, h('div', { key: 't', className: 'bt-card-t' }, '最近清理')),
          h('ul', { key: 'l', className: 'bt-history' }, history.map((item, index) => h('li', { key: index }, [
            h('time', { key: 't' }, timeText(item.at)),
            h('span', { key: 'c' }, '关了 ' + ((item.closed && item.closed.length) || 0) + ' 个，剩 ' + (item.remaining === undefined ? '?' : item.remaining) + ' 个'),
            h('span', { key: 's', className: 'bt-hint' }, item.source === 'auto' ? '自动' : '手动'),
          ]))),
        ]) : null,
      ])
    }

    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { err: null }
      }
      static getDerivedStateFromError(err) {
        return { err }
      }
      render() {
        if (this.state.err) {
          return h('div', { className: 'bt' }, [
            h('div', { key: 't', className: 'bt-title' }, '浏览器标签页 · 面板出错了'),
            h('div', { key: 'm', className: 'bt-toast err' }, String(this.state.err.message || this.state.err)),
            h('pre', { key: 's', className: 'bt-pre' }, String(this.state.err.stack || '').split(String.fromCharCode(10)).slice(0, 6).join(String.fromCharCode(10))),
            h('div', { key: 'h', className: 'bt-hint' }, '把这段发给大肥鱼，它照着修。'),
          ])
        }
        return this.props.children
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-browser-tabs')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-browser-tabs: 设置页样式')
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'browser-tabs', order: 33, label: '浏览器标签页' },
          () => h(Boundary, null, h(Panel)),
        ))
      },
    }
  },
})
