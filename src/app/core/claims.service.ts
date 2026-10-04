import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable } from '@angular/core'
import type { ClaimCase, ClaimFilters, OpKind, OpPayload, PagedClaims, SyncResult } from './models'

@Injectable({ providedIn: 'root' })
export class ClaimsService {
  constructor(private readonly http: HttpClient) {}

  list(filters: ClaimFilters) {
    const params = new HttpParams()
      .set('query', filters.query)
      .set('status', filters.status)
      .set('risk', filters.risk)
      .set('page', filters.page)
      .set('pageSize', filters.pageSize)
    return this.http.get<PagedClaims>('/api/claims', { params })
  }

  get(id: string) {
    return this.http.get<ClaimCase>(`/api/claims/${id}`)
  }

  addQuote(claimId: string, body: { itemId: string; amount: number; reason: string }) {
    return this.http.post(`/api/claims/${claimId}/quotes`, body)
  }

  approve(claimId: string, body: { role: string; result: string; comment: string }) {
    return this.http.post(`/api/claims/${claimId}/approvals`, body)
  }

  /** 按操作号提交待同步项；服务端幂等，已生效的操作号不重复记账。 */
  syncOp(claimId: string, opNo: string, kind: OpKind, payload: OpPayload, baseVersion: number, attempt: number) {
    return this.http.post<SyncResult>(`/api/claims/${claimId}/sync`, { opNo, kind, payload, baseVersion, attempt })
  }

  /** 模拟远端他人变更同一字段（演示冲突检测）。 */
  simulateRemote(claimId: string, itemId: string, field: string, value: unknown) {
    return this.http.post<ClaimCase>(`/api/claims/${claimId}/simulate-remote`, { itemId, field, value })
  }
}
