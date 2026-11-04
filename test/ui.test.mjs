import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createProject } from '../ui/plan.mjs'
import { questions, answerQuestion } from '../scripts/core.mjs'

const outline = [
  {title:'内容要求',sections:[{title:'立意',questions:[{title:'文章侧重哪层关系？',level:'建议问',impact:'决定论证主线',defaultValue:'本手是妙手的基础',options:[{value:'基础与创造',benefit:'紧扣材料',cost:'需避免空泛'},{value:'反思俗手',benefit:'有辨析空间',cost:'需说明前两者关系'}]}]}]},
  {title:'交付',sections:[{title:'文件',questions:[{title:'交付哪些文件？',level:'阻塞必须问',impact:'决定文件制作',options:[]}]}]}
]

test('main chat outline determines branches, questions and answer form', () => {
  const doc = createProject('写一篇本手妙手俗手作文','general','三手作文',outline)
  assert.equal(doc.title,'三手作文')
  assert.equal(doc.goal,'写一篇本手妙手俗手作文')
  const list = questions(doc)
  assert.equal(list.length,2)
  assert.equal(doc.nodes.filter(n=>n.kind==='大项').length,2)
  assert.deepEqual(list.map(q=>q.group),['内容要求/立意','交付/文件'])
  assert.deepEqual(list[0].options,['基础与创造','反思俗手'])
  assert.equal(list[1].options.length,0)
  assert.equal(doc.requiredPolicyKeys.join(','),'questionStrategy,deliveryFormat')
  answerQuestion(doc,list[0].id,'基础与创造','紧扣题目')
  assert.equal(doc.answers[list[0].id].reason,'紧扣题目')
})

test('invalid outline is rejected before any project is built', () => {
  assert.throws(()=>createProject('目标','general','标题'),/目录/)
  assert.throws(()=>createProject('目标','general','标题',[{title:'A',sections:[{title:'B',questions:[]}]}]),/问题/)
  assert.throws(()=>createProject('目标','general','标题',outline,['dataExport']),/无法在画布/)
  assert.throws(()=>createProject('目标','general','超过八个字的展示标题',outline),/展示标题/)
  assert.throws(()=>createProject('目标','general','标题',[...outline,outline[0]]),/重复/)
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
    assert.equal((await request('/api/start',{goal:'完整目标',profile:'general',title:'超过八个字的展示标题',outline})).status,400)
    assert.equal((await request('/api/start',{goal:'完整目标',profile:'general',title:'短标题'})).status,400)
    const started = await request('/api/start',{goal:'写一篇本手妙手俗手作文',profile:'general',title:'三手作文',outline})
    assert.equal(started.body.doc.title,'三手作文')
    assert.equal(started.body.questions.length,2)
    assert.equal(started.body.review.policy.length,2)
    assert.equal((await request('/api/start',{goal:'另一个目标',profile:'enterprise',replace:true})).status,409)
    assert.equal((await request('/api/submit',{})).status,409)
    assert.equal((await request('/api/answer',{id:'q001',value:'基础与创造',reason:'紧扣题目'})).status,200)
    assert.equal((await request('/api/state')).body.doc.answers.q001.value,'基础与创造')
    assert.equal((await request('/api/export',{kind:'task',format:'json'})).status,409)
    const exported=await request('/api/export',{kind:'task',format:'json',override:{by:'测试用户',reason:'仅测试默认策略'}})
    assert.equal(exported.status,200)
    const pack=JSON.parse(exported.body.content)
    assert.equal(pack.questions.length,2)
    assert.equal(pack.answerSummary.answered,1)
    assert.equal(pack.notes.length,0)
    assert.equal(pack.readyForExecution,false)
    assert.equal(pack.status,'未完成规划草案')
    const textExport=await request('/api/export',{kind:'ai',format:'text',override:{by:'测试用户',reason:'资料待补'}})
    assert.match(textExport.body.content,/未完成规划草案/)
    assert.match(textExport.body.content,/^# 给 AI 的项目约束/m)
    assert.doesNotMatch(textExport.body.content,/DSH|主会话|新对话|派发|当前用途|下一步|执行要求|不要|不得|不能据此|不代表|完成定义：；|[0-9a-f]{8}-[0-9a-f]{4}-/)
    assert.equal((await request('/api/policy/confirm',{keys:['questionStrategy']})).body.review.policy.length,1)
    assert.equal((await request('/api/submit',{override:{by:'测试用户',reason:'先交主会话补充'}})).status,200)
    const nodeId=started.body.doc.nodes.find(n=>n.kind==='小项').id
    const created=await request('/api/note',{nodeId,title:'必须保留凭证',type:'约束',level:'硬约束'})
    assert.equal(created.body.note.locked,true)
    assert.equal((await request('/api/lock',{id:created.body.note.id,locked:false})).status,400)
    const unlocked=await request('/api/lock',{id:created.body.note.id,locked:false,approver:'测试用户',reason:'方案变更'})
    assert.equal(unlocked.body.decisions.at(-1).action,'unlock')
    const custom=await request('/api/note',{nodeId,title:'是否需要纸质归档？',type:'问题',level:'软约束'})
    assert.equal((await request('/api/state')).body.questions.length,3)
    await request('/api/note/update',{id:custom.body.note.id,patch:{title:'纸质票据是否归档？'}})
    assert.ok((await request('/api/state')).body.questions.some(q=>q.title==='纸质票据是否归档？'))
    const secondNode=started.body.doc.nodes.filter(n=>n.kind==='小项')[1].id
    await request('/api/note/update',{id:custom.body.note.id,patch:{nodeId:secondNode}})
    assert.equal((await request('/api/state')).body.questions.find(q=>q.id==='note:'+custom.body.note.id).group,'交付/文件')
    await request('/api/note/update',{id:custom.body.note.id,patch:{type:'需求'}})
    assert.equal((await request('/api/state')).body.questions.length,2)
    await request('/api/note/update',{id:custom.body.note.id,patch:{type:'问题'}})
    assert.equal((await request('/api/state')).body.questions.length,3)
  } finally { child.kill() }
})
