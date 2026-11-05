// 常驻层（名字、长期事实）：短句被问句门挡下也照带；称呼类一直在；模型记成 0.5 的名字后台补判
//
// 写法照 forget.test.mjs：**先设 DSH_HOME、再 import**，只用临时家目录。
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'fish-resident-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'sessions'), { recursive: true })
mkdirSync(join(home, 'fish-memory'), { recursive: true })

const mod = await import('../lib/index.js')
const { recall, loadStore, 记一句话, __测试: api } = mod
after(() => { try { rmSync(home, { recursive: true, force: true }) } catch {} })

const 库 = (sid) => join(home, 'fish-memory', sid + '.json')
const 读库 = (sid) => JSON.parse(readFileSync(库(sid), 'utf8'))
function 造库(sid, memories) {
  writeFileSync(库(sid), JSON.stringify({ version: 2, memories, deleted: [], traces: [] }))
}
const 天 = (d) => '2026-10-' + String(d).padStart(2, '0') + 'T10:00:00.000Z'
const 事件 = (id, text, d, extra = {}) => ({ id, text, at: 天(d), createdAt: 天(d), category: 'event', importance: 0.5, ...extra })
const 事实 = (id, text, d, extra = {}) => ({ id, text, at: 天(d), createdAt: 天(d), category: 'stable_profile', importance: 1, ...extra })
const 选中 = (r) => r.selected.map((x) => x.m.id)

// 让问句门真的开起来（说过 20 句以上才开）：喂一堆天天说的话
function 喂尺(sid) {
  for (let i = 0; i < 30; i++) 记一句话(sid, '嗯嗯 在吗 哈哈 好的 晚安 ' + i)
}

test('称呼类：事实键最后一段是名字/称呼才算', () => {
  assert.equal(api.是称呼类({ 事实键: 'ta.名字' }), true)
  assert.equal(api.是称呼类({ 事实键: 'TA.称呼' }), true)
  assert.equal(api.是称呼类({ 事实键: '小明：昵称' }), true)
  assert.equal(api.是称呼类({ 事实键: 'ta.名字来源' }), false)
  assert.equal(api.是称呼类({ 事实键: 'ta.职业' }), false)
  assert.equal(api.是称呼类({}), false)
})

test('问句门挡下短句时，长期事实和名字照样带上', () => {
  const sid = 's-gate'
  喂尺(sid)
  造库(sid, [
    事件('m1', 'ta 叫 Rick', 1, { 事实键: 'ta.名字' }),
    事实('m2', 'ta 对芒果过敏', 2),
    事件('m3', '周五 ta 去面试', 3),
  ])
  const r = recall(loadStore(sid), '嗯嗯', Date.parse('2026-11-01T00:00:00Z'), sid)
  assert.ok(r.gate && r.gate.挡了, '这句应该被门挡下')
  assert.deepEqual(选中(r).sort(), ['m1', 'm2'])
  assert.ok(!选中(r).includes('m3'), '普通事件被挡下就不带')
})

test('名字不被后来的长期事实挤掉，也不占 factsMax 的名额', () => {
  const sid = 's-crowd'
  造库(sid, [
    事件('m1', 'ta 叫 Rick', 1, { 事实键: 'ta.名字' }),
    事实('m2', 'ta 喜欢猫', 5),
    事实('m3', 'ta 住在杭州', 6),
    事实('m4', 'ta 是程序员', 7),
  ])
  const r = recall(loadStore(sid), '今天下雨了好烦啊真的', Date.parse('2026-11-01T00:00:00Z'), sid)
  const ids = 选中(r)
  assert.ok(ids.includes('m1'), '名字要在')
  assert.ok(ids.includes('m4') && ids.includes('m3'), 'factsMax=2：最新的两条长期事实照旧')
  assert.ok(!ids.includes('m2'))
  assert.equal(ids[0], 'm1', '名字排最前')
})

test('称呼类最多常驻 2 条（防模型乱给键）', () => {
  const sid = 's-cap'
  造库(sid, [
    事件('m1', 'A 叫小明', 1, { 事实键: 'a.名字' }),
    事件('m2', 'B 叫小红', 2, { 事实键: 'b.名字' }),
    事件('m3', 'C 叫小刚', 3, { 事实键: 'c.名字' }),
  ])
  const r = recall(loadStore(sid), '今天下雨了好烦啊真的', Date.parse('2026-11-01T00:00:00Z'), sid)
  const 常驻 = r.selected.filter((x) => x.常驻).map((x) => x.m.id)
  assert.deepEqual(常驻, ['m3', 'm2'])
})

test('已被取代的旧名字不常驻', () => {
  const sid = 's-renamed'
  造库(sid, [
    事件('m1', 'ta 叫 Rick', 1, { 事实键: 'ta.名字', 已被取代: { by: 'm2' } }),
    事件('m2', 'ta 改名叫 Rich', 2, { 事实键: 'ta.名字' }),
  ])
  const r = recall(loadStore(sid), '今天下雨了好烦啊真的', Date.parse('2026-11-01T00:00:00Z'), sid)
  assert.deepEqual(r.selected.filter((x) => x.常驻).map((x) => x.m.id), ['m2'])
})

test('再记一次时给了更高的重要度：跟着升成一直记得，并补上事实键', async () => {
  const sid = 's-reinforce'
  造库(sid, [事件('m1', 'ta 的名字是 Rick', 1)])
  const tool = api.makeRememberTool({})
  const r = await tool.execute({ text: 'ta 的名字是 Rick', importance: 1, 事实键: 'ta.名字' }, { agent: { sessionId: sid } })
  assert.equal(r.ok, true)
  const m = 读库(sid).memories.find((x) => x.id === 'm1')
  assert.equal(m.category, 'stable_profile')
  assert.equal(m.importance, 1)
  assert.equal(m.事实键, 'ta.名字')
  // 再记一次给了更低的：不降
  await tool.execute({ text: 'ta 的名字是 Rick', importance: 0 }, { agent: { sessionId: sid } })
  const m2 = 读库(sid).memories.find((x) => x.id === 'm1')
  assert.equal(m2.category, 'stable_profile')
  assert.equal(m2.importance, 1)
})

function 假宿主(回答, 计数) {
  const agent = { options: { provider: 'p', model: 'm' } }
  return {
    agents: { get: () => agent, list: () => [agent] },
    get: () => null,
    llm: {
      async *stream() {
        计数.n++
        yield { type: 'text-delta', text: 回答 }
      },
    },
  }
}

test('自动判长期：只升不降，判过的不再问，节流', async () => {
  const sid = 's-judge'
  造库(sid, [
    事件('m1', 'ta 叫 Rick', 1),
    事件('m2', '周五 ta 去面试', 2),
    事实('m3', '我们是好朋友', 3), // 已经是一直记得的：不送去判、也不会被降
  ])
  const 计数 = { n: 0 }
  const ctx = 假宿主('1|1\n2|0.5', 计数)
  const 升 = await api.自动判长期(ctx, sid)
  assert.equal(升, 1)
  const d = 读库(sid)
  const 找 = (id) => d.memories.find((x) => x.id === id)
  assert.equal(找('m1').category, 'stable_profile')
  assert.equal(找('m1').importance, 1)
  assert.equal(找('m1').stableChecked, true)
  assert.equal(找('m2').category, 'event')
  assert.equal(找('m2').stableChecked, true)
  assert.equal(找('m3').category, 'stable_profile')
  assert.equal(找('m3').stableChecked, undefined)
  assert.equal(计数.n, 1)
  // 都判过了：再来一次不花钱
  assert.deepEqual(api.待判长期(d.memories), [])
  // 新记一条，但 10 分钟内不再跑
  const 新 = 读库(sid)
  新.memories.push(事件('m4', 'ta 生日是 3 月 5 日', 4))
  writeFileSync(库(sid), JSON.stringify(新))
  assert.equal(await api.自动判长期(ctx, sid), 0)
  assert.equal(计数.n, 1)
})

test('自动判长期：模型没回的编号不打「判过」，下次再问；policy.autoStable=false 不跑', async () => {
  const sid = 's-judge2'
  造库(sid, [事件('m1', 'ta 叫 Rick', 1), 事件('m2', 'ta 喜欢蓝色', 2)])
  const 计数 = { n: 0 }
  await api.自动判长期(假宿主('2|1', 计数), sid)
  const d = 读库(sid)
  assert.equal(d.memories.find((x) => x.id === 'm1').stableChecked, undefined)
  assert.equal(d.memories.find((x) => x.id === 'm2').category, 'stable_profile')

  const sid3 = 's-judge3'
  writeFileSync(库(sid3), JSON.stringify({ version: 2, policy: { autoStable: false }, memories: [事件('m1', 'ta 叫 Rick', 1)], deleted: [], traces: [] }))
  const c3 = { n: 0 }
  assert.equal(await api.自动判长期(假宿主('1|1', c3), sid3), 0)
  assert.equal(c3.n, 0)
})

test('后台排队：同一个库的活一个接一个跑', async () => {
  const 序 = []
  const 慢 = (名, ms) => () => new Promise((r) => setTimeout(() => { 序.push(名); r() }, ms))
  api.后台排队('q', 慢('先', 30))
  await api.后台排队('q', 慢('后', 1))
  assert.deepEqual(序, ['先', '后'])
})

test('解析判长期：容忍全角竖线、空行、乱写', () => {
  assert.deepEqual(api.解析判长期('1|1\n\n2｜0.5\n3|maybe\n9|1', 3), { 0: 1, 1: 0.5 })
})
