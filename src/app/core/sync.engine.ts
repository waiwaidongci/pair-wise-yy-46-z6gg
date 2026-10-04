import type { Attachment, ClaimCase, FieldChange, OpKind, OpPayload, SyncConflict } from './models'

// 离线同步合并引擎：科目按字段合并、附件按版本合并，冲突时保留本地版本。

export function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 三路合并单个字段。
 * - 仅本地改动 → 取本地
 * - 仅远端改动 → 取远端
 * - 两边都改且一致 → 取该值
 * - 两边都改且不一致 → 冲突，保留本地版本
 */
export function mergeField(
  base: unknown,
  local: unknown,
  remote: unknown,
): { value: unknown; conflict: boolean } {
  const localChanged = !isEqual(local, base)
  const remoteChanged = !isEqual(remote, base)
  if (!localChanged) return { value: remote, conflict: false }
  if (!remoteChanged) return { value: local, conflict: false }
  if (isEqual(local, remote)) return { value: local, conflict: false }
  return { value: local, conflict: true }
}

function now(): string {
  return new Date().toLocaleString('zh-CN')
}

function applyLossItem(
  claim: ClaimCase,
  opNo: string,
  payload: OpPayload,
  detectedAt: string,
): { claim: ClaimCase; conflicts: SyncConflict[]; summary: string } {
  const next = structuredClone(claim)
  const conflicts: SyncConflict[] = []
  const changes = payload.changes ?? []
  const itemIds = new Set<string>()

  for (const change of changes) {
    itemIds.add(change.itemId)
    const item = next.lossItems.find((entry) => entry.id === change.itemId)
    if (!item) continue
    const remoteValue = (item as unknown as Record<string, unknown>)[change.field]
    const { value, conflict } = mergeField(change.baseValue, change.localValue, remoteValue)
    ;(item as unknown as Record<string, unknown>)[change.field] = value
    if (conflict) {
      conflicts.push({
        id: `C-${opNo}-${change.itemId}-${change.field}`,
        opNo,
        claimId: claim.id,
        itemId: change.itemId,
        field: change.field,
        baseValue: change.baseValue,
        localValue: change.localValue,
        remoteValue,
        detectedAt,
      })
    }
  }

  const summary = `损失科目 ${itemIds.size} 项字段变更`
  return { claim: next, conflicts, summary }
}

function applyAttachment(
  claim: ClaimCase,
  opNo: string,
  payload: OpPayload,
  detectedAt: string,
): { claim: ClaimCase; conflicts: SyncConflict[]; summary: string } {
  const next = structuredClone(claim)
  const conflicts: SyncConflict[] = []
  const summaries: string[] = []

  for (const entry of payload.attachments ?? []) {
    const { itemId, attachment, baseAttachmentVersion } = entry
    const item = next.lossItems.find((loss) => loss.id === itemId)
    if (!item) {
      summaries.push(`附件 ${attachment.name} 所属科目不存在`)
      continue
    }
    const existing = item.attachments.find((file) => file.id === attachment.id)
    if (!existing) {
      item.attachments.push(attachment)
      summaries.push(`新增附件 ${attachment.name} V${attachment.version}`)
      continue
    }
    if (existing.version === baseAttachmentVersion) {
      // 远端未改动，接受本地版本
      Object.assign(existing, attachment)
      summaries.push(`附件 ${attachment.name} 更新至 V${attachment.version}`)
    } else {
      // 两边都改了版本 → 冲突，保留本地版本
      conflicts.push({
        id: `C-${opNo}-${attachment.id}`,
        opNo,
        claimId: claim.id,
        itemId,
        attachmentId: attachment.id,
        field: 'version',
        baseValue: baseAttachmentVersion,
        localValue: attachment.version,
        remoteValue: existing.version,
        detectedAt,
      })
      Object.assign(existing, attachment)
      summaries.push(`附件 ${attachment.name} 冲突，已保留本地 V${attachment.version}`)
    }
  }

  return { claim: next, conflicts, summary: summaries.join('；') || '附件无变更' }
}

function applyQuote(
  claim: ClaimCase,
  payload: OpPayload,
): { claim: ClaimCase; conflicts: SyncConflict[]; summary: string } {
  const next = structuredClone(claim)
  const target = next.lossItems.find((item) => item.id === payload.quote?.itemId)
  if (target && payload.quote) {
    target.repairQuotes.push({
      version: target.repairQuotes.length + 1,
      amount: payload.quote.amount,
      reason: payload.quote.reason,
      operator: '当前用户',
      createdAt: now(),
    })
  }
  return { claim: next, conflicts: [], summary: `新增报价 ${payload.quote?.amount ?? 0} 元` }
}

function applyText(
  claim: ClaimCase,
  opNo: string,
  payload: OpPayload,
): { claim: ClaimCase; conflicts: SyncConflict[]; summary: string } {
  const next = structuredClone(claim)
  next.audit.push({
    id: `A-${opNo}`,
    at: now(),
    operator: '当前用户',
    action: '草稿同步',
    detail: payload.text ?? '',
  })
  return { claim: next, conflicts: [], summary: '文本草稿已同步' }
}

/**
 * 按操作类型应用变更到案件，返回合并后的案件、冲突清单与摘要。
 */
export function applyOp(
  claim: ClaimCase,
  opNo: string,
  kind: OpKind,
  payload: OpPayload,
  detectedAt: string,
): { claim: ClaimCase; conflicts: SyncConflict[]; summary: string } {
  switch (kind) {
    case 'lossItem':
      return applyLossItem(claim, opNo, payload, detectedAt)
    case 'attachment':
      return applyAttachment(claim, opNo, payload, detectedAt)
    case 'quote':
      return applyQuote(claim, payload)
    case 'text':
      return applyText(claim, opNo, payload)
  }
}

export function summarizeOp(kind: OpKind, payload: OpPayload): string {
  switch (kind) {
    case 'lossItem':
      return `损失科目 ${new Set((payload.changes ?? []).map((c) => c.itemId)).size} 项字段变更`
    case 'attachment':
      return `附件 ${(payload.attachments ?? []).length} 项版本变更`
    case 'quote':
      return `报价 ${payload.quote?.amount ?? 0} 元`
    case 'text':
      return `文本草稿 ${(payload.text ?? '').slice(0, 12)}…`
  }
}

export function emptyAttachment(): Attachment {
  return { id: '', name: '', category: '现场照片', version: 1, uploadedBy: '', uploadedAt: '' }
}
