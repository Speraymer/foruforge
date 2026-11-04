import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createProject } from '../ui/catalog.mjs'
import { questions, answerQuestion } from '../scripts/core.mjs'

test('expense goal expands into 18 grouped decisions', () => {
  const doc = createProject('为小团队制作内部报销审批小程序')
  const list = questions(doc)
  assert.equal(list.length,18)
  assert.equal(new Set(list.map(q=>q.group)).size,9)
  assert.ok(list.every(q=>q.options.length>=2 && q.options.every(v=>q.optionDetails[v]?.benefit && q.optionDetails[v]?.cost)))
  answerQuestion(doc,'q01','微信小程序','团队目前使用微信')
  assert.equal(doc.answers.q01.reason,'团队目前使用微信')
})

test('development levels produce distinct language and boundaries', () => {
  const goal='制作一个小团队报销审批应用'
  const enterprise=createProject(goal,'enterprise'), small=createProject(goal,'small'), coursework=createProject(goal,'coursework')
  for(const doc of [enterprise,small,coursework]) assert.equal(questions(doc).length,18)
  assert.match(questions(enterprise).find(q=>q.id==='q03').title,/真实资金流/)
  assert.match(questions(coursework).find(q=>q.id==='q06').title,/演示数据/)
  assert.doesNotMatch(questions(coursework).map(q=>q.title).join(' '),/清结算|RPO|OIDC/)
  assert.doesNotMatch(questions(small).map(q=>q.title).join(' '),/多聊天|派发/)
})

test('local page API saves answers, blocks premature submission and enforces unlock audit', async () => {
  const dataFile = join(tmpdir(),'codex-canvas-'+randomUUID()+'.json')
  const child = spawn(process.execPath,[fileURLToPath(new URL('../ui/server.mjs',import.meta.url)),'--data',dataFile],{stdio:['ignore','pipe','pipe']})
  try {
    const base = await new Promise((resolve,reject) => {
      let buffer=''
      const timer=setTimeout(()=>reject(Error('server timeout')),5000)
      child.stdout.on('data',part=>{buffer+=part;const line=buffer.split('\n')[0];if(line.startsWith('http://')){clearTimeout(timer);resolve(line.trim())}})
      child.on('exit',code=>reject(Error('server exited '+code)))
    })
    const request = async (path, data) => {
      const response = await fetch(new URL(path,base),data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)})
      return {status:response.status,body:await response.json()}
    }
    assert.equal((await request('/api/state')).body.doc,null)
    const foreignHostStatus = await new Promise((resolve,reject) => {
      const req=httpRequest(new URL('/api/state',base),{headers:{host:'other.example'}},res=>{res.resume();resolve(res.statusCode)})
      req.on('error',reject);req.end()
    })
    assert.equal(foreignHostStatus,403)
    assert.equal((await request('/api/window',{action:'invalid'})).status,400)
    assert.equal((await request('/api/window',{action:'minimize'})).status,409)
    assert.equal((await request('/api/start',{goal:'测试'})).status,400)
    const started = await request('/api/start',{goal:'为小团队制作内部报销审批小程序',profile:'small'})
    assert.equal(started.body.questions.length,18)
    assert.equal(started.body.review.policy.length,4)
    assert.equal((await request('/api/start',{goal:'另一个目标',profile:'enterprise',replace:true})).status,409)
    assert.equal((await request('/api/submit',{})).status,409)
    assert.equal((await request('/api/answer',{id:'q01',value:'微信小程序',reason:'团队使用微信'})).status,200)
    assert.equal((await request('/api/state')).body.doc.answers.q01.value,'微信小程序')
    assert.equal((await request('/api/export',{kind:'task',format:'json'})).status,409)
    const exported=await request('/api/export',{kind:'task',format:'json',override:{by:'测试用户',reason:'仅测试默认策略'}})
    assert.equal(exported.status,200)
    const pack=JSON.parse(exported.body.content)
    assert.equal(pack.questions.length,18)
    assert.equal(pack.answerSummary.answered,1)
    assert.equal(pack.notes.length,0)
    assert.equal(pack.readyForExecution,false)
    assert.equal(pack.status,'未完成规划草案')
    const textExport=await request('/api/export',{kind:'ai',format:'text',override:{by:'测试用户',reason:'资料待补'}})
    assert.match(textExport.body.content,/未完成规划草案/)
    assert.match(textExport.body.content,/^# 给 AI 的项目约束/m)
    assert.doesNotMatch(textExport.body.content,/DSH|主会话|新对话|派发|当前用途|下一步|执行要求|不要|不得|不能据此|不代表|完成定义：；|[0-9a-f]{8}-[0-9a-f]{4}-/)
    assert.equal((await request('/api/policy/confirm',{keys:['questionStrategy','externalPolicy']})).body.review.policy.length,2)
    assert.equal((await request('/api/submit',{override:{by:'测试用户',reason:'先交主会话补充'}})).status,200)
    const nodeId=started.body.doc.nodes.find(n=>n.kind==='小项').id
    const created=await request('/api/note',{nodeId,title:'必须保留凭证',type:'约束',level:'硬约束'})
    assert.equal(created.body.note.locked,true)
    assert.equal((await request('/api/lock',{id:created.body.note.id,locked:false})).status,400)
    const unlocked=await request('/api/lock',{id:created.body.note.id,locked:false,approver:'测试用户',reason:'方案变更'})
    assert.equal(unlocked.body.decisions.at(-1).action,'unlock')
    const custom=await request('/api/note',{nodeId,title:'是否需要纸质归档？',type:'问题',level:'软约束'})
    assert.equal((await request('/api/state')).body.questions.length,19)
    await request('/api/note/update',{id:custom.body.note.id,patch:{title:'纸质票据是否归档？'}})
    assert.ok((await request('/api/state')).body.questions.some(q=>q.title==='纸质票据是否归档？'))
  } finally { child.kill() }
})
