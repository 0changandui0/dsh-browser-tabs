/**
 * 和 CDP（Edge / Chrome 的调试口）说话的最小实现。
 * 只用 Node 自带的 fetch 和 WebSocket，不引第三方包。
 */

const WS_UNSUPPORTED = '当前 Node 没有全局 WebSocket，读不了窗口信息'

export async function getJson(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs || 4000) })
  if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status)
  return res.json()
}

export async function listPages(cdpUrl, timeoutMs) {
  const data = await getJson(cdpUrl + '/json/list', timeoutMs)
  return (Array.isArray(data) ? data : [])
    .filter((t) => t && t.type === 'page' && !String(t.url || '').startsWith('devtools://'))
    .map((t) => ({
      id: String(t.id),
      url: String(t.url || ''),
      title: String(t.title || ''),
      ws: String(t.webSocketDebuggerUrl || ''),
    }))
}

function rpcSession(wsUrl, fn, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== 'function') {
      reject(new Error(WS_UNSUPPORTED))
      return
    }
    let ws
    try {
      ws = new WebSocket(wsUrl)
    } catch (err) {
      reject(err)
      return
    }
    let settled = false
    let seq = 0
    const pending = new Map()
    const timer = setTimeout(() => finish(new Error('CDP 超时')), timeoutMs || 4000)
    function finish(err, value) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch (closeErr) {}
      if (err) reject(err)
      else resolve(value)
    }
    function send(method, params) {
      return new Promise((res, rej) => {
        const id = ++seq
        pending.set(id, { res: res, rej: rej })
        try {
          ws.send(JSON.stringify({ id: id, method: method, params: params || {} }))
        } catch (err) {
          pending.delete(id)
          rej(err)
        }
      })
    }
    ws.onmessage = (event) => {
      let msg
      try { msg = JSON.parse(event.data) } catch (err) { return }
      const slot = msg && msg.id ? pending.get(msg.id) : null
      if (!slot) return
      pending.delete(msg.id)
      if (msg.error) slot.rej(new Error(msg.error.message || 'CDP 错误'))
      else slot.res(msg.result)
    }
    ws.onerror = () => finish(new Error('CDP WebSocket 连不上'))
    ws.onclose = () => { if (!settled) finish(new Error('CDP WebSocket 提前关闭')) }
    ws.onopen = () => {
      Promise.resolve()
        .then(() => fn(send))
        .then((value) => finish(null, value))
        .catch((err) => finish(err))
    }
  })
}

/** 每个标签页属于哪个窗口、窗口是不是最小化/最大化。拿不到就抛错，由调用方降级。 */
export async function mapWindows(cdpUrl, pages, timeoutMs) {
  const info = await getJson(cdpUrl + '/json/version', timeoutMs)
  if (!info || !info.webSocketDebuggerUrl) throw new Error('CDP 没给 browser WebSocket 地址')
  const map = new Map()
  await rpcSession(info.webSocketDebuggerUrl, async (send) => {
    for (const page of pages) {
      try {
        const r = await send('Browser.getWindowForTarget', { targetId: page.id })
        const state = r && r.bounds && r.bounds.windowState ? r.bounds.windowState : 'normal'
        map.set(page.id, { windowId: Number(r && r.windowId) || 0, windowState: state })
      } catch (err) {
        map.set(page.id, { windowId: 0, windowState: 'unknown' })
      }
    }
  }, timeoutMs || 5000)
  return map
}

/** 问每个页面自己：你可见吗？有焦点吗？失败返回 null，调用方按“保守保留”处理。 */
export async function probeVisibility(pages, timeoutMs, concurrency) {
  const map = new Map()
  const queue = pages.filter((page) => page.ws)
  const limit = Math.max(1, concurrency || 4)
  async function worker() {
    while (queue.length) {
      const page = queue.shift()
      try {
        const value = await rpcSession(page.ws, async (send) => {
          const r = await send('Runtime.evaluate', {
            expression: '({ visible: document.visibilityState === "visible", focus: document.hasFocus() })',
            returnByValue: true,
          })
          return (r && r.result && r.result.value) || null
        }, timeoutMs || 1500)
        map.set(page.id, value ? { visible: value.visible === true, focus: value.focus === true } : null)
      } catch (err) {
        map.set(page.id, null)
      }
    }
  }
  const workers = []
  for (let i = 0; i < Math.min(limit, queue.length); i++) workers.push(worker())
  await Promise.all(workers)
  return map
}

export async function closeTarget(cdpUrl, targetId, timeoutMs) {
  const res = await fetch(cdpUrl + '/json/close/' + encodeURIComponent(targetId), {
    signal: AbortSignal.timeout(timeoutMs || 4000),
  })
  if (!res.ok) throw new Error('关标签页失败 HTTP ' + res.status)
  return true
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
