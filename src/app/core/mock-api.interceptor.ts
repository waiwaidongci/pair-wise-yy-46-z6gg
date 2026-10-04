import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http'
import { delay, of, throwError } from 'rxjs'
import { seedClaims } from './seed'
import type { SyncConflict, SyncOperation, SyncResult } from './models'

let claims = structuredClone(seedClaims)
let offline = false
let remoteEditSeq = 0
// 服务端已生效的操作号，重复提交不再记账
const appliedOps = new Map<string, Set<string>>()

const now = () => new Date().toLocaleString('zh-CN')

const unavailable = () =>
  throwError(() => new HttpErrorResponse({ status: 503, statusText: 'Service Unavailable', error: { message: '网络不可用，操作已保留在待同步队列' } })).pipe(delay(150))

function applyOperation(op: SyncOperation): SyncResult | null {
  const claim = claims.find((item) => item.id === op.claimId)
  if (!claim) return null
  const applied = appliedOps.get(op.claimId) ?? new Set<string>()
  appliedOps.set(op.claimId, applied)
  if (applied.has(op.opId)) return { duplicate: true, conflicts: [], claim }

  const conflicts: SyncConflict[] = []
  if (op.type === 'loss-item') {
    const item = claim.lossItems.find((loss) => loss.id === op.itemId)
    if (!item) return null
    for (const change of op.changes) {
      const current = (item as unknown as Record<string, unknown>)[change.field]
      // 基线之后两边都改过同一字段：保留本地版本并记录冲突
      if (current !== change.base && current !== change.value) {
        conflicts.push({
          opId: op.opId,
          itemId: item.id,
          target: `${item.category} · ${item.description}`,
          field: change.label,
          localValue: String(change.value),
          remoteValue: String(current),
          resolution: '保留本地版本',
        })
      }
      ;(item as unknown as Record<string, unknown>)[change.field] = change.value
    }
  } else if (op.type === 'attachment') {
    const item = claim.lossItems.find((loss) => loss.id === op.itemId)
    const attachment = item?.attachments.find((file) => file.id === op.attachmentId)
    const change = op.changes[0]
    if (!item || !attachment || !change) return null
    if (attachment.version !== change.base && attachment.version !== change.value) {
      conflicts.push({
        opId: op.opId,
        itemId: item.id,
        target: attachment.name,
        field: change.label,
        localValue: `V${change.value}`,
        remoteValue: `V${attachment.version}`,
        resolution: '保留本地版本',
      })
    }
    attachment.version = change.value as number
    attachment.uploadedBy = '当前用户'
    attachment.uploadedAt = now()
  } else {
    claim.surveyNotes = [...(claim.surveyNotes ?? []), String(op.changes[0]?.value ?? '')]
  }

  claim.audit.push({
    id: `A-${op.opId}`,
    at: now(),
    operator: '当前用户',
    action: conflicts.length ? '同步写入（含冲突，保留本地）' : '同步写入',
    detail: `${op.opId} · ${op.summary}`,
  })
  applied.add(op.opId)
  return { duplicate: false, conflicts, claim }
}

export const mockApiInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request)

  if (request.method === 'POST' && request.url === '/api/sync-mode') {
    offline = !!(request.body as { offline: boolean }).offline
    return of(new HttpResponse({ status: 200, body: { offline } }))
  }

  if (offline) return unavailable()

  if (request.method === 'GET' && request.url === '/api/claims') {
    const query = request.params.get('query')?.toLowerCase() ?? ''
    const status = request.params.get('status') ?? ''
    const risk = request.params.get('risk') ?? ''
    const page = Number(request.params.get('page') ?? 1)
    const pageSize = Number(request.params.get('pageSize') ?? 10)
    const filtered = claims.filter(
      (item) =>
        (!query || `${item.id}${item.insured}${item.policyNo}`.toLowerCase().includes(query)) &&
        (!status || item.status === status) &&
        (!risk || item.riskLevel === risk),
    )
    const start = (page - 1) * pageSize
    return of(new HttpResponse({ status: 200, body: { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize } })).pipe(delay(220))
  }

  if (request.method === 'POST' && request.url.endsWith('/sync')) {
    const op = request.body as SyncOperation
    const result = applyOperation(op)
    return result
      ? of(new HttpResponse({ status: 200, body: result })).pipe(delay(200))
      : throwError(() => new HttpErrorResponse({ status: 404 }))
  }

  if (request.method === 'POST' && request.url.endsWith('/simulate-remote')) {
    const id = request.url.split('/').at(-2)
    const claim = claims.find((item) => item.id === id)
    if (!claim) return throwError(() => new HttpErrorResponse({ status: 404 }))
    const item = claim.lossItems[0]
    remoteEditSeq += 1
    item.salvage += 5000
    if (!item.damage.includes('复测补充')) item.damage = `${item.damage} 复测补充：相邻跨屋面檩条亦有变形。`
    const attachment = item.attachments[0]
    if (attachment) {
      attachment.version += 1
      attachment.uploadedBy = '王蔚'
      attachment.uploadedAt = now()
    }
    claim.audit.push({
      id: `A-R${remoteEditSeq}`,
      at: now(),
      operator: '王蔚 / 另一查勘员',
      action: '并发保存',
      detail: '对方离线草稿同步：调整损失事实、残值与附件版本。',
    })
    return of(new HttpResponse({ status: 200, body: claim })).pipe(delay(150))
  }

  if (request.method === 'GET' && request.url.startsWith('/api/claims/')) {
    const id = request.url.split('/').pop()
    const item = claims.find((claim) => claim.id === id)
    return item ? of(new HttpResponse({ status: 200, body: item })).pipe(delay(120)) : throwError(() => new HttpErrorResponse({ status: 404 }))
  }

  if (request.method === 'POST' && request.url.endsWith('/quotes')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { itemId: string; amount: number; reason: string }
    const item = claims.find((claim) => claim.id === id)?.lossItems.find((loss) => loss.id === body.itemId)
    if (!item) return throwError(() => new HttpErrorResponse({ status: 404 }))
    item.repairQuotes.push({
      version: item.repairQuotes.length + 1,
      amount: body.amount,
      reason: body.reason,
      operator: '当前用户',
      createdAt: new Date().toLocaleString('zh-CN'),
    })
    return of(new HttpResponse({ status: 201, body: item })).pipe(delay(180))
  }

  if (request.method === 'POST' && request.url.endsWith('/approvals')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { role: string; result: string; comment: string }
    const item = claims.find((claim) => claim.id === id)
    const step = item?.approvals.find((approval) => approval.role === body.role)
    if (!item || !step) return throwError(() => new HttpErrorResponse({ status: 404 }))
    step.status = body.result === '已通过' ? '已通过' : '已退回'
    step.operator = '当前用户'
    step.comment = body.comment
    step.completedAt = new Date().toLocaleString('zh-CN')
    item.audit.push({ id: `A-${Date.now()}`, at: '刚刚', operator: '当前用户', action: `会签${step.status}`, detail: body.comment })
    item.status = body.result === '已通过' ? '审批中' : '退回补件'
    return of(new HttpResponse({ status: 200, body: item })).pipe(delay(180))
  }

  return next(request)
}
