import test from 'node:test'
import assert from 'node:assert/strict'
import { fresh, addNode, addNote, setLock, questions, conflicts, exportPack, answerQuestion } from '../scripts/core.mjs'

test('goal tree, hard lock, approval, questions and exports', () => {
  const doc = fresh('建设一个可部署项目')
  const big = addNode(doc, doc.nodes[0].id, '实现')
  const small = addNode(doc, big.id, '后端')
  const note = addNote(doc, small.id, '必须接入服务')
  setLock(doc, note.id, true)
  assert.equal(note.level, '硬约束')
  assert.throws(() => setLock(doc, note.id, false, {reason:'测试'}), /审批人/)
  note.external = '需翻墙平台'
  doc.policy.externalPolicy = '禁止翻墙平台'
  assert.ok(conflicts(doc).some(c => c.code === 'firewall'))
  assert.ok(conflicts(doc).some(c => c.code === 'hard-accept'))
  assert.ok(questions(doc).some(q => q.id === 'accept:' + note.id))
  assert.throws(() => exportPack(doc, 'ai', 'json'), /阻塞问题/)
  const data = JSON.parse(exportPack(doc, 'ai', 'json', {by:'测试用户',reason:'先按保守默认策略准备草案'}))
  assert.equal(data.hardConstraints[0].id, note.id)
  assert.ok(data.exportOverride.questionIds.length > 0)
  setLock(doc, note.id, false, {reason:'原服务无法使用',approver:'测试用户'})
  assert.equal(note.locked, false)
  assert.equal(doc.decisions[0].action, 'unlock')
})

test('cycle, duplicate, budget, time and policy conflicts', () => {
  const doc = fresh('目标')
  const a = addNote(doc, doc.nodes[0].id, 'A')
  const b = addNote(doc, doc.nodes[0].id, 'B')
  addNote(doc, doc.nodes[0].id, 'A')
  a.dependencies = [b.id]; b.dependencies = [a.id]
  a.cost = '10'; doc.policy.budget = '5'
  a.days = '5'; doc.policy.deadline = '2'
  doc.policy.externalPolicy = '禁止翻墙平台'; doc.policy.allowFirewallPlatform = true
  const codes = new Set(conflicts(doc).map(c => c.code))
  for (const code of ['cycle','duplicate','budget','time','policy','unanswered']) assert.ok(codes.has(code), code)
})

test('answers keep question history and update matching policy', () => {
  const doc = fresh('目标')
  answerQuestion(doc, 'firewall', '禁止', '项目网络限制')
  assert.equal(doc.policy.allowFirewallPlatform, false)
  assert.equal(questions(doc).find(q => q.id === 'firewall').level, '可默认')
  assert.equal(doc.answers.firewall.reason, '项目网络限制')
})
