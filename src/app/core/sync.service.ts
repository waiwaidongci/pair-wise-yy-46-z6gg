import { HttpClient } from '@angular/common/http'
import { Injectable } from '@angular/core'
import { Store } from '@ngrx/store'
import { take } from 'rxjs'
import type { ClaimCase, SyncResult } from './models'
import { opFailed, opSynced, opSyncing, retryOps, selectClaimsState, setOffline, type AppState } from './claims.store'

@Injectable({ providedIn: 'root' })
export class SyncService {
  private running = false

  constructor(
    private readonly http: HttpClient,
    private readonly store: Store<AppState>,
  ) {}

  setOffline(offline: boolean) {
    this.http.post<{ offline: boolean }>('/api/sync-mode', { offline }).subscribe((result) => this.store.dispatch(setOffline({ offline: result.offline })))
  }

  simulateRemote(claimId: string) {
    return this.http.post<ClaimCase>(`/api/claims/${claimId}/simulate-remote`, {})
  }

  /** 按操作号顺序提交待同步项；任一失败即停止，剩余进度保留在队列中 */
  syncNow() {
    if (this.running) return
    this.store
      .select(selectClaimsState)
      .pipe(take(1))
      .subscribe((state) => {
        const next = state.syncQueue.filter((op) => op.status === '待同步').sort((a, b) => a.opId.localeCompare(b.opId))[0]
        if (!next) return
        this.running = true
        this.store.dispatch(opSyncing({ opId: next.opId }))
        this.http.post<SyncResult>(`/api/claims/${next.claimId}/sync`, next).subscribe({
          next: (result) => {
            this.store.dispatch(opSynced({ opId: next.opId, claim: result.claim, conflicts: result.conflicts ?? [], duplicate: result.duplicate }))
            this.running = false
            this.syncNow()
          },
          error: (error) => {
            const message = error?.error?.message ?? error?.message ?? '网络异常'
            this.store.dispatch(opFailed({ opId: next.opId, claimId: next.claimId, error: message }))
            this.running = false
          },
        })
      })
  }

  retry(opId?: string) {
    this.store.dispatch(retryOps({ opId }))
    this.syncNow()
  }
}
