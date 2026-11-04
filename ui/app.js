const app = document.querySelector('#app')
let state = { doc:null, questions:[], conflicts:[], review:null }
let selectedSub = null, tab = 'policy', renderedTab = tab, workspaceOpen = false, reviewAction = null, editNoteId = null, lastLocatedQuestionId = null, noticeVersion = 0
const answerTimers = new Map(), answerChains = new Map(), answerVersions = new Map()
const colors = ['#8bd5d1','#d9b785','#8eaed6','#b4a1d0']
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const byId = id => state.doc?.nodes.find(n => n.id === id)
const qsFor = sub => state.questions.filter(q => q.group === sub)
const answered = q => !!state.doc?.answers[q.id]?.value
async function api(path, payload) {
  const response = await fetch(path, payload === undefined ? {} : {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
  const data = await response.json()
  if (!response.ok) throw Error(data.error || `HTTP ${response.status}`)
  return data
}
async function refresh() { state = await api('/api/state'); if (state.doc && !selectedSub) selectedSub = state.doc.nodes.find(n=>n.kind==='小项')?.id; render() }
function notice(text, kind='error') {
  const version=++noticeVersion
  app.querySelector('.toast')?.remove()
  const toast=document.createElement('div')
  toast.className=`toast ${kind==='success'?'success':'notice'}`;toast.setAttribute('role','status');toast.textContent=text;app.append(toast)
  setTimeout(()=>{if(version===noticeVersion)toast.remove()},4500)
}
function nodeGroups() {
  if (!state.doc) return []
  return state.doc.nodes.filter(n=>n.kind==='大项').sort((a,b)=>a.order-b.order).map((big,i)=>({big, color:colors[i%colors.length], small:state.doc.nodes.filter(n=>n.parentId===big.id).sort((a,b)=>a.order-b.order)}))
}
function rail(groups) {
  return `<aside class="rail"><div class="section-kicker">Project map</div><h2>目录导航</h2>${groups.map(g=>{
    const total = g.small.reduce((sum,n)=>sum+qsFor(g.big.title+'/'+n.title).length,0)
    const done = g.small.reduce((sum,n)=>sum+qsFor(g.big.title+'/'+n.title).filter(answered).length,0)
    return `<details class="railGroup" data-group="${g.big.id}" open style="--group-color:${g.color}"><summary><span class="orb"></span>${esc(g.big.title)}<small>${done}/${total}</small></summary>${g.small.map(n=>{const list=qsFor(g.big.title+'/'+n.title);return `<button class="railSub ${selectedSub===n.id?'active':''}" data-sub="${n.id}"><span class="dot"></span>${esc(n.title)}<small>${list.filter(answered).length}/${list.length}</small></button>`}).join('')}</details>`
  }).join('')}<div class="railFooter">每个光点对应一个待确认决策。<br><b>亮起</b>表示答案已保存，分支进度会同步更新。</div></aside>`
}
function graph(groups) {
  let cursor = 80
  const placed = groups.map(g => {
    const small = g.small.map(n => {
      const count = qsFor(g.big.title+'/'+n.title).length
      const height = Math.max(110, (count - 1) * 18 + 50)
      const placed = { node:n, y:cursor + height / 2 }
      cursor += height + 26
      return placed
    })
    cursor += 80
    return { ...g, smallPlaced:small, y:(small[0].y + small.at(-1).y) / 2 }
  })
  const height = Math.max(690, cursor + 30), rootY = 80
  const ys = placed.flatMap(g=>g.smallPlaced.map(n=>n.y))
  if(ys.some((y,i)=>!Number.isFinite(y)||(i>0&&y-ys[i-1]<110))) throw Error('树形布局节点间距不足')
  const short = (value, limit) => [...value].length > limit ? [...value].slice(0, limit).join('') + '…' : value
  const bigLabel = Math.max(0,...groups.map(g=>[...g.big.title].length)), smallLabel = Math.max(0,...groups.flatMap(g=>g.small.map(n=>[...n.title].length)))
  const smallX = Math.max(611, 375 + Math.min(bigLabel,18)*16 + 40)
  const questionX = Math.max(788, smallX + 20 + Math.min(smallLabel,18)*13 + 45)
  const width = Math.max(930, questionX + 90)
  const paths=[], elements=[]
  paths.push(`<path class="link" d="M130 ${rootY} L130 ${placed.at(-1).y}"/>`)
  for (const g of placed) paths.push(`<path class="link" d="M130 ${g.y} C220 ${g.y} 245 ${g.y} 333 ${g.y}"/>`)
  elements.push(`<circle class="rootHalo" cx="130" cy="${rootY}" r="54"/><circle class="rootCircle" cx="130" cy="${rootY}" r="32"/><text class="rootText" x="130" y="${rootY+5}" text-anchor="middle">目标</text>`)
  for (const g of placed) {
    const by=g.y, color=g.color
    const bigQuestions=g.small.flatMap(n=>qsFor(g.big.title+'/'+n.title)), bigComplete=bigQuestions.length>0&&bigQuestions.every(answered)
    elements.push(`<g class="bigBranch ${bigComplete?'complete':''} ${g.small.some(n=>n.id===selectedSub)?'current':''}" role="button" tabindex="0" data-group="${g.big.id}" data-sub="${g.small[0]?.id||''}" aria-label="${esc(g.big.title)}"><title>${esc(g.big.title)}</title><circle class="bigCircle" style="--node-color:${color}" cx="348" cy="${by}" r="16"/><text class="bigText" x="375" y="${by+5}">${esc(short(g.big.title,18))}</text></g>`)
    g.smallPlaced.forEach(({node:n,y})=>{
      const group=g.big.title+'/'+n.title, list=qsFor(group), active=selectedSub===n.id, complete=list.length>0&&list.every(answered)
      paths.push(`<path class="link ${active?'selected':''}" data-branch="${n.id}" d="M365 ${by} C${(365+smallX)/2} ${by} ${(365+smallX)/2} ${y} ${smallX-13} ${y}"/>`)
      elements.push(`<g class="branch ${active?'selected':''} ${complete?'complete':''}" role="button" tabindex="0" data-sub="${n.id}" aria-label="${esc(group)}，已回答 ${list.filter(answered).length} 题"><title>${esc(n.title)}</title><circle class="smallCircle" cx="${smallX}" cy="${y}" r="11"/><text class="smallText" x="${smallX+20}" y="${y+5}">${esc(short(n.title,18))}</text></g>`)
      list.forEach((q,k)=>{
        const qy=y+(k-(list.length-1)/2)*18
        paths.push(`<path class="link ${active?'selected':''}" data-branch="${n.id}" d="M${questionX-38} ${y} Q${questionX-16} ${y} ${questionX-3} ${qy}"/>`)
        elements.push(`<g class="questionPoint ${active?'selected':''}" role="button" tabindex="0" data-question="${q.id}" data-sub="${n.id}" aria-label="${esc(q.title)}，${answered(q)?'已回答':'待回答'}"><circle class="questionDot ${answered(q)?'answered':''}" cx="${questionX}" cy="${qy}" r="4.5"/></g>`)
      })
    })
  }
  return `<div class="skyPane"><main class="sky"><div class="skyHeader"><div class="section-kicker">Live decision map</div><h1>${esc(state.doc.title || [...state.doc.goal].slice(0, 8).join(''))}</h1><p>沿分支查看问题，选择答案后光点会亮起。</p></div><button class="btn workspaceLaunch skyWorkspaceLaunch" data-workspace="open">全局设置</button><div class="graphWrap" data-height="${height}" data-width="${width}"><svg class="graph" viewBox="0 0 ${width} ${height}" role="img" aria-label="项目目录与问题星图"><g>${paths.join('')}</g><g>${elements.join('')}</g></svg></div></main><div class="skyLegend"><span><i class="currentDot"></i>填写中</span><span><i></i>已完成</span><span><i class="mutedDot"></i>待确认</span></div></div>`
}
function questionCard(q, i) {
  const ans=state.doc.answers[q.id]||{}, meta=q.optionDetails||{}
  return `<article class="question" id="question-${esc(q.id)}"><div class="qTop"><span class="qIndex">${String(state.questions.indexOf(q)+1).padStart(2,'0')}</span><h3>${esc(q.title)}</h3><span class="status ${q.level==='阻塞必须问'?'':'soft'}">${esc(q.level)}</span></div><div class="impact">影响：${esc(q.impact)} · 未答默认：${esc(q.defaultValue)}</div>${q.options.map(v=>{
    const d=meta[v]||{}
    return `<label class="answerOption ${ans.value===v?'chosen':''}"><input type="radio" name="answer-${esc(q.id)}" value="${esc(v)}" ${ans.value===v?'checked':''}><strong>${esc(v)}</strong><span>好处：${esc(d.benefit||'给出明确执行路径')}<br><em>代价：${esc(d.cost||'需要按此路径执行')}</em></span></label>`
  }).join('')}<label class="formLabel" for="custom-${esc(q.id)}">其他答案</label><input class="field" id="custom-${esc(q.id)}" data-custom="${esc(q.id)}" placeholder="如果选项不合适，填写你的决定" value="${esc(q.options.includes(ans.value)?'':ans.value||'')}"><label class="formLabel" for="reason-${esc(q.id)}">决策理由（可选）</label><textarea class="field" id="reason-${esc(q.id)}" data-reason="${esc(q.id)}" placeholder="记录为什么这样选">${esc(ans.reason||'')}</textarea><div class="qActions"><span class="autoSave" data-save-status="${esc(q.id)}" aria-live="polite">${answered(q)?'已保存':'待回答'}</span></div></article>`
}
function questionsPanel(group) {
  const list=qsFor(group)
  return `<div class="panelMeta"><span class="tag">${esc(group.split('/')[0])}</span><span class="count">${list.filter(answered).length} / ${list.length}</span></div><h2>${esc(group.split('/')[1])}</h2><p class="subdesc">每题选择一项，也可填写自己的答案和理由。</p>${list.map(questionCard).join('')||'<div class="empty">这个目录暂时没有问题。</div>'}<button class="btn ghost" data-next-unanswered>定位下一道未答题</button>`
}
function notesPanel(sub) {
  const notes=state.doc.notes.filter(n=>n.nodeId===sub.id), editing=state.doc.notes.find(n=>n.id===editNoteId)
  return `<h2>${esc(sub.title)} · 原子便签</h2><p class="subdesc">问题与需求以单条便签保存；硬约束一经锁定，解锁必须留下审批记录。</p>${notes.map(n=>`<div class="noteCard"><strong>${esc(n.title)}</strong><small>${esc(n.type)} · ${esc(n.level)} · ${esc(n.status)} ${n.locked?'<span class="lock">· 已锁定</span>':''}</small><small>${esc(n.description||'暂无描述')}</small><div class="actions"><button class="btn small ghost" data-edit-note="${n.id}">编辑</button><button class="btn small ghost" data-lock-note="${n.id}">${n.locked?'申请解锁':'设为硬约束'}</button></div></div>`).join('')}<h3>${editing?'编辑便签':'新增便签'}</h3><form id="note-form"><input type="hidden" name="id" value="${esc(editing?.id||'')}"><label class="formLabel">一句话标题<input class="field" name="title" required maxlength="200" value="${esc(editing?.title||'')}"></label><div class="formGrid"><label>类型<select class="field" name="type">${['需求','约束','问题','验收','风险'].map(v=>`<option ${editing?.type===v?'selected':''}>${v}</option>`).join('')}</select></label><label>约束等级<select class="field" name="level">${['软约束','硬约束','偏好','禁止项'].map(v=>`<option ${editing?.level===v?'selected':''}>${v}</option>`).join('')}</select></label></div><label class="formLabel">描述<textarea class="field" name="description">${esc(editing?.description||'')}</textarea></label><label class="formLabel">完成定义<textarea class="field" name="doneDefinition">${esc(editing?.doneDefinition||'')}</textarea></label><label class="formLabel">验证方式<input class="field" name="verification" value="${esc(editing?.verification||'')}"></label><div class="qActions"><button type="submit" class="btn small primary">${editing?'保存便签':'添加便签'}</button></div></form>`
}
function policyPanel() {
  const p=state.doc.policy, missing=new Set(state.review?.policy.map(x=>x.key)||[])
  const mark=(key,label)=>`${label}${missing.has(key)?' <span class="requiredMark">待确认</span>':''}`
  const select=(label,key,options)=>`<label class="formLabel">${mark(key,label)}<select class="field" data-policy="${key}">${options.map(([v,title])=>`<option value="${esc(v)}" ${String(p[key]??'')===v?'selected':''}>${esc(title)}</option>`).join('')}</select></label>`
  const input=(label,key,placeholder='')=>`<label class="formLabel">${mark(key,label)}<input class="field" data-policy="${key}" placeholder="${esc(placeholder)}" value="${esc(p[key]??'')}"></label>`
  const yesNo=[['','未决定'],['true','允许'],['false','禁止']]
  if (state.doc.profile === 'general') return `<h2>全局设置</h2><p class="subdesc">只确认与本任务相关的交付信息。</p>${missing.size?`<div class="notice">${missing.size} 项必填设置尚未确认。</div>`:''}${select('遇问题策略','questionStrategy',[['阻塞必停','阻塞必停'],['只记录继续','只记录继续'],['按默认继续','按默认继续'],['到节点再停','到节点再停']])}${input('交付格式','deliveryFormat')}${input('截止时间','deadline')}${input('预算上限','budget')}${input('验收与检查','docsTests')}<button class="btn small primary policyConfirm" data-confirm-policy>确认已填写的全局设置</button>`
  return `<h2>全局政策</h2><p class="subdesc">带“待确认”的项目需要填写或确认。保守预设也需明确确认。</p>${missing.size?`<div class="notice">${missing.size} 项必填全局政策尚未确认。建议逐项填写；留空时只能导出未完成草案。</div>`:''}${select('遇问题策略','questionStrategy',[['阻塞必停','阻塞必停'],['只记录继续','只记录继续'],['按默认继续','按默认继续'],['到节点再停','到节点再停']])}${select('外部依赖政策','externalPolicy',[['需审批','需审批'],['允许翻墙平台','允许翻墙平台'],['禁止翻墙平台','禁止翻墙平台'],['需替代方案','需替代方案']])}<div class="formGrid">${select('数据上传或出境','dataExport',yesNo)}${select('付费服务','allowPaid',yesNo)}${select('需翻墙平台','allowFirewallPlatform',yesNo)}${select('境外 API','allowOverseasApi',yesNo)}${select('非开源许可','allowNonOpenLicense',yesNo)}${input('预算上限','budget','金额或零新增费用')}${input('时间上限（天）','deadline','例如 20')}${input('技术栈限制','stack')}${input('部署环境','deployment')}${input('账号与权限','accountPermissions')}${input('合规与安全','compliance')}${input('交付格式','deliveryFormat')}${input('版本兼容','compatibility')}${input('文档和测试','docsTests')}${input('失败处理','failureStrategy')}${input('回滚与备份','rollbackBackup')}${input('不可逆操作审批','irreversibleApproval')}</div><button class="btn small primary policyConfirm" data-confirm-policy>确认已填写的全局设置</button>`
}
function exportPanel() {
  const pending=state.review?.questions||[], policies=state.review?.policy||[], relevant=state.conflicts.filter(c=>!['unanswered','unconfirmed-policy'].includes(c.code))
  return `<h2>检查与交付</h2><p class="subdesc">导出前会逐项提醒未回答的问题和必填政策，并给出建议。</p><div class="${pending.length||policies.length?'notice':'success'}">${pending.length||policies.length?`尚有 ${pending.length} 道阻塞问题、${policies.length} 项必填全局政策未确认。建议先回答；留空提交会生成供主会话补全的规划草案。`:'必填项已确认；主会话仍需复核执行包。'}</div><h3>冲突与风险 · ${state.conflicts.length}</h3>${relevant.map(c=>`<div class="conflictCard"><b>${esc(c.message)}</b><p>建议：${esc(c.fix)}</p></div>`).join('')||'<div class="success">当前未发现其他规则冲突。</div>'}<h3>下载执行包</h3><div class="exportList"><button class="btn" data-export="task:text">项目任务书 · 纯文本</button><button class="btn" data-export="task:json">项目任务书 · JSON</button><button class="btn" data-export="ai:text">给 AI 的项目约束 · 纯文本</button><button class="btn" data-export="ai:json">给 AI 的项目约束 · JSON</button></div><button class="btn primary" data-submit>提交给主对话复核</button>${state.doc.submittedAt?`<div class="success">已生成${pending.length||policies.length?'未完成草案':'执行包'}：<br><code>${esc(state.doc.executionPackFile||'')}</code><br>返回主聊天发送“画布已提交”，由主会话复核。</div>`:''}`
}
function reviewDialog() {
  if(!reviewAction)return ''
  const pending=state.review?.questions||[], policies=state.review?.policy||[]
  return `<div class="reviewBackdrop"><section class="reviewDialog" role="dialog" aria-modal="true" aria-label="提交前待确认事项"><h2>${reviewAction.submit?'提交':'导出'}前请复核</h2><p>还有 ${pending.length} 道阻塞问题、${policies.length} 项必填全局政策未确认。建议返回逐项回答；留空导出将生成供主会话补全的“未完成规划草案”。</p><div class="reviewList">${policies.map(x=>`<div><b>全局 · ${esc(x.label)}</b><span>${esc(x.suggestion)}</span></div>`).join('')}${pending.map(x=>`<div><b>${esc(x.group||x.category)} · ${esc(x.title)}</b><span>建议考虑：${esc(x.options[0]||x.defaultValue)}；参考预设：${esc(x.defaultValue)}（待确认）</span></div>`).join('')}</div><label class="formLabel">确认人<input class="field" id="review-by" maxlength="100" placeholder="记录本次留空决定的人"></label><label class="formLabel">留空理由<input class="field" id="review-reason" maxlength="500" placeholder="例如：资料尚未取得，先导出供主会话补充"></label><div class="reviewActions"><button class="btn ghost" data-review-cancel>返回填写</button><button class="btn primary" data-review-confirm>确认留空并继续</button></div></section></div>`
}
function inspector() {
  const sub=byId(selectedSub), big=byId(sub?.parentId), group=big&&sub?big.title+'/'+sub.title:''
  return `<aside class="inspector" aria-label="当前节点的问题">${questionsPanel(group)}</aside>`
}
function workspace() {
  if (!workspaceOpen) return ''
  const sub=byId(selectedSub)
  return `<div class="workspaceBackdrop" data-workspace="close"><section class="workspace" role="dialog" aria-modal="true" aria-label="项目工作台"><nav class="workspaceNav"><div class="section-kicker">Project workspace</div><h2>项目工作台</h2><p>全局设置与交付管理</p>${[['policy','全局政策'],['notes','便签管理'],['export','检查与导出']].map(([id,name])=>`<button class="workspaceNavItem ${tab===id?'active':''}" data-tab="${id}">${name}</button>`).join('')}</nav><div class="workspaceBody"><div class="workspaceHead"><span>${tab==='notes'?`当前目录 · ${esc(sub?.title||'')}`:'整个项目'}</span><button class="btn small ghost" data-workspace="close" aria-label="关闭项目工作台">关闭 ✕</button></div><div class="workspaceContent">${tab==='notes'?notesPanel(sub):tab==='policy'?policyPanel():exportPanel()}</div></div></section></div>`
}
function welcome() {
  return `<div class="app"><section class="welcome"><div class="welcomeCard"><div class="section-kicker">Project constraints</div><h1>等待项目问卷</h1><p>主会话完成目标分析后会打开此画布。</p></div></section><footer class="footer"><span>本地工作空间</span><span>本机保存</span></footer></div>`
}
function render() {
  if (!state.doc) {app.innerHTML=welcome();return}
  const oldScroll=tab===renderedTab?app.querySelector('.workspaceContent')?.scrollTop:0
  const groups=nodeGroups(), total=state.questions.length, done=state.questions.filter(answered).length
  const label={enterprise:'生产级开发',small:'小范围应用',coursework:'作业演示',general:'通用任务'}[state.doc.profile]||'既有项目'
  app.innerHTML=`<div class="app"><header class="topbar"><div class="brand"><span class="brandmark">✧</span><span><strong>项目约束</strong><small>PROJECT CONSTRAINTS</small></span></div><div class="goalFixed"><small>${label}</small><strong>${esc(state.doc.title || [...state.doc.goal].slice(0, 8).join(''))}</strong></div><div class="top-progress"><strong>${done}/${total}</strong><small>已确认的问题</small></div></header><div class="layout">${rail(groups)}${graph(groups)}${inspector()}</div><footer class="footer"><span>目录 → 原子问题 → 决策记录 → 执行包</span><span><b>${state.conflicts.length}</b> 条提示 · 本机保存</span></footer>${workspace()}${reviewDialog()}</div>`
  const wrap=app.querySelector('.graphWrap'), svg=wrap.querySelector('svg'), height=Number(wrap.dataset.height), width=Number(wrap.dataset.width)
  wrap.style.height=`${height+104}px`;wrap.style.minHeight='0'
  wrap.style.width=`${width}px`;svg.style.width=`${width}px`;svg.style.height=`${height}px`;svg.style.minHeight='0'
  for(const el of app.querySelectorAll('.topbar,.layout,.footer')) el.inert=workspaceOpen
  if(app.querySelector('.workspaceContent')) app.querySelector('.workspaceContent').scrollTop=oldScroll||0
  renderedTab=tab
}
function selectSub(id, questionId, clickedElement) {
  if (!byId(id)) return
  const changed=selectedSub!==id
  selectedSub=id
  document.querySelectorAll('.railSub').forEach(el=>el.classList.toggle('active',el.dataset.sub===id))
  document.querySelectorAll('.branch,.questionPoint').forEach(el=>el.classList.toggle('selected',el.dataset.sub===id))
  document.querySelectorAll('.bigBranch').forEach(el=>el.classList.toggle('current',el.dataset.group===byId(id).parentId))
  document.querySelectorAll('.link[data-branch]').forEach(el=>el.classList.toggle('selected',el.dataset.branch===id))
  const flash=clickedElement?.classList.contains('bigBranch')?clickedElement:document.querySelector(questionId?`.questionPoint[data-question="${CSS.escape(questionId)}"]`:`.branch[data-sub="${CSS.escape(id)}"]`)
  if(flash){flash.classList.remove('flash');void flash.getBoundingClientRect();flash.classList.add('flash');setTimeout(()=>flash.classList.remove('flash'),800)}
  const panel=document.querySelector('.inspector')
  if(changed){panel.innerHTML=questionsPanel(currentGroup());panel.scrollTop=0}
  if(changed && !clickedElement?.closest('.graph')) {
    const sky=app.querySelector('.sky'), branch=app.querySelector(`.branch[data-sub="${CSS.escape(id)}"]`)
    if(sky&&branch){const box=sky.getBoundingClientRect(), pos=branch.getBoundingClientRect();sky.scrollTo({top:sky.scrollTop+pos.top+pos.height/2-box.top-box.height/2,behavior:'smooth'})}
  }
  if(questionId){const item=document.getElementById('question-'+questionId);if(item)panel.scrollTo({top:panel.scrollTop+item.getBoundingClientRect().top-panel.getBoundingClientRect().top-16,behavior:'smooth'})}
}
function saveStatus(id,text) {const el=document.querySelector(`[data-save-status="${CSS.escape(id)}"]`);if(el)el.textContent=text}
function syncAnswerView() {
  const groups=nodeGroups(), done=state.questions.filter(answered).length
  document.querySelector('.top-progress strong').textContent=`${done}/${state.questions.length}`
  document.querySelector('.panelMeta .count').textContent=`${qsFor(currentGroup()).filter(answered).length} / ${qsFor(currentGroup()).length}`
  for(const g of groups){
    const lists=g.small.map(n=>qsFor(g.big.title+'/'+n.title)), total=lists.reduce((n,list)=>n+list.length,0), count=lists.reduce((n,list)=>n+list.filter(answered).length,0)
    const railGroup=document.querySelector(`.railGroup[data-group="${CSS.escape(g.big.id)}"]`)
    if(railGroup)railGroup.querySelector('summary small').textContent=`${count}/${total}`
    document.querySelector(`.bigBranch[data-group="${CSS.escape(g.big.id)}"]`)?.classList.toggle('complete',total>0&&count===total)
    for(const [i,n] of g.small.entries()){
      const list=lists[i], complete=list.length>0&&list.every(answered)
      const railSub=document.querySelector(`.railSub[data-sub="${CSS.escape(n.id)}"]`)
      if(railSub)railSub.querySelector('small').textContent=`${list.filter(answered).length}/${list.length}`
      document.querySelector(`.branch[data-sub="${CSS.escape(n.id)}"]`)?.classList.toggle('complete',complete)
    }
  }
  for(const q of state.questions){const dot=document.querySelector(`.questionPoint[data-question="${CSS.escape(q.id)}"]`);dot?.querySelector('.questionDot')?.classList.toggle('answered',answered(q));dot?.setAttribute('aria-label',`${q.title}，${answered(q)?'已回答':'待回答'}`)}
  document.querySelector('.footer b').textContent=String(state.conflicts.length)
}
function scheduleAnswer(id,delay=650) {
  const root=document.getElementById('question-'+id)
  if(!root)return
  const value=root.querySelector('[data-custom]').value.trim()||root.querySelector('input[type=radio]:checked')?.value||''
  const reason=root.querySelector('[data-reason]').value.trim()
  clearTimeout(answerTimers.get(id))
  if(!value){saveStatus(id,'待回答');return}
  if(value.length>500||reason.length>1000){saveStatus(id,'内容过长，尚未保存');return}
  const version=(answerVersions.get(id)||0)+1;answerVersions.set(id,version)
  saveStatus(id,'待保存…')
  answerTimers.set(id,setTimeout(()=>{
    const chain=(answerChains.get(id)||Promise.resolve()).catch(()=>{}).then(async()=>{
      if(version!==answerVersions.get(id))return
      saveStatus(id,'保存中…')
      try{
        await api('/api/answer',{id,value,reason})
        state=await api('/api/state')
        syncAnswerView()
        if(version===answerVersions.get(id))saveStatus(id,'已保存')
      }catch(err){if(version===answerVersions.get(id))saveStatus(id,'保存失败：'+err.message)}
    })
    answerChains.set(id,chain)
  },delay))
}
async function download(kind,format,override) {
  const result=await api('/api/export',{kind,format,override})
  const blob=new Blob([result.content],{type:format==='json'?'application/json':'text/plain'})
  const url=URL.createObjectURL(blob),link=document.createElement('a')
  link.href=url;link.download=result.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  await refresh(); notice('执行包已下载','success')
}
async function runAction(action,override) {
  if(action.submit){const result=await api('/api/submit',{override});reviewAction=null;await refresh();tab='export';render();notice('已生成主对话复核文件：'+result.packFile,'success')}
  else {reviewAction=null;await download(action.kind,action.format,override)}
}
function startAction(action) {
  if((state.review?.questions.length||0)+(state.review?.policy.length||0)){reviewAction=action;render();document.querySelector('#review-by')?.focus()}
  else runAction(action).catch(err=>notice(err.message))
}
function nextUnanswered() {
  const start=lastLocatedQuestionId?state.questions.findIndex(q=>q.id===lastLocatedQuestionId):state.questions.findIndex(q=>q.group===currentGroup())-1
  const next=state.questions.slice(start+1).concat(state.questions.slice(0,start+1)).find(q=>!answered(q))
  if(!next){notice('所有问题都已回答','success');return}
  const sub=state.doc.nodes.find(n=>n.kind==='小项'&&next.group.endsWith('/'+n.title))
  if(sub){lastLocatedQuestionId=next.id;selectSub(sub.id,next.id)}
}
function currentGroup(){const sub=byId(selectedSub),big=byId(sub?.parentId);return big&&sub?big.title+'/'+sub.title:''}
app.addEventListener('click',async e=>{
  const target=e.target.closest('[data-sub],[data-question],[data-tab],[data-workspace],[data-next-unanswered],[data-export],[data-submit],[data-edit-note],[data-lock-note],[data-confirm-policy],[data-review-cancel],[data-review-confirm]')
  if(!target)return
  try{
    if(target.dataset.sub){lastLocatedQuestionId=target.dataset.question||null;selectSub(target.dataset.sub,target.dataset.question,target)}
    if(target.dataset.workspace==='open'){workspaceOpen=true;render();document.querySelector('[data-workspace="close"] .btn')?.focus()}
    if(target.dataset.workspace==='close'&&(target===e.target||target.tagName==='BUTTON')){workspaceOpen=false;render();document.querySelector('[data-workspace="open"]')?.focus()}
    if(target.dataset.tab){tab=target.dataset.tab;render();document.querySelector(`.workspaceNavItem[data-tab="${tab}"]`)?.focus()}
    if(target.hasAttribute('data-next-unanswered'))nextUnanswered()
    if(target.dataset.export){const [kind,format]=target.dataset.export.split(':');startAction({kind,format})}
    if(target.hasAttribute('data-submit'))startAction({submit:true})
    if(target.hasAttribute('data-review-cancel')){reviewAction=null;render()}
    if(target.hasAttribute('data-review-confirm')){const by=document.querySelector('#review-by').value.trim(),reason=document.querySelector('#review-reason').value.trim();if(!by||!reason)throw Error('请填写确认人和留空理由');await runAction(reviewAction,{by,reason})}
    if(target.hasAttribute('data-confirm-policy')){await api('/api/policy/confirm',{keys:(state.review?.policy||[]).map(x=>x.key)});await refresh();notice('已确认当前填写的全局设置','success')}
    if(target.dataset.editNote){editNoteId=target.dataset.editNote;tab='notes';render();document.getElementById('note-form')?.scrollIntoView({block:'nearest'})}
    if(target.dataset.lockNote){const note=state.doc.notes.find(n=>n.id===target.dataset.lockNote);if(note.locked){const reason=prompt('解锁理由'),approver=prompt('审批人');if(!reason?.trim()||!approver?.trim())throw Error('解锁需要理由和审批人');await api('/api/lock',{id:note.id,locked:false,reason:reason.trim(),approver:approver.trim()})}else await api('/api/lock',{id:note.id,locked:true});await refresh();notice(note.locked?'硬约束已解锁并留痕':'硬约束已锁定','success')}
  }catch(err){notice(err.message)}
})
app.addEventListener('keydown',e=>{const target=e.target.closest('[data-sub]');if(target&&(e.key==='Enter'||e.key===' ')){e.preventDefault();target.click()}})
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&workspaceOpen){workspaceOpen=false;render();document.querySelector('[data-workspace="open"]')?.focus()}})
app.addEventListener('change',async e=>{
  const t=e.target
  if(t.matches('.question input[type="radio"]')){
    const root=t.closest('.question'),custom=root.querySelector('[data-custom]')
    custom.value=''
    root.querySelectorAll('.answerOption').forEach(el=>el.classList.toggle('chosen',el.contains(t)))
    scheduleAnswer(root.id.slice('question-'.length),0)
    return
  }
  if(!t.dataset.policy)return
  try{let value=t.value;if(['dataExport','allowPaid','allowFirewallPlatform','allowOverseasApi','allowNonOpenLicense'].includes(t.dataset.policy))value=value===''?null:value==='true';await api('/api/policy',{key:t.dataset.policy,value});await refresh();notice('全局政策已保存','success')}catch(err){notice(err.message)}
})
app.addEventListener('input',e=>{
  const t=e.target
  if(!t.matches('[data-custom],[data-reason]'))return
  const root=t.closest('.question')
  if(t.matches('[data-custom]')&&t.value.trim()){
    root.querySelectorAll('input[type=radio]').forEach(el=>el.checked=false)
    root.querySelectorAll('.answerOption').forEach(el=>el.classList.remove('chosen'))
  }
  scheduleAnswer(root.id.slice('question-'.length))
})
app.addEventListener('focusout',e=>{
  if(e.target.matches('[data-custom],[data-reason]'))scheduleAnswer(e.target.closest('.question').id.slice('question-'.length),0)
})
app.addEventListener('submit',async e=>{
  e.preventDefault()
  const form=e.target
  try{
    if(form.id==='note-form'){
      const data=Object.fromEntries(new FormData(form))
      const id=data.id;delete data.id
      if(id){await api('/api/note/update',{id,patch:data});editNoteId=null}
      else {await api('/api/note',{nodeId:selectedSub,title:data.title,type:data.type,level:data.level});const fresh=await api('/api/state');const note=fresh.doc.notes.at(-1);await api('/api/note/update',{id:note.id,patch:{description:data.description,doneDefinition:data.doneDefinition,verification:data.verification}})}
      await refresh();notice('便签已保存','success')
    }
  }catch(err){notice(err.message)}
})
refresh().catch(err=>notice('无法连接本地服务：'+err.message))
if(new URLSearchParams(location.search).has('app'))document.body.classList.add('nativeApp')
document.querySelector('#nativeBar').addEventListener('click',e=>{
  const action=e.target.closest('[data-window]')?.dataset.window
  if(action)api('/api/window',{action}).catch(err=>notice(err.message))
})
const dragBar=document.querySelector('#nativeBar .windowDrag')
let dragging=false
dragBar.addEventListener('pointerdown',e=>{
  if(e.button!==0||!window.chrome?.webview)return
  dragging=true;dragBar.setPointerCapture(e.pointerId);window.chrome.webview.postMessage('drag-start')
})
dragBar.addEventListener('pointermove',()=>{if(dragging)window.chrome.webview.postMessage('drag-move')})
dragBar.addEventListener('lostpointercapture',()=>{dragging=false;window.chrome?.webview?.postMessage('drag-end')})
