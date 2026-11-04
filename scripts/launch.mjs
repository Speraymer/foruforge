import { spawn } from 'node:child_process'
import { openSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const dataFile = resolve(process.argv[2] || './work/project-constraint-canvas.json')
if (!dataFile.endsWith('.json')) throw Error('项目数据文件必须使用 .json 扩展名')
mkdirSync(dirname(dataFile), { recursive:true })
const activeFile = dataFile + '.ui-active.json'
if (existsSync(activeFile)) {
  try {
    const active = JSON.parse(readFileSync(activeFile,'utf8'))
    const response = await fetch(new URL('/api/health',active.url),{signal:AbortSignal.timeout(1000)})
    const health = await response.json()
    if (health.ok && health.dataFile === dataFile) { process.stdout.write(active.url+'\n'); process.exit(0) }
  } catch {}
}
const readyFile = dataFile + '.ui-ready-' + randomUUID() + '.json'
const logFile = dataFile + '.ui-server.log'
const log = openSync(logFile,'a')
const child = spawn(process.execPath,[fileURLToPath(new URL('../ui/server.mjs',import.meta.url)),'--data',dataFile,'--ready',readyFile],{detached:true,windowsHide:true,stdio:['ignore',log,log]})
child.unref()
let ready
for (let attempt=0;attempt<60;attempt++) {
  if (existsSync(readyFile)) { ready = JSON.parse(readFileSync(readyFile,'utf8')); break }
  await new Promise(resolve=>setTimeout(resolve,100))
}
if (!ready) throw Error('本地页面启动失败；查看 '+logFile)
writeFileSync(activeFile,JSON.stringify(ready,null,2)+'\n')
process.stdout.write(ready.url+'\n')
