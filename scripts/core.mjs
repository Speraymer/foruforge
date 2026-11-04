const id = () => crypto.randomUUID()
const text = value => String(value ?? '').trim()
const noteTypes = ['需求', '约束', '问题', '验收', '风险']
const levels = ['硬约束', '软约束', '偏好', '禁止项']
const statuses = ['待确认', '已确认', '阻塞', '已验收']

export function fresh(goal = '') {
  const project = id()
  return { version: 1, goal, nodes: [{ id: project, parentId: null, title: '项目', kind: '项目', order: 0 }], notes: [], customQuestions: [], policy: {
    questionStrategy: '阻塞必停', externalPolicy: '需审批', allowFirewallPlatform: null,
    allowOverseasApi: null, allowNonOpenLicense: null, allowPaid: null,
    budget: '', deadline: '', stack: '', deployment: '', accountPermissions: '', dataExport: null,
    compliance: '', deliveryFormat: '', compatibility: '', docsTests: '', failureStrategy: '',
    rollbackBackup: '', irreversibleApproval: ''
  }, policyConfirmed: {}, answers: {}, decisions: [], exportOverrides: [] }
}

export function addNode(doc, parentId, title) {
  const parent = doc.nodes.find(n => n.id === parentId)
  if (!parent || !['项目', '大项'].includes(parent.kind)) throw Error('目录只能建在项目或大项之下')
  const kind = parent.kind === '项目' ? '大项' : '小项'
  const node = { id: id(), parentId, title: text(title), kind, order: doc.nodes.filter(n => n.parentId === parentId).length }
  if (!node.title) throw Error('目录名不能为空')
  doc.nodes.push(node)
  return node
}

export function addNote(doc, nodeId, title) {
  if (!doc.nodes.some(n => n.id === nodeId)) throw Error('目录不存在')
  const note = { id: id(), nodeId, title: text(title), type: '需求', description: '', priority: '中',
    level: '软约束', locked: false, alternatives: '', forbiddenAlternatives: '', doneDefinition: '',
    verification: '', dependencies: [], blockers: [], owner: '', status: '待确认', questionIds: [],
    decisionIds: [], external: '', cost: '', days: '', tags: '', color: '' }
  if (!note.title) throw Error('便签标题不能为空')
  doc.notes.push(note)
  return note
}

export function setLock(doc, noteId, locked, decision) {
  const note = doc.notes.find(n => n.id === noteId)
  if (!note) throw Error('便签不存在')
  if (!locked && note.locked) {
    if (!text(decision?.reason) || !text(decision?.approver)) throw Error('解锁必须填写理由和审批人')
    const record = { id: id(), noteId, action: 'unlock', reason: text(decision.reason), approver: text(decision.approver), at: new Date().toISOString() }
    doc.decisions.push(record)
    note.decisionIds.push(record.id)
  }
  note.locked = !!locked
  if (locked) note.level = '硬约束'
  else if (note.level === '硬约束') note.level = '软约束'
}

const q = (key, category, level, title, options, impact, noteIds = [], defaultValue = '暂停并询问') =>
  ({ id: key, category, level, title, options, impact, noteIds, defaultValue })

export function questions(doc) {
  if (Array.isArray(doc.customQuestions) && (doc.dynamicOutline || doc.customQuestions.length)) return doc.customQuestions
  const p = doc.policy, notes = doc.notes, hard = notes.filter(n => n.locked || n.level === '硬约束')
  const list = [
    q('scope', '范围', '阻塞必须问', '本期必须完成哪些项？明确不做哪些项？', ['全部硬约束本期完成；其他按优先级', '指定本期清单'], '决定执行包的范围与排期', hard.map(n => n.id)),
    q('acceptor', '验收', '阻塞必须问', '由谁最终验收？', ['项目发起人', '指定负责人'], '决定验收责任人'),
    q('substitution', '替代规则', hard.length ? '阻塞必须问' : '建议问', '硬约束需要变更时由谁批准？', ['逐项人工审批', '一律不允许替代'], '未经批准的替代会阻塞执行', hard.map(n => n.id), '不允许替代'),
    q('ambiguity', '提问策略', '可默认', '遇到歧义、阻塞或高风险操作如何处理？', ['阻塞必停', '只记录继续', '按默认继续', '到节点再停'], '影响执行中断点', [], p.questionStrategy),
    q('overrun', '成本时间', '建议问', '超预算或超时先缩范围还是加资源？', ['先缩软约束范围', '申请资源', '停下询问'], '硬约束不能被自动缩减'),
    q('failure', '失败处理', '建议问', '失败时如何回滚、备份和审批不可逆操作？', ['先备份再操作，失败回滚', '停下逐项审批'], '降低数据损失风险'),
    q('delivery', '协作交付', '建议问', '交付格式、兼容版本、文档与测试要求是什么？', ['文档、测试、可复现结果', '指定标准'], '决定完成证明')
  ]
  const external = [
    ['firewall', '允许使用需翻墙平台吗？', 'allowFirewallPlatform'],
    ['overseas', '允许境外 API 吗？', 'allowOverseasApi'],
    ['license', '允许非开源许可吗？', 'allowNonOpenLicense'],
    ['paid', '允许付费服务吗？', 'allowPaid']
  ]
  for (const [key, title, field] of external)
    list.push(q(key, '外部依赖', p[field] === null ? '阻塞必须问' : '可默认', title, ['允许', '禁止', '需审批'], '决定可选服务和替代路线', notes.filter(n => n.external).map(n => n.id), p[field] === true ? '允许' : '禁止'))
  list.push(q('environment', '环境权限', p.deployment ? '可默认' : '阻塞必须问', '部署到哪里？有哪些账号权限？', ['本机演示', '指定环境'], '决定可执行的部署步骤', [], p.deployment || '暂停并询问'))
  list.push(q('data', '环境权限', p.dataExport === null ? '阻塞必须问' : '可默认', '项目数据能否上传或出境？', ['不可上传或出境', '指定范围内允许'], '决定数据处理边界', [], p.dataExport === true ? '指定范围内允许' : '不可上传或出境'))
  for (const n of notes) {
    if (!n.doneDefinition || !n.verification) list.push(q('accept:'+n.id, '验收', n.locked ? '阻塞必须问' : '建议问', `「${n.title}」如何证明完成？`, ['补充完成定义与验证方式', '移出本期'], '缺少验收证据无法宣告完成', [n.id]))
    if (n.type === '问题') list.push(q('note:'+n.id, '便签问题', n.priority === '高' ? '阻塞必须问' : '建议问', n.title, ['按便签描述确认', '暂缓决定'], '影响关联任务', [n.id]))
    if (n.type === '风险') list.push(q('risk:'+n.id, '风险', '风险提示', `如何处置风险「${n.title}」？`, ['降低发生概率', '准备回滚方案', '接受并监控'], '影响失败应对和验收', [n.id], '暂停并评估'))
  }
  return list
}

export function answerQuestion(doc, questionId, value, reason = '') {
  if (!questions(doc).some(x => x.id === questionId)) throw Error('问题不存在')
  if (!text(value)) throw Error('答案不能为空')
  doc.answers[questionId] = { value: text(value), reason: text(reason), at: new Date().toISOString() }
  const policyField = { firewall: 'allowFirewallPlatform', overseas: 'allowOverseasApi', license: 'allowNonOpenLicense', paid: 'allowPaid' }[questionId]
  if (policyField && ['允许', '禁止'].includes(value)) {doc.policy[policyField] = value === '允许';(doc.policyConfirmed??={})[policyField]=true}
  if (questionId === 'ambiguity' && ['阻塞必停', '只记录继续', '按默认继续', '到节点再停'].includes(value)) {doc.policy.questionStrategy = value;(doc.policyConfirmed??={}).questionStrategy=true}
  if (questionId === 'environment' && value === '本机演示') {doc.policy.deployment = value;(doc.policyConfirmed??={}).deployment=true}
  if (questionId === 'data') {
    if (value === '不可上传或出境') {doc.policy.dataExport = false;(doc.policyConfirmed??={}).dataExport=true}
    if (value === '指定范围内允许') {doc.policy.dataExport = true;(doc.policyConfirmed??={}).dataExport=true}
  }
  return doc.answers[questionId]
}

const policyLabels = {
  questionStrategy:['遇问题策略','建议确认“阻塞必停”'], externalPolicy:['外部依赖政策','建议确认“需审批”'],
  dataExport:['数据能否上传或出境','建议明确禁止或许可范围'], deployment:['部署环境','建议明确本机、内网或生产环境'],
  deliveryFormat:['交付格式','建议写明需要交付的文件或成果'], docsTests:['验收与检查','建议写明检查方式'], accountPermissions:['账号与权限','建议提供测试账号和授权范围'],
  budget:['预算上限','建议给出金额或明确零新增费用'], deadline:['时间上限','建议给出截止日或天数'],
  compliance:['合规与安全要求','建议提供组织现有标准'], rollbackBackup:['回滚与备份','建议说明恢复方法'],
  irreversibleApproval:['不可逆操作审批','建议指定审批人和触发条件']
}
const requiredPolicy = {
  general:['questionStrategy','externalPolicy'],
  small:['questionStrategy','externalPolicy','dataExport','deployment'],
  enterprise:['questionStrategy','externalPolicy','dataExport','deployment','accountPermissions','budget','deadline','compliance','rollbackBackup','irreversibleApproval'],
  coursework:['questionStrategy','externalPolicy','deliveryFormat']
}
export function reviewGaps(doc) {
  const pendingQuestions=questions(doc).filter(x=>x.level==='阻塞必须问'&&!doc.answers[x.id]?.value)
  const keys=doc.requiredPolicyKeys ?? requiredPolicy[doc.profile || 'small'] ?? requiredPolicy.general
  const pendingPolicy=keys.filter(key=>doc.policy[key]===null || doc.policy[key]===undefined || doc.policy[key]==='' || !doc.policyConfirmed?.[key])
    .map(key=>({key,label:policyLabels[key]?.[0]||key,suggestion:policyLabels[key]?.[1]||'请确认该设置'}))
  return {questions:pendingQuestions,policy:pendingPolicy}
}

export function conflicts(doc) {
  const out = [], p = doc.policy, nodes = doc.nodes, notes = doc.notes
  const push = (code, message, fix, noteIds = []) => out.push({ code, message, fix, noteIds })
  for (const n of nodes) if (n.kind === '小项' && !nodes.some(x => x.id === n.parentId && x.kind === '大项')) push('orphan', `小项「${n.title}」没有有效大项`, '移动到有效大项下')
  const seen = new Set()
  for (const n of notes) {
    const key = n.nodeId + ':' + n.title.toLocaleLowerCase()
    if (seen.has(key)) push('duplicate', `重复便签「${n.title}」`, '合并或改名', [n.id]); seen.add(key)
    if ((n.locked || n.level === '硬约束') && (!n.doneDefinition || !n.verification)) push('hard-accept', `硬约束「${n.title}」缺少验收标准`, '补充完成定义和验证方式', [n.id])
    if (n.status === '已验收' && !n.verification) push('verified-no-method', `「${n.title}」已验收但无验证方式`, '填写验证方式或撤回状态', [n.id])
    if (n.locked && n.alternatives) push('locked-alternative', `「${n.title}」仍锁定却填写替代方案`, '保持原方案或正式解锁审批', [n.id])
    if (n.alternatives && n.level === '硬约束' && !doc.decisions.some(d => d.noteId === n.id && d.action === 'unlock' && d.reason && d.approver && d.at)) push('unapproved-alternative', `「${n.title}」的替代方案未获审批`, '记录解锁理由、审批人、时间', [n.id])
    if (n.external === '需翻墙平台' && (p.externalPolicy === '禁止翻墙平台' || p.allowFirewallPlatform === false)) push('firewall', `「${n.title}」需要被禁止的翻墙平台`, '更换依赖或修改政策并审批', [n.id])
    if (n.external === '境外 API' && p.allowOverseasApi === false) push('overseas-api', `「${n.title}」需要被禁止的境外 API`, '更换依赖或修改政策并审批', [n.id])
    if (n.external === '付费服务' && p.allowPaid === false) push('paid', `「${n.title}」需要被禁止的付费服务`, '更换依赖或修改政策并审批', [n.id])
    if (n.locked && n.external && p.externalPolicy === '需替代方案' && !n.alternatives) push('hard-external', `硬约束「${n.title}」依赖外部服务且政策要求替代路线`, '补充可行依赖方案；硬约束本身不得替代', [n.id])
  }
  const byId = new Map(notes.map(n => [n.id, n]))
  const visiting = new Set(), done = new Set()
  function visit(n) { if (visiting.has(n.id)) { push('cycle', `依赖循环涉及「${n.title}」`, '移除循环依赖', [n.id]); return } if (done.has(n.id)) return; visiting.add(n.id); for (const dep of n.dependencies || []) if (byId.has(dep)) visit(byId.get(dep)); visiting.delete(n.id); done.add(n.id) }
  notes.forEach(visit)
  const cost = notes.reduce((a,n) => a + (Number(n.cost) || 0), 0), days = notes.reduce((a,n) => a + (Number(n.days) || 0), 0)
  if (p.budget && cost > Number(p.budget)) push('budget', `估算成本 ${cost} 超过预算 ${p.budget}`, '缩减非硬约束范围或申请预算')
  if (p.deadline && days > Number(p.deadline)) push('time', `串行估算 ${days} 天超过时间上限 ${p.deadline} 天`, '重排并行任务或申请时间；需复核估算')
  if (p.externalPolicy === '禁止翻墙平台' && p.allowFirewallPlatform === true) push('policy', '外部依赖政策与允许翻墙平台设置矛盾', '统一政策')
  if (p.externalPolicy === '允许翻墙平台' && p.allowFirewallPlatform === false) push('policy', '外部依赖政策与禁止翻墙平台设置矛盾', '统一政策')
  const gaps=reviewGaps(doc)
  if (gaps.questions.length) push('unanswered', `${gaps.questions.length} 个阻塞问题未回答`, '回答问题或显式确认留空并导出草案')
  if (gaps.policy.length) push('unconfirmed-policy', `${gaps.policy.length} 项必填全局政策未确认`, '在全局设置中填写或确认；也可显式留空导出草案')
  return out
}

export function exportPack(doc, kind, format, override) {
  const gaps=reviewGaps(doc), unresolved=gaps.questions.length+gaps.policy.length
  if (unresolved && (!text(override?.by) || !text(override?.reason))) throw Error(`仍有 ${gaps.questions.length} 个阻塞问题和 ${gaps.policy.length} 项必填全局政策未确认；须显式确认留空并记录人和理由`)
  const decision=unresolved ? {at:new Date().toISOString(),by:text(override.by),reason:text(override.reason),questionIds:gaps.questions.map(x=>x.id),policyKeys:gaps.policy.map(x=>x.key),scope:'确认导出含待确认事项的规划草案'} : null
  if (decision) (doc.exportOverrides??=[]).push(decision)
  const realNotes=doc.notes.filter(n=>n.type!=='问题')
  const allQuestions=questions(doc).map(x=>({...x,answer:doc.answers[x.id]||null}))
  const acceptance=realNotes.filter(n=>n.doneDefinition||n.verification).map(n=>({id:n.id,title:n.title,doneDefinition:n.doneDefinition,verification:n.verification,owner:n.owner}))
  const executionOrder=doc.nodes.flatMap(node=>realNotes.filter(n=>n.nodeId===node.id).map(n=>n.id))
  const pack={schemaVersion:2,kind,goal:doc.goal,profile:doc.profile||'small',status:unresolved?'未完成规划草案':'约束记录',readyForExecution:false,
    answerSummary:{answered:allQuestions.filter(x=>x.answer).length,total:allQuestions.length,unansweredBlocking:gaps.questions.map(x=>x.id),unconfirmedRequiredPolicy:gaps.policy},
    tree:doc.nodes,notes:realNotes,hardConstraints:realNotes.filter(n=>n.locked||n.level==='硬约束'),prohibitions:realNotes.filter(n=>n.level==='禁止项'),policy:doc.policy,policyConfirmed:doc.policyConfirmed||{},requiredPolicyKeys:doc.requiredPolicyKeys||null,
    questions:allQuestions,conflicts:conflicts(doc),decisions:doc.decisions,exportOverride:decision,acceptance,executionOrder,defaultStrategy:doc.policy.questionStrategy}
  if (format==='json') return JSON.stringify(pack,null,2)
  const answered=allQuestions.filter(x=>x.answer), pending=allQuestions.filter(x=>!x.answer)
  const showValue=v=>typeof v==='boolean'?(v?'允许':'禁止'):String(v)
  const policyLines=Object.entries(doc.policy).filter(([,v])=>v!==null&&v!==undefined&&v!=='').map(([key,value])=>`- ${policyLabels[key]?.[0]||key}：${showValue(value)}${doc.policyConfirmed?.[key]?'':'（预设或未确认）'}`)
  const lines=[`# ${kind==='ai'?'给 AI 的项目约束':'项目任务书'}`,`目标：${doc.goal}`,`状态：${pack.status}；已回答 ${answered.length}/${allQuestions.length} 题。${unresolved?'待确认事项列于下文。':''}`]
  lines.push('', '## 目录',...doc.nodes.filter(n=>n.kind!=='项目').map(n=>`${n.kind==='大项'?'':'  '}- ${n.title}`),
    '', '## 已确认决策',...(answered.length?answered.map(x=>`- ${x.title}：${x.answer.value}${x.answer.reason?`（理由：${x.answer.reason}）`:''}`):['- 暂无已回答问题。']),
    '', '## 尚待确认',...(pending.length?pending.map(x=>`- [${x.level}] ${x.title}；建议选项：${x.options.join(' / ')}；参考预设：${x.defaultValue}（待确认）`):['- 问题池已全部回答。']),
    ...gaps.policy.map(x=>`- [必填全局项] ${x.label}；${x.suggestion}`),
    '', '## 全局政策',...(policyLines.length?policyLines:['- 尚未设置。']),
    '', '## 执行便签',...(realNotes.length?realNotes.map(n=>`- [${n.type}/${n.level}] ${n.title}${n.description?`：${n.description}`:''}`):['- 尚无执行便签；问题便签只用于澄清需求。']),
    '', '## 硬约束与禁止项',...(pack.hardConstraints.map(n=>`- 必须完成且不可替代：${n.title}`)),...(pack.prohibitions.map(n=>`- 禁止：${n.title}`)),...(pack.hardConstraints.length||pack.prohibitions.length?[]:['- 待确认。']),
    '', '## 验收标准',...(acceptance.length?acceptance.map(n=>`- ${n.title}：完成定义 ${n.doneDefinition||'待补充'}；验证 ${n.verification||'待补充'}${n.owner?`；负责人 ${n.owner}`:''}`):['- 尚未定义可执行便签的验收标准。']),
    '', '## 执行顺序',executionOrder.length?executionOrder.map(id=>realNotes.find(n=>n.id===id)?.title).join(' → '):'待范围和验收确认后制定。',
    '', '## 冲突与风险',...(pack.conflicts.filter(x=>!['unanswered','unconfirmed-policy'].includes(x.code)).length?pack.conflicts.filter(x=>!['unanswered','unconfirmed-policy'].includes(x.code)).map(x=>`- ${x.message}；建议：${x.fix}`):['- 除以上待确认事项外，当前规则未发现其他冲突。']))
  if (decision) lines.push('',`规划草案确认：${decision.by}；理由：${decision.reason}。`)
  if (doc.decisions.length) lines.push('', '## 约束变更记录',...doc.decisions.map(x=>`- ${x.action}：${x.reason}；审批人 ${x.approver}；时间 ${x.at}`))
  return lines.join('\n')
}
