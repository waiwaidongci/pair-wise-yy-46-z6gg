import { Injectable } from '@angular/core'
import { Store } from '@ngrx/store'
import { take } from 'rxjs'
import { ClaimsService } from './claims.service'
import {
  enqueueOp,
  retryOp,
  selectSyncQueue,
  syncOpFailed,
  syncOpStarted,
  syncOpSucceeded,
  type AppState,
} from './claims.store'
import type { OpKind, OpPayload, PendingSyncItem } from './models'

function newOpNo(): string {
  return `OP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 离线同步编排：草稿按操作号提交成待办队列，失败保留进度可重试。
 */
@Injectable({ providedIn: 'root' })
export class OfflineSyncService {
  private readonly processing = new Set<string>()

  constructor(
    private readonly store: Store<AppState>,
    private readonly claimsService: ClaimsService,
  ) {}

  /** 提交一个待同步操作，入队后立即尝试同步。返回操作号。 */
  enqueue(claimId: string, kind: OpKind, payload: OpPayload, baseVersion: number, legacy = false): string {
    const opNo = newOpNo()
    this.store.dispatch(enqueueOp({ opNo, claimId, kind, payload, baseVersion, legacy }))
    void this.syncOne(opNo)
    return opNo
  }

  /** 同步单个操作。首次尝试会失败（模拟离线），重试时合并生效。 */
  syncOne(opNo: string): void {
    if (this.processing.has(opNo)) return
    let item: PendingSyncItem | undefined
    this.store.select(selectSyncQueue).pipe(take(1)).subscribe((queue) => {
      item = queue.find((entry) => entry.opNo === opNo)
    })
    if (!item || item.status === 'synced') return

    this.processing.add(opNo)
    this.store.dispatch(syncOpStarted({ opNo }))
    this.claimsService
      .syncOp(item.claimId, opNo, item.kind, item.payload, item.baseVersion, item.retries + 1)
      .subscribe({
        next: (result) => {
          this.store.dispatch(
            syncOpSucceeded({
              opNo,
              claim: result.claim,
              conflicts: result.conflicts,
              applied: result.applied,
              duplicated: result.duplicated,
            }),
          )
          this.processing.delete(opNo)
        },
        error: (err: { error?: { message?: string }; message?: string }) => {
          const message = err?.error?.message ?? err?.message ?? '同步失败'
          this.store.dispatch(syncOpFailed({ opNo, error: message }))
          this.processing.delete(opNo)
        },
      })
  }

  /** 重试失败或待同步的操作。 */
  retry(opNo: string): void {
    this.store.dispatch(retryOp({ opNo }))
    void this.syncOne(opNo)
  }

  /** 全部重试。 */
  syncAll(): void {
    this.store.select(selectSyncQueue).pipe(take(1)).subscribe((queue) => {
      for (const item of queue) {
        if (item.status === 'pending' || item.status === 'failed') void this.syncOne(item.opNo)
      }
    })
  }
}
