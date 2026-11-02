import test from 'node:test'
import assert from 'node:assert/strict'
import { decide, normalizeConfig, matchesKeep } from '../lib/policy.mjs'

const NOW = 1000000

function page(id, extra) {
  return Object.assign({
    id: id,
    url: 'https://example.com/' + id,
    title: id,
    windowId: 1,
    windowState: 'normal',
    visible: false,
    focus: false,
    firstSeen: 0,
  }, extra || {})
}

function config(extra) {
  return Object.assign({
    keepPatterns: [],
    maxTabsPerWindow: 8,
    maxTabsTotal: 100,
    maxClosePerRun: 5,
    minAgeMs: 0,
    keepRecentPerWindow: 0,
    minTabsPerWindow: 1,
  }, extra || {})
}

test('没超上限就不选', () => {
  const pages = Array.from({ length: 8 }, (_, i) => page('p' + i))
  const plan = decide({ pages: pages, config: config(), now: NOW })
  assert.equal(plan.over, false)
  assert.deepEqual(plan.victims, [])
})

test('单窗口超了，先关最老的', () => {
  const pages = Array.from({ length: 10 }, (_, i) => page('p' + i, { firstSeen: i }))
  const plan = decide({ pages: pages, config: config(), now: NOW })
  assert.equal(plan.over, true)
  assert.deepEqual(plan.victims.map((p) => p.id), ['p0', 'p1'])
})

test('正在用的不动', () => {
  const pages = Array.from({ length: 10 }, (_, i) => page('p' + i, { firstSeen: i }))
  pages[0].visible = true
  const plan = decide({ pages: pages, config: config(), now: NOW })
  assert.equal(plan.protected.p0, 'active')
  assert.deepEqual(plan.victims.map((p) => p.id), ['p1', 'p2'])
})

test('有焦点也算正在用', () => {
  const pages = Array.from({ length: 10 }, (_, i) => page('p' + i, { firstSeen: i }))
  pages[0].focus = true
  const plan = decide({ pages: pages, config: config(), now: NOW })
  assert.equal(plan.protected.p0, 'active')
})

test('刚打开的不动', () => {
  const pages = Array.from({ length: 10 }, (_, i) => page('p' + i, { firstSeen: i }))
  pages[0].firstSeen = NOW - 1000
  const plan = decide({ pages: pages, config: config({ minAgeMs: 120000 }), now: NOW })
  assert.equal(plan.protected.p0, 'new')
  assert.deepEqual(plan.victims.map((p) => p.id), ['p1', 'p2'])
})

test('每窗口最新一个保留', () => {
  const pages = Array.from({ length: 10 }, (_, i) => page('p' + i, { firstSeen: i }))
  const plan = decide({ pages: pages, config: config({ keepRecentPerWindow: 1 }), now: NOW })
  assert.equal(plan.protected.p9, 'recent')
  assert.ok(!plan.victims.some((p) => p.id === 'p9'))
})

test('保留规则命中不动', () => {
  const pages = Array.from({ length: 10 }, (_, i) => page('p' + i, { firstSeen: i }))
  pages[0].url = 'https://www.douyin.com/?recommend=1'
  const plan = decide({
    pages: pages,
    config: config({ keepPatterns: ['douyin\\.com/\\?recommend=1'] }),
    now: NOW,
  })
  assert.equal(plan.protected.p0, 'keep')
  assert.deepEqual(plan.victims.map((p) => p.id), ['p1', 'p2'])
})

test('空白页和报错页优先关', () => {
  const pages = [
    page('normal1', { firstSeen: 0 }),
    page('blank', { url: 'about:blank', firstSeen: 999 }),
    page('normal2', { firstSeen: 1 }),
    page('err', { url: 'edge://error.html', firstSeen: 998 }),
    page('normal3', { firstSeen: 2 }),
    page('normal4', { firstSeen: 3 }),
    page('normal5', { firstSeen: 4 }),
    page('normal6', { firstSeen: 5 }),
    page('normal7', { firstSeen: 6 }),
  ]
  const plan = decide({ pages: pages, config: config({ maxClosePerRun: 3, maxTabsPerWindow: 1 }), now: NOW })
  assert.deepEqual(plan.victims.map((p) => p.id), ['blank', 'err', 'normal1'])
})

test('重复 URL 比普通老页优先', () => {
  const pages = Array.from({ length: 10 }, (_, i) => page('p' + i, { firstSeen: i }))
  pages[1].url = 'https://example.com/p1'
  pages[8].url = 'https://example.com/p1'
  const plan = decide({ pages: pages, config: config({ maxClosePerRun: 2 }), now: NOW })
  assert.deepEqual(plan.victims.map((p) => p.id), ['p1', 'p0'])
})

test('最小化窗口里也能清，但最新一个留着', () => {
  const pages = Array.from({ length: 10 }, (_, i) => page('p' + i, { firstSeen: i, windowState: 'minimized', visible: true }))
  const plan = decide({ pages: pages, config: config({ keepRecentPerWindow: 1 }), now: NOW })
  assert.equal(plan.over, true)
  assert.equal(plan.protected.p9, 'recent')
  assert.deepEqual(plan.victims.map((p) => p.id), ['p0', 'p1'])
})

test('最小化窗口里有焦点的也不动', () => {
  const pages = Array.from({ length: 10 }, (_, i) => page('p' + i, { firstSeen: i, windowState: 'minimized', visible: true }))
  pages[0].focus = true
  const plan = decide({ pages: pages, config: config(), now: NOW })
  assert.equal(plan.protected.p0, 'active')
  assert.ok(!plan.victims.some((p) => p.id === 'p0'))
})

test('每窗口至少留一个', () => {
  const pages = Array.from({ length: 10 }, (_, i) => page('p' + i, { firstSeen: i }))
  const plan = decide({ pages: pages, config: config({ maxTabsPerWindow: 1, maxClosePerRun: 20 }), now: NOW })
  assert.equal(plan.victims.length, 9)
  assert.equal(plan.counts[1] - plan.victims.length, 1)
})

test('一次最多关 maxClosePerRun 个', () => {
  const pages = Array.from({ length: 30 }, (_, i) => page('p' + i, { firstSeen: i }))
  const plan = decide({ pages: pages, config: config({ maxClosePerRun: 3 }), now: NOW })
  assert.equal(plan.victims.length, 3)
})

test('跨窗口总数超了也会清', () => {
  const pages = []
  for (let w = 1; w <= 2; w++) {
    for (let i = 0; i < 6; i++) pages.push(page('w' + w + '-' + i, { windowId: w, firstSeen: w * 100 + i }))
  }
  const plan = decide({ pages: pages, config: config({ maxTabsTotal: 10, maxTabsPerWindow: 100 }), now: NOW })
  assert.equal(plan.over, true)
  assert.equal(plan.victims.length, 2)
  assert.ok(plan.victims.every((p) => p.firstSeen < 110))
})

test('配置会被收进合理范围', () => {
  const cfg = normalizeConfig({ intervalMs: 1, maxTabsPerWindow: 999, maxClosePerRun: 0, keepPatterns: 'a, b' })
  assert.equal(cfg.intervalMs, 5000)
  assert.equal(cfg.maxTabsPerWindow, 100)
  assert.equal(cfg.maxClosePerRun, 1)
  assert.deepEqual(cfg.keepPatterns, ['a', 'b'])
})

test('保留规则支持正则和普通字符串', () => {
  assert.equal(matchesKeep('https://www.douyin.com/?recommend=1', ['douyin\\.com/\\?recommend=1']), true)
  assert.equal(matchesKeep('https://example.com/x', ['(not-a-regex']), false)
  assert.equal(matchesKeep('https://example.com/abc', ['abc']), true)
})
