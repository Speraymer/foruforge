import { fresh, addNode, addNote } from '../scripts/core.mjs'

const levels = new Set(['阻塞必须问', '建议问', '可默认', '风险提示'])
const policyKeys = new Set(Object.keys(fresh().policy))
const label = (value, name, limit = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw Error(`${name}无效`)
  return value.trim()
}

export function createProject(goal, profile = 'general', title = '', outline, requiredPolicyKeys) {
  const doc = fresh(label(goal, '项目目标', 300))
  doc.title = title ? label(title, '展示标题', 8) : [...doc.goal].slice(0, 8).join('')
  if ([...doc.title].length > 8) throw Error('展示标题需为 1–8 个字')
  if (!['general', 'enterprise', 'small', 'coursework'].includes(profile)) throw Error('项目类型无效')
  if (!Array.isArray(outline) || !outline.length || outline.length > 12) throw Error('目录需包含 1–12 个大项')
  const keys = requiredPolicyKeys ?? (profile === 'general' ? ['questionStrategy', 'deliveryFormat'] : undefined)
  if (keys !== undefined && (!Array.isArray(keys) || keys.some(key => !policyKeys.has(key)) || new Set(keys).size !== keys.length)) throw Error('必填全局项无效')
  if (profile === 'general' && keys.some(key => !['questionStrategy', 'deliveryFormat', 'deadline', 'budget', 'docsTests'].includes(key))) throw Error('通用任务的必填项无法在画布中填写')
  if (keys !== undefined) doc.requiredPolicyKeys = keys
  doc.profile = profile
  doc.dynamicOutline = true
  const prepared = [], bigNames = new Set()
  let count = 0
  for (const branch of outline) {
    const big = label(branch?.title, '大项标题', 40)
    if (big.includes('/') || bigNames.has(big)) throw Error('大项标题重复或含斜杠')
    bigNames.add(big)
    if (!Array.isArray(branch.sections) || !branch.sections.length || branch.sections.length > 20) throw Error(`「${big}」需包含 1–20 个小项`)
    const smallNames = new Set(), sections = []
    for (const section of branch.sections) {
      const small = label(section?.title, '小项标题', 40)
      if (small.includes('/') || smallNames.has(small)) throw Error(`「${big}」的小项标题重复或含斜杠`)
      smallNames.add(small)
      if (!Array.isArray(section.questions) || !section.questions.length || section.questions.length > 30) throw Error(`「${small}」需包含 1–30 个问题`)
      const qs = section.questions.map(item => {
        const title = label(item?.title, '问题标题')
        const level = item.level || '建议问'
        if (!levels.has(level)) throw Error(`「${title}」的问题级别无效`)
        if (!Array.isArray(item.options) || item.options.length > 5) throw Error(`「${title}」的选项无效`)
        const options = item.options.map(option => ({
          value: label(option?.value, '选项', 100),
          benefit: label(option?.benefit, '选项好处', 200),
          cost: label(option?.cost, '选项代价', 200)
        }))
        if (new Set(options.map(option => option.value)).size !== options.length) throw Error(`「${title}」的选项重复`)
        return { title, level, options, impact: label(item.impact, '问题影响'), defaultValue: item.defaultValue ? label(item.defaultValue, '未答默认', 100) : '暂停并确认' }
      })
      count += qs.length
      sections.push({ title: small, questions: qs })
    }
    prepared.push({ title: big, sections })
  }
  if (count > 200) throw Error('单个项目最多 200 个问题')
  doc.customQuestions = []
  for (const branch of prepared) {
    const big = addNode(doc, doc.nodes[0].id, branch.title)
    for (const section of branch.sections) {
      const small = addNode(doc, big.id, section.title)
      for (const item of section.questions) {
        const note = addNote(doc, small.id, item.title)
        note.type = '问题'; note.priority = item.level === '阻塞必须问' ? '高' : '中'; note.description = item.impact
        const options = item.options.map(option => option.value)
        doc.customQuestions.push({ id: `q${String(doc.customQuestions.length + 1).padStart(3, '0')}`, group: `${branch.title}/${section.title}`, category: branch.title,
          title: item.title, level: item.level, options, optionDetails: Object.fromEntries(item.options.map(option => [option.value, { benefit: option.benefit, cost: option.cost }])),
          impact: item.impact, defaultValue: item.defaultValue, noteIds: [note.id] })
      }
    }
  }
  return doc
}
