import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, copyFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { JournalChat, chatCommand, chatSnapshot } from '../plugins/reading-inbox/chat.js'
import { JournalLlm } from '../plugins/reading-inbox/llm.js'
import { WeChatBot } from '../plugins/reading-inbox/wechat.js'
import { apply } from '../plugins/reading-inbox/index.js'

const python = process.env.DSH_PYTHON || 'python'
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'journal-chat-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const file of readdirSync('journal').filter(f => f.endsWith('.py') || f === 'RULES.md')) copyFileSync(join('journal', file), join(dir, file))
  const journal = (args, env = {}) => {
    const result = spawnSync(python, [join(dir, 'journal.py'), ...args], {
      encoding: 'utf8', env: { ...process.env, JOURNAL_DIR: dir, ...env },
    })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  }
  journal(['init'])
  writeFileSync(join(dir, 'notebook.md'), '## 2026-10-31\n想讨论实验结果\n')
  return { dir, journal }
}

test('conversation is ordered, persists across restart, deduplicates and resets independently of journal', async t => {
  const { dir, journal } = fixture(t)
  const before = readFileSync(join(dir, 'store.json'), 'utf8')
  const inputs = []
  const llm = { async chat(input) { inputs.push(input); return { reply: `回答：${input.text}`, model: { provider: 'configured', model: 'm' } } } }
  const make = () => new JournalChat({ dir, llm, context: async () => journal(['chat-context']) })
  const chat = make()
  assert.equal((await chat.state('wechat:owner')).mode, 'auto')
  await chat.command('wechat:owner', 'start')
  await Promise.all([chat.reply('wechat:owner', '先说实验', '1'), chat.reply('wechat:owner', '那下一步呢', '2')])
  assert.equal(inputs[1].history[0].user, '先说实验')
  assert.equal(inputs[1].history[0].assistant, '回答：先说实验')
  const restarted = make()
  assert.equal((await restarted.state('wechat:owner')).mode, 'chat')
  assert.equal((await restarted.reply('wechat:owner', '那下一步呢', '2')).duplicate, true)
  assert.equal(inputs.length, 2)
  await assert.rejects(restarted.reply('wechat:owner', '另一句话', '2'), /消息 id/)
  assert.equal((await restarted.state('wechat:someone-else')).turns.length, 0)
  await restarted.command('wechat:owner', 'reset')
  assert.deepEqual(await restarted.state('wechat:owner'), { mode: 'chat', turns: [] })
  await restarted.command('wechat:owner', 'stop')
  assert.equal((await restarted.state('wechat:owner')).mode, 'auto')
  assert.equal(readFileSync(join(dir, 'store.json'), 'utf8'), before)
  assert.equal(existsSync(join(dir, 'capture')), false)
  assert.equal(readFileSync(join(dir, 'notebook.md'), 'utf8'), '## 2026-10-31\n想讨论实验结果\n')
})

test('chat failures leave history intact, retry succeeds, and context/history are explicitly bounded', async t => {
  const { dir } = fixture(t)
  let input
  const llm = { async chat(value) { input = value; throw new Error('timeout') } }
  const chat = new JournalChat({ dir, llm, context: async () => ({ projects: [], items: [] }) })
  await assert.rejects(chat.reply('wx', '你好', '1'), /timeout/)
  assert.equal((await chat.state('wx')).turns.length, 0)
  llm.chat = async value => { input = value; return { reply: '一'.repeat(3000), model: { provider: 'p', model: 'm' } } }
  for (let n = 0; n < 23; n += 1) await chat.reply('wx', '问题'.repeat(1500), String(n))
  assert.equal((await chat.state('wx')).turns.length, 20)
  assert.ok(input.history_omitted_turns > 0)
  assert.ok(JSON.stringify(input.history).length < 18000)
  const bounded = chatSnapshot({ projects: Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, state: 'x'.repeat(600) })),
    items: Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, type: 'task', status: 'open', text: '任务' })), notebook: '旧'.repeat(7000) + '最新记录' })
  assert.equal(bounded.coverage.omitted_projects, 2)
  assert.equal(bounded.coverage.omitted_items, 10)
  assert.equal(bounded.coverage.fields_may_be_truncated, true)
  assert.equal(bounded.coverage.notebook_truncated, true)
  assert.ok(bounded.notebook.endsWith('最新记录'))
})

test('model chat returns visible reply JSON and rejects invalid replies', async () => {
  const llm = new JournalLlm({ provider: 'configured', model: 'm' })
  let output = { reply: '可以，继续说。' }
  llm.runtime = { async *stream() {
    yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify(output) } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  assert.equal((await llm.chat({ text: '你好' })).reply, '可以，继续说。')
  output = { reply: 'x'.repeat(3501) }
  await assert.rejects(llm.chat({ text: '你好' }), /reply/)
  output = { reply: '已完成', action: 'delete' }
  await assert.rejects(llm.chat({ text: '你好' }), /格式/)
  assert.deepEqual(chatCommand('/记 明天整理结果'), { action: 'capture', text: '明天整理结果' })
  assert.deepEqual(chatCommand('/聊天'), { action: 'start' })
  assert.deepEqual(chatCommand('/退出'), { action: 'stop' })
  assert.deepEqual(chatCommand('/退出聊天'), { action: 'stop' })
  assert.equal(chatCommand('/记账'), null)
  assert.equal(chatCommand('我们聊聊这个问题'), null)
})

test('WeChat routes chat, followups, explicit notes and mode changes; ingest excludes conversation', async t => {
  const { dir, journal } = fixture(t)
  let bot
  const sent = []
  const originalLoad = WeChatBot.prototype.load
  const originalSend = WeChatBot.prototype.sendText
  WeChatBot.prototype.load = async function () { bot = this; this.credential = { ilink_user_id: 'owner' } }
  WeChatBot.prototype.sendText = async function (text) { sent.push(text) }
  t.after(() => { WeChatBot.prototype.load = originalLoad; WeChatBot.prototype.sendText = originalSend })
  const cleanup = []
  const inputs = []
  const ctx = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'configured', model: 'm' }) },
    llm: { listProviders: () => [{ id: 'configured' }, { id: 'unused' }], listModels: async provider => provider === 'configured' ? [{ id: 'm' }] : [], async *stream(options) {
      assert.equal(options.provider, 'configured')
      assert.equal(options.model, 'm')
      const input = JSON.parse(options.messages[0].content[0].text)
      inputs.push({ purpose: options.purpose, input })
      let output = options.purpose === 'journal-chat' ? { reply: input.history.length ? '接着刚才的实验讨论。' : '可以讨论实验。' }
        : { items: [{ type: 'task', text: '整理结果', note: '', quote: input.text, project: null, due: null, at: null, place: null, time_quote: null }] }
      if (options.purpose === 'journal-classify') output = { intent: 'task', continuation: false, collect_refs: false, reply: '', items: output.items }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify(output) } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } },
    agents: { currentInitiator: () => undefined },
    tools: { register() { return () => {} } }, webServer: { register() { return () => {} } },
    inject(_names, fn) { fn(this) }, on() {},
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') cleanup.push(dispose) },
  }
  t.after(() => cleanup.reverse().forEach(fn => fn()))
  apply(ctx, { dataDir: join(dir, 'inbox'), journalDir: dir, python })
  const receive = (text, id, from = 'owner') => bot.handleMessage({ from_user_id: from, message_id: id,
    item_list: [{ type: 1, text_item: { text } }] })
  await receive('/聊天', 'start')
  await receive('一起讨论实验', '1')
  await receive('那接下来呢 https://example.org', '2')
  assert.equal(sent.at(-1), '接着刚才的实验讨论。')
  assert.equal(inputs[1].input.history[0].user, '一起讨论实验')
  const calls = inputs.length
  await receive('那接下来呢 https://example.org', '2')
  assert.equal(inputs.length, calls)
  assert.equal(journal(['state']).items.length, 0)
  const eventsFile = join(dir, 'inbox', 'wechat-events.json')
  assert.equal(journal(['ingest'], { WECHAT_EVENTS: eventsFile }).new, 0)
  await receive('/记 整理结果', 'note')
  assert.equal(journal(['state']).items.length, 1)
  assert.equal(journal(['state']).items[0].text, '整理结果')
  await receive('/记 整理结果', 'note')
  assert.equal(journal(['state']).items.length, 1)
  assert.equal(journal(['ingest'], { WECHAT_EVENTS: eventsFile }).new, 0)
  await receive('别人询问账本', 'stranger', 'stranger')
  assert.equal(inputs.length, calls + 1)
  await receive('/新对话', 'reset')
  await receive('重新开始', '3')
  assert.equal(inputs.at(-1).input.history.length, 0)
  await receive('/退出聊天', 'stop')
  await receive('整理结果', 'new-note')
  assert.equal(journal(['state']).items.length, 2)
  const routes = JSON.parse(readFileSync(eventsFile, 'utf8'))
  assert.equal(routes.find(e => e.id === '1').journal_route, 'chat')
  assert.equal(routes.find(e => e.id === 'stranger').journal_route, 'ignored')
})
