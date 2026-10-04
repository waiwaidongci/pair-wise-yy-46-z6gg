import { Component } from '@angular/core'
import { CommonModule } from '@angular/common'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Store } from '@ngrx/store'
import { map, take } from 'rxjs'
import { SyncService } from '../core/sync.service'
import type { SyncOperationStatus } from '../core/models'
import { selectFailedCount, selectLastSyncAt, selectOffline, selectPendingCount, selectSyncQueue, type AppState } from '../core/claims.store'
import { StatusChipComponent } from './status-chip.component'

@Component({
  selector: 'app-sync-queue',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, StatusChipComponent],
  template: `
    <section class="panel sync-panel">
      <div class="panel-head">
        <h3>离线同步队列</h3>
        <app-status-chip [label]="(offline$ | async) ? '离线' : '在线'" [tone]="(offline$ | async) ? 'warn' : 'good'" />
      </div>
      <div class="sync-summary">
        <span><strong>{{ pendingCount$ | async }}</strong> 项待同步</span>
        <span class="failed" *ngIf="(failedCount$ | async) as failed"><strong>{{ failed }}</strong> 项失败待重试</span>
        <span class="muted" *ngIf="lastSyncAt$ | async as lastSyncAt">最近同步 {{ lastSyncAt }}</span>
      </div>
      <div class="op-list">
        <article *ngFor="let op of queue$ | async" [class.op-failed]="op.status === '同步失败'" [class.op-conflict]="op.status === '有冲突'">
          <div class="op-head">
            <strong>{{ op.opId }}</strong>
            <app-status-chip [label]="op.status" [tone]="toneOf(op.status)" />
          </div>
          <p>{{ op.summary }}</p>
          <small>{{ op.createdAt }} · 已尝试 {{ op.attempts }} 次</small>
          <small class="err" *ngIf="op.lastError">{{ op.lastError }}</small>
          <div class="conflict" *ngFor="let conflict of op.conflicts">
            <mat-icon>report_problem</mat-icon>
            <span>{{ conflict.target }} · {{ conflict.field }}：本地「{{ conflict.localValue }}」/ 对方「{{ conflict.remoteValue }}」→ {{ conflict.resolution }}</span>
          </div>
          <button mat-stroked-button color="primary" *ngIf="op.status === '同步失败'" (click)="retry(op.opId)"><mat-icon>refresh</mat-icon> 重试</button>
        </article>
        <p class="empty" *ngIf="!(queue$ | async)?.length">暂无待同步操作，本地修改会按操作号进入此队列。</p>
      </div>
      <footer>
        <button mat-stroked-button color="primary" (click)="syncNow()"><mat-icon>sync</mat-icon> 立即同步</button>
        <button mat-stroked-button [disabled]="!(failedCount$ | async)" (click)="retryAll()">全部重试</button>
        <button mat-button (click)="toggleOffline()">{{ (offline$ | async) ? '恢复在线' : '模拟离线' }}</button>
        <button mat-button (click)="simulateRemote()">模拟他人保存</button>
      </footer>
    </section>
  `,
  styles: [`
    .sync-summary { display: flex; flex-wrap: wrap; gap: 12px; padding: 12px 16px 4px; color: #5d6c76; font-size: 12px; }
    .sync-summary strong { color: #17495a; }
    .sync-summary .failed strong { color: #b1490f; }
    .op-list { display: grid; gap: 8px; max-height: 340px; overflow-y: auto; padding: 10px 14px; }
    .op-list article { padding: 9px 11px; border: 1px solid #e3e9eb; border-left: 3px solid #7fa8b3; border-radius: 7px; background: #f8fafb; }
    .op-list article.op-failed { border-left-color: #c05a1f; background: #fdf6f0; }
    .op-list article.op-conflict { border-left-color: #b98a1d; background: #fdf9ec; }
    .op-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .op-head strong { font-family: monospace; font-size: 12px; color: #1d4c5c; }
    .op-list p { margin: 6px 0 4px; color: #44545e; font-size: 12px; line-height: 1.5; }
    .op-list small { display: block; color: #87939b; font-size: 10px; }
    .op-list .err { margin-top: 3px; color: #b1490f; }
    .op-list button { margin-top: 7px; }
    .conflict { display: flex; gap: 6px; align-items: flex-start; margin-top: 6px; padding: 6px 8px; border-radius: 5px; background: #f7ecd2; color: #7a5a12; font-size: 11px; line-height: 1.5; }
    .conflict mat-icon { flex: none; width: 15px; height: 15px; font-size: 15px; }
    .empty { margin: 4px 0; color: #8b969d; font-size: 12px; }
    footer { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 14px 14px; }
    footer button mat-icon { font-size: 17px; width: 17px; height: 17px; }
  `],
})
export class SyncQueueComponent {
  readonly queue$
  readonly offline$
  readonly pendingCount$
  readonly failedCount$
  readonly lastSyncAt$

  constructor(
    private readonly store: Store<AppState>,
    private readonly syncService: SyncService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.queue$ = this.store.select(selectSyncQueue).pipe(map((queue) => [...queue].sort((a, b) => b.opId.localeCompare(a.opId))))
    this.offline$ = this.store.select(selectOffline)
    this.pendingCount$ = this.store.select(selectPendingCount)
    this.failedCount$ = this.store.select(selectFailedCount)
    this.lastSyncAt$ = this.store.select(selectLastSyncAt)
  }

  toneOf(status: SyncOperationStatus) {
    if (status === '同步失败' || status === '有冲突') return 'warn'
    if (status === '已同步') return 'good'
    return 'default'
  }

  syncNow() {
    this.syncService.syncNow()
  }

  retry(opId: string) {
    this.syncService.retry(opId)
  }

  retryAll() {
    this.syncService.retry()
  }

  toggleOffline() {
    this.offline$.pipe(take(1)).subscribe((offline) => this.syncService.setOffline(!offline))
  }

  simulateRemote() {
    this.store
      .select((state) => state.claims.selectedId)
      .pipe(take(1))
      .subscribe((claimId) =>
        this.syncService.simulateRemote(claimId).subscribe(() => this.snackBar.open('另一查勘员已保存同一案件，再次同步可查看合并与冲突', '关闭', { duration: 2600 })),
      )
  }
}
