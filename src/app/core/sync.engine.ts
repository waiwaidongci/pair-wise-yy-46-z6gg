import type { Attachment, ClaimCase, SyncOperation } from './models'

export const timestamp = () => new Date().toLocaleString('zh-CN')

export const opIdOf = (seq: number) => `OP-${String(seq).padStart(4, '0')}`

const LOSS_FIELDS = [
  { field: 'damage', label: '损失事实' },
  { field: 'salvage', label: '残值' },
  { field: 'liability', label: '责任比例' },
  { field: 'disputed', label: '争议标记' },
] as const

/** 对比基线与编辑后的案件，把科目改动和附件版本改动分别打包成带操作号的待同步项 */
export function buildClaimOps(claimId: string, base: ClaimCase, edited: ClaimCase, seq: number): SyncOperation[] {
  const ops: SyncOperation[] = []
  let next = seq
  const now = timestamp()
  for (const item of edited.lossItems) {
    const baseItem = base.lossItems.find((candidate) => candidate.id === item.id)
    if (!baseItem) continue
    const changes = LOSS_FIELDS.filter(({ field }) => baseItem[field] !== item[field]).map(({ field, label }) => ({
      field,
      label,
      base: baseItem[field] as unknown,
      value: item[field] as unknown,
    }))
    if (changes.length) {
      ops.push({
        opId: opIdOf(next++),
        claimId,
        type: 'loss-item',
        itemId: item.id,
        summary: `科目 ${item.id} ${item.category}：${changes.map((change) => change.label).join('、')}`,
        changes,
        status: '待同步',
        attempts: 0,
        createdAt: now,
      })
    }
    for (const attachment of item.attachments) {
      const baseAttachment = baseItem.attachments.find((candidate) => candidate.id === attachment.id)
      if (!baseAttachment || (baseAttachment.version === attachment.version && baseAttachment.name === attachment.name)) continue
      ops.push({
        opId: opIdOf(next++),
        claimId,
        type: 'attachment',
        itemId: item.id,
        attachmentId: attachment.id,
        summary: `附件 ${attachment.name}：V${baseAttachment.version} → V${attachment.version}`,
        changes: [{ field: 'version', label: '附件版本', base: baseAttachment.version, value: attachment.version }],
        status: '待同步',
        attempts: 0,
        createdAt: now,
      })
    }
  }
  return ops
}

/** 附件按 id 合并：本地有待同步操作的保留本地版本，否则取版本更高的一方 */
function mergeAttachments(remote: Attachment[], local: Attachment[], itemOps: SyncOperation[]): Attachment[] {
  const byId = new Map<string, Attachment>()
  for (const attachment of remote) byId.set(attachment.id, { ...attachment })
  for (const attachment of local) {
    const pending = itemOps.some((op) => op.type === 'attachment' && op.attachmentId === attachment.id)
    const existing = byId.get(attachment.id)
    if (!existing || pending || attachment.version > existing.version) byId.set(attachment.id, { ...attachment })
  }
  return [...byId.values()]
}

/**
 * 把服务端案件合并进本地：科目与附件分别按 id 合并；
 * 仍有待同步操作的字段保留本地值；报价、专家记录、审计、草稿按只增不删合并。
 */
export function mergeClaims(local: ClaimCase, remote: ClaimCase, pendingOps: SyncOperation[]): ClaimCase {
  const merged = structuredClone(remote)
  merged.surveyNotes = [...new Set([...(remote.surveyNotes ?? []), ...(local.surveyNotes ?? [])])]
  const auditIds = new Set(merged.audit.map((event) => event.id))
  merged.audit = [...merged.audit, ...local.audit.filter((event) => !auditIds.has(event.id))]
  merged.lossItems = merged.lossItems.map((remoteItem) => {
    const localItem = local.lossItems.find((candidate) => candidate.id === remoteItem.id)
    if (!localItem) return remoteItem
    const itemOps = pendingOps.filter((op) => op.itemId === remoteItem.id)
    const out = { ...remoteItem }
    for (const op of itemOps) {
      if (op.type !== 'loss-item') continue
      for (const change of op.changes) (out as unknown as Record<string, unknown>)[change.field] = change.value
    }
    const versions = new Set(out.repairQuotes.map((quote) => quote.version))
    out.repairQuotes = [...out.repairQuotes, ...localItem.repairQuotes.filter((quote) => !versions.has(quote.version))]
    out.expertNotes = [...new Set([...out.expertNotes, ...localItem.expertNotes])]
    out.attachments = mergeAttachments(remoteItem.attachments, localItem.attachments, itemOps)
    return out
  })
  for (const localItem of local.lossItems) {
    if (!merged.lossItems.some((item) => item.id === localItem.id)) merged.lossItems.push(structuredClone(localItem))
  }
  return merged
}
