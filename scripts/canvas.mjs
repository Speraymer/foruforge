import { readFileSync, writeFileSync, copyFileSync, existsSync, renameSync } from 'node:fs'
import { resolve, dirname, basename, join } from 'node:path'
import { fresh, addNode, addNote, setLock, questions, conflicts, exportPack, answerQuestion } from './core.mjs'

const [command, fileArg, ...args] = process.argv.slice(2)
if (!command || !fileArg) throw Error('用法：node canvas.mjs <init|analyze|questions|check|add-node|add-note|answer|lock|export> <project.json> ...')
const file = resolve(fileArg)
const read = () => JSON.parse(readFileSync(file, 'utf8'))
function save(doc) {
  if (existsSync(file)) copyFileSync(file, file + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-'))
  const tmp = join(dirname(file), '.' + basename(file) + '.tmp-' + process.pid)
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n')
  renameSync(tmp, file)
}
function show(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n') }

if (command === 'init') {
  if (existsSync(file)) throw Error('项目文件已存在；不会覆盖')
  if (!args[0]?.trim()) throw Error('需要一句话目标')
  save(fresh(args[0].trim()))
  show({ file, goal: args[0].trim() })
} else if (command === 'analyze') {
  const doc = read()
  if (doc.nodes.length === 1) {
    for (const [title, children] of [
      ['范围与目标', ['本期范围', '非目标']], ['实现方案', ['功能与依赖', '环境权限']],
      ['验收与交付', ['验收标准', '交付包']], ['风险与依赖', ['风险与回滚', '预算与时间']]
    ]) {
      const big = addNode(doc, doc.nodes[0].id, title)
      for (const child of children) addNode(doc, big.id, child)
    }
  }
  if (!doc.notes.some(n => n.tags === '目标入口')) {
    const target = doc.nodes.find(n => n.kind === '小项')
    const note = addNote(doc, target.id, doc.goal)
    note.tags = '目标入口'
  }
  save(doc)
  show({ nodes: doc.nodes, questions: questions(doc), conflicts: conflicts(doc) })
} else if (command === 'questions') show(questions(read()))
else if (command === 'check') show(conflicts(read()))
else if (command === 'add-node') { const doc = read(), node = addNode(doc, args[0], args[1]); save(doc); show(node) }
else if (command === 'add-note') { const doc = read(), note = addNote(doc, args[0], args[1]); save(doc); show(note) }
else if (command === 'answer') {
  const doc = read(), [questionId, value, reason = ''] = args
  const answer = answerQuestion(doc, questionId, value, reason)
  save(doc); show(answer)
} else if (command === 'lock') {
  const doc = read(), [noteId, mode, approver, reason] = args
  if (!['on', 'off'].includes(mode)) throw Error('锁定模式只能是 on/off')
  setLock(doc, noteId, mode === 'on', { approver, reason })
  save(doc); show(doc.notes.find(n => n.id === noteId))
} else if (command === 'export') {
  const doc = read(), [kind, format, outputArg, approver, reason] = args
  if (!['task', 'ai'].includes(kind) || !['text', 'json'].includes(format) || !outputArg) throw Error('用法：export <project.json> <task|ai> <text|json> <输出路径> [确认人] [默认策略理由]')
  const output = resolve(outputArg)
  if (existsSync(output)) throw Error('导出文件已存在；不会覆盖')
  const content = exportPack(doc, kind, format, approver && reason ? { by: approver, reason } : undefined)
  writeFileSync(output, content + '\n')
  if (doc.exportOverrides.length) save(doc)
  show({ output, kind, format, bytes: Buffer.byteLength(content) })
} else throw Error('未知命令：' + command)
