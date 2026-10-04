import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http'
import { delay, of, throwError } from 'rxjs'
import { seedClaims } from './seed'
import { applyOp } from './sync.engine'
import type { ClaimCase, OpKind, OpPayload, SyncResult } from './models'

let claims: ClaimCase[] = structuredClone(seedClaims)

// 已生效操作号台账：重试同一操作号不重复记账
const appliedOps = new Set<string>()

function now(): string {
  return new Date().toLocaleString('zh-CN')
}

export const mockApiInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request)

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

  if (request.method === 'GET' && request.url.startsWith('/api/claims/')) {
    const id = request.url.split('/').pop()
    const item = claims.find((claim) => claim.id === id)
    return item ? of(new HttpResponse({ status: 200, body: item })).pipe(delay(120)) : throwError(() => new HttpErrorResponse({ status: 404 }))
  }

  // 按操作号同步待办项：幂等 + 三路合并
  if (request.method === 'POST' && request.url.endsWith('/sync')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { opNo: string; kind: OpKind; payload: OpPayload; baseVersion: number; attempt: number }
    const claim = claims.find((item) => item.id === id)
    if (!claim) return throwError(() => new HttpErrorResponse({ status: 404 }))

    // 已经生效过 → 直接返回当前案件，不重复记账
    if (appliedOps.has(body.opNo)) {
      const duplicated: SyncResult = { claim, conflicts: [], applied: false, duplicated: true }
      return of(new HttpResponse({ status: 200, body: duplicated })).pipe(delay(120))
    }

    // 模拟离线：首次尝试必然失败，保留进度待重试
    if (body.attempt === 1) {
      return throwError(
        () =>
          new HttpErrorResponse({
            status: 500,
            error: { message: '离线同步失败：网络不可用，请重试', retryable: true },
          }),
      ).pipe(delay(320))
    }

    const detectedAt = now()
    const { claim: merged, conflicts, summary } = applyOp(claim, body.opNo, body.kind, body.payload, detectedAt)

    // 仅在首次生效时写审计
    merged.audit.push({
      id: `A-${body.opNo}`,
      at: detectedAt,
      operator: '当前用户',
      action: '草稿生效',
      detail: `操作号 ${body.opNo} · ${summary}${conflicts.length ? ` · ${conflicts.length} 项冲突已保留本地` : ''}`,
    })

    const idx = claims.findIndex((item) => item.id === id)
    claims[idx] = merged
    appliedOps.add(body.opNo)

    const result: SyncResult = { claim: merged, conflicts, applied: true, duplicated: false }
    return of(new HttpResponse({ status: 200, body: result })).pipe(delay(180))
  }

  // 模拟远端他人变更：用于演示同字段两边都改时的冲突检测
  if (request.method === 'POST' && request.url.endsWith('/simulate-remote')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { itemId: string; field: string; value: unknown }
    const claim = claims.find((item) => item.id === id)
    const item = claim?.lossItems.find((loss) => loss.id === body.itemId)
    if (!claim || !item) return throwError(() => new HttpErrorResponse({ status: 404 }))
    ;(item as unknown as Record<string, unknown>)[body.field] = body.value
    claim.audit.push({
      id: `A-REMOTE-${Date.now()}`,
      at: now(),
      operator: '远端查勘员',
      action: '他人变更',
      detail: `科目 ${item.category} 的 ${body.field} 字段已被远端修改`,
    })
    return of(new HttpResponse({ status: 200, body: claim })).pipe(delay(120))
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
      createdAt: now(),
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
    step.completedAt = now()
    item.audit.push({ id: `A-${Date.now()}`, at: '刚刚', operator: '当前用户', action: `会签${step.status}`, detail: body.comment })
    item.status = body.result === '已通过' ? '审批中' : '退回补件'
    return of(new HttpResponse({ status: 200, body: item })).pipe(delay(180))
  }

  return next(request)
}
