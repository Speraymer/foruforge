import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dataFile=resolve(process.argv[2]||'./work/project-constraint-canvas.json')
if(!dataFile.endsWith('.json'))throw Error('项目数据文件必须使用 .json 扩展名')
const scriptDir=dirname(fileURLToPath(import.meta.url))
const url=execFileSync(process.execPath,[join(scriptDir,'launch.mjs'),dataFile],{encoding:'utf8'}).trim()
const control=join(scriptDir,'window-control.ps1')
const activeFile=dataFile+'.app-active.json'
if(existsSync(activeFile)){
  try{
    const active=JSON.parse(readFileSync(activeFile,'utf8'))
    if(active.runtime!=='webview2')throw Error('窗口运行时不匹配')
    execFileSync('pwsh',['-NoProfile','-File',control,'-Action','focus','-ProcessId',String(active.pid),'-Handle',String(active.handle)],{windowsHide:true,timeout:5000,stdio:['ignore','pipe','pipe']})
    process.stdout.write('已切换到项目约束应用窗口\n')
    process.exit(0)
  }catch{}
}
const host=join(scriptDir,'../native/ProjectConstraints.exe')
if(!existsSync(host))throw Error('未找到项目约束桌面窗口程序')
const appUrl=new URL(url);appUrl.searchParams.set('app','1')
const child=spawn(host,[String(appUrl),dataFile+'.webview2-profile'],{detached:true,windowsHide:false,stdio:'ignore'})
child.unref()
const output=execFileSync('pwsh',['-NoProfile','-File',control,'-Action','frame','-ProcessId',String(child.pid)],{encoding:'utf8',windowsHide:true,timeout:20000})
const active={...JSON.parse(output.trim()),runtime:'webview2'}
writeFileSync(activeFile,JSON.stringify(active,null,2)+'\n')
process.stdout.write(`已打开项目约束无边框应用窗口（PID ${active.pid}）\n`)
