import http from 'node:http'
import { readFileSync, writeFileSync, copyFileSync, existsSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, resolve, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createProject } from './catalog.mjs'
import { fresh, addNote, setLock, answerQuestion, questions, conflicts, exportPack, reviewGaps } from '../scripts/core.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const dataFile = resolve(arg('--data', './work/project-constraint-canvas.json'))
if (!dataFile.endsWith('.json')) throw Error('项目数据文件必须使用 .json 扩展名')
const readyFile = arg('--ready', '')
const port = Number(arg('--port', '0'))
mkdirSync(dirname(dataFile), { recursive: true })
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')
function backup(file) { if (existsSync(file)) copyFileSync(file, file + '.bak-' + stamp()) }
function write(file, content) {
  backup(file)
  const tmp = file + '.tmp-' + process.pid
  writeFileSync(tmp, content)
  renameSync(tmp, file)
}
const read = () => existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : null
const save = doc => write(dataFile, JSON.stringify(doc, null, 2) + '\n')
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
function send(res, status, body, headers = JSON_HEADERS) { res.writeHead(status, headers); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)) }
async function body(req) {
  let size = 0, chunks = []
  for await (const part of req) { size += part.length; if (size > 1_000_000) throw Error('请求过大'); chunks.push(part) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}
const staticFiles = new Map([['/','index.html'],['/app.js','app.js'],['/style.css','style.css'],['/assets/nebula.jpg','assets/nebula.jpg']])
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.jpg':'image/jpeg' }
const allowedNoteFields = new Set(['title','type','description','priority','level','alternatives','forbiddenAlternatives','doneDefinition','verification','owner','status','external','cost','days','tags','color','nodeId'])
const policyFields = new Set(Object.keys(fresh().policy))
const server = http.createServer(async (req,res) => {
  const host = req.headers.host || ''
  if (host !== `127.0.0.1:${server.address().port}`) return send(res,403,{error:'仅允许本机窗口访问'})
  const origin = req.headers.origin
  if (origin && origin !== `http://${host}`) return send(res, 403, { error:'仅允许本地页面调用' })
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
  const url = new URL(req.url || '/', `http://${host || '127.0.0.1'}`)
  try {
    if (req.method === 'GET' && staticFiles.has(url.pathname)) {
      const file = join(here, staticFiles.get(url.pathname))
      if (!existsSync(file)) return send(res,404,{error:'资源不存在'})
      return send(res,200,readFileSync(file),{'content-type':mime[extname(file)],'cache-control':'no-store'})
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res,200,{ ok:true, dataFile, pid:process.pid })
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const doc = read()
      return send(res,200,{ doc, questions: doc ? questions(doc) : [], conflicts: doc ? conflicts(doc) : [], review:doc?reviewGaps(doc):null })
    }
    if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) return send(res,404,{error:'接口不存在'})
    if (!req.headers['content-type']?.startsWith('application/json')) return send(res,415,{error:'需要 JSON 请求'})
    const input = await body(req)
    if (url.pathname === '/api/window') {
      if (!['minimize','close','drag'].includes(input.action)) return send(res,400,{error:'窗口操作无效'})
      if (!existsSync(dataFile+'.app-active.json')) return send(res,409,{error:'应用窗口未启动'})
      const active=JSON.parse(readFileSync(dataFile+'.app-active.json','utf8'))
      execFileSync('pwsh',['-NoProfile','-File',join(here,'../scripts/window-control.ps1'),'-Action',input.action,'-ProcessId',String(active.pid),'-Handle',String(active.handle)],{windowsHide:true,timeout:8000})
      return send(res,200,{ok:true})
    }
    let doc = read()
    if (url.pathname === '/api/start') {
      if (doc) return send(res,409,{error:'此项目文件已经初始化；请使用新的项目文件'})
      if (typeof input.goal !== 'string' || !input.goal.trim() || input.goal.length > 300) return send(res,400,{error:'主会话需确定 1–300 字目标'})
      if (!['enterprise','small','coursework'].includes(input.profile)) return send(res,400,{error:'主会话需先确认开发级别'})
      doc = createProject(input.goal,input.profile)
      save(doc)
      return send(res,200,{doc,questions:questions(doc),conflicts:conflicts(doc),review:reviewGaps(doc)})
    }
    if (!doc) return send(res,409,{error:'等待主会话确定目标并初始化画布'})
    if (url.pathname === '/api/answer') {
      const q = questions(doc).find(q => q.id === input.id)
      if (!q || typeof input.value !== 'string' || input.value.length > 500 || typeof input.reason !== 'string' || input.reason.length > 1000) return send(res,400,{error:'答案无效'})
      answerQuestion(doc,input.id,input.value,input.reason)
      save(doc)
      return send(res,200,{answer:doc.answers[input.id],conflicts:conflicts(doc)})
    }
    if (url.pathname === '/api/policy') {
      if (!policyFields.has(input.key) || !['string','boolean'].includes(typeof input.value) && input.value !== null) return send(res,400,{error:'政策字段无效'})
      doc.policy[input.key] = input.value
      doc.policyConfirmed??={}
      doc.policyConfirmed[input.key]=input.value!==null && input.value!==''
      save(doc)
      return send(res,200,{policy:doc.policy,conflicts:conflicts(doc)})
    }
    if (url.pathname === '/api/policy/confirm') {
      if (!Array.isArray(input.keys) || input.keys.some(key=>!policyFields.has(key))) return send(res,400,{error:'政策字段无效'})
      doc.policyConfirmed??={}
      for (const key of input.keys) if (doc.policy[key]!==null && doc.policy[key]!==undefined && doc.policy[key]!=='') doc.policyConfirmed[key]=true
      save(doc)
      return send(res,200,{review:reviewGaps(doc)})
    }
    if (url.pathname === '/api/note') {
      if (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.length > 200) return send(res,400,{error:'便签标题无效'})
      const note = addNote(doc,input.nodeId,input.title)
      if (['需求','约束','问题','验收','风险'].includes(input.type)) note.type = input.type
      if (input.level === '硬约束') setLock(doc,note.id,true)
      if (note.type === '问题') {
        const node = doc.nodes.find(n=>n.id===note.nodeId), parent=doc.nodes.find(n=>n.id===node.parentId)
        doc.customQuestions.push({id:'note:'+note.id,group:parent.title+'/'+node.title,category:parent.title,title:note.title,level:'建议问',options:['确认此项','暂缓决定'],optionDetails:{'确认此项':{benefit:'把事项纳入执行范围',cost:'需要明确验收方式'},'暂缓决定':{benefit:'给团队留出调查时间',cost:'相关工作可能等待'}},impact:note.description||'影响关联任务',defaultValue:'暂缓决定',noteIds:[note.id]})
      }
      save(doc)
      return send(res,200,{note,conflicts:conflicts(doc)})
    }
    if (url.pathname === '/api/note/update') {
      const note = doc.notes.find(n => n.id === input.id)
      if (!note || typeof input.patch !== 'object' || !input.patch) return send(res,400,{error:'便签不存在或更改无效'})
      for (const [key,value] of Object.entries(input.patch)) {
        if (!allowedNoteFields.has(key) || typeof value !== 'string' || value.length > 3000) return send(res,400,{error:'便签字段无效：'+key})
        if (key === 'level' && note.locked && value !== '硬约束') return send(res,409,{error:'先按流程解除硬约束锁'})
        if (key === 'nodeId' && !doc.nodes.some(n => n.id === value)) return send(res,400,{error:'目标目录不存在'})
        if (key === 'level' && value === '硬约束') setLock(doc,note.id,true)
        else note[key] = value
      }
      const linked = doc.customQuestions?.find(q=>q.noteIds.includes(note.id))
      if (linked) { linked.title=note.title; linked.impact=note.description||linked.impact }
      save(doc)
      return send(res,200,{note,conflicts:conflicts(doc)})
    }
    if (url.pathname === '/api/lock') {
      setLock(doc,input.id,input.locked,{reason:input.reason,approver:input.approver})
      save(doc)
      return send(res,200,{note:doc.notes.find(n => n.id === input.id),decisions:doc.decisions})
    }
    if (url.pathname === '/api/export' || url.pathname === '/api/submit') {
      const kind = url.pathname === '/api/submit' ? 'ai' : input.kind
      const format = url.pathname === '/api/submit' ? 'json' : input.format
      if (!['ai','task'].includes(kind) || !['json','text'].includes(format)) return send(res,400,{error:'导出类型无效'})
      const override = input.override && typeof input.override.by === 'string' && typeof input.override.reason === 'string' ? input.override : undefined
      const content = exportPack(doc,kind,format,override)
      if (url.pathname === '/api/submit') {
        doc.submittedAt = new Date().toISOString()
        const packFile = dataFile.replace(/\.json$/,'') + '.execution-pack.json'
        write(packFile,content+'\n')
        doc.executionPackFile = packFile
        save(doc)
        return send(res,200,{submittedAt:doc.submittedAt,packFile,conflicts:conflicts(doc)})
      }
      if (override) save(doc)
      return send(res,200,{content,filename:`project-${kind}.${format==='json'?'json':'txt'}`})
    }
    return send(res,404,{error:'接口不存在'})
  } catch (err) {
    const status = /未回答|未确认|确认默认/.test(err.message) ? 409 : 400
    return send(res,status,{error:err.message})
  }
})
server.listen(port,'127.0.0.1',()=>{
  const url = `http://127.0.0.1:${server.address().port}/`
  if (readyFile) writeFileSync(readyFile,JSON.stringify({url,pid:process.pid,dataFile}))
  process.stdout.write(url+'\n')
})
