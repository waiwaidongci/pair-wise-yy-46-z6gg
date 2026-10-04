import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatIconModule } from '@angular/material/icon'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import type { ClaimCase, PendingSyncItem, SyncConflict, SyncLogEntry } from '../core/models'
import {
  clearSyncedOps,
  dismissConflict,
  saveDraft,
  selectConflicts,
  selectSelectedClaim,
  selectSyncLog,
  selectSyncQueue,
  type AppState,
} from '../core/claims.store'
import { OfflineSyncService } from '../core/offline-sync.service'
import { StatusChipComponent } from '../shared/status-chip.component'

@Component({
  selector: 'app-audit-page',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatCardModule, MatIconModule, StatusChipComponent],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">AUDIT & EVIDENCE / 审计与证据</p>
          <h1>附件版本与操作时间线</h1>
          <p class="muted">报价调整、专家意见和审批动作全部保留在不可覆盖的审计记录中；同步失败与重试也会留痕。</p>
        </div>
        <div class="actions">
          <button mat-stroked-button (click)="restoreDraft()"><mat-icon>restore</mat-icon> 恢复未提交草稿</button>
          <button mat-flat-button color="primary" (click)="exportAudit(claim)"><mat-icon>download</mat-icon> 导出审计包</button>
        </div>
      </div>

      <div class="audit-grid">
        <section class="panel">
          <div class="panel-head"><h3>案件操作时间线</h3><span class="muted">{{ claim.audit.length }} 条记录</span></div>
          <div class="timeline">
            <article *ngFor="let event of claim.audit.slice().reverse(); let first = first">
              <div class="time">{{ event.at }}</div>
              <div class="rail"><i></i><b *ngIf="!first"></b></div>
              <div class="event">
                <strong>{{ event.action }}</strong>
                <p>{{ event.detail }}</p>
                <small>{{ event.operator }} · 记录编号 {{ event.id }}</small>
              </div>
            </article>
          </div>
        </section>

        <aside>
          <section class="panel">
            <div class="panel-head"><h3>附件版本</h3><span class="muted">只增不删</span></div>
            <div class="file-list">
              <div *ngFor="let item of claim.lossItems">
                <strong>{{ item.category }}</strong>
                <article *ngFor="let file of item.attachments">
                  <mat-icon>{{ file.category === '现场照片' ? 'photo_camera' : 'description' }}</mat-icon>
                  <div><span>{{ file.name }}</span><small>V{{ file.version }} · {{ file.uploadedBy }} · {{ file.uploadedAt }}</small></div>
                  <app-status-chip [label]="file.category" />
                </article>
                <small *ngIf="item.attachments.length === 0">暂无附件</small>
              </div>
            </div>
          </section>

          <mat-card appearance="outlined" class="draft-card">
            <div><mat-icon>cloud_sync</mat-icon><strong>未提交编辑可恢复</strong></div>
            <p>草稿写入口会同时保存到浏览器本地，不覆盖案件正式版本；旧版纯文本草稿会自动补入待同步队列。</p>
            <button mat-stroked-button (click)="saveNewDraft()">模拟保存新草稿</button>
          </mat-card>
        </aside>
      </div>

      <div class="sync-grid">
        <section class="panel">
          <div class="panel-head">
            <h3>待同步队列</h3>
            <span class="muted">{{ (queue$ | async)?.length ?? 0 }} 项 · 按操作号提交</span>
            <div class="head-actions">
              <button mat-button (click)="syncAll()"><mat-icon>sync</mat-icon> 全部重试</button>
              <button mat-button (click)="clearSynced()"><mat-icon>clear_all</mat-icon> 清除已同步</button>
            </div>
          </div>
          <div class="queue">
            <div class="queue-row" *ngFor="let item of queue$ | async">
              <div class="queue-main">
                <strong>{{ item.opNo }}</strong>
                <span class="kind">{{ kindLabel(item.kind) }}</span>
                <app-status-chip [label]="statusLabel(item.status)" [tone]="statusTone(item.status)" />
                <span class="retries" *ngIf="item.retries > 0">已重试 {{ item.retries }} 次</span>
                <span class="legacy" *ngIf="item.legacy">旧版草稿</span>
              </div>
              <div class="queue-detail">
                <span class="claim">{{ item.claimId }}</span>
                <span class="summary">{{ summarize(item) }}</span>
                <span class="error" *ngIf="item.error">{{ item.error }}</span>
              </div>
              <div class="queue-actions">
                <button mat-stroked-button color="primary" [disabled]="item.status === 'synced' || item.status === 'syncing'" (click)="retry(item.opNo)">
                  <mat-icon>replay</mat-icon> 重试
                </button>
              </div>
            </div>
            <div class="empty" *ngIf="(queue$ | async)?.length === 0">暂无待同步项</div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>冲突清单</h3><span class="muted">同字段两边都改 → 保留本地版本</span></div>
          <div class="conflicts">
            <div class="conflict-row" *ngFor="let conflict of conflicts$ | async">
              <div class="conflict-head">
                <mat-icon>warning</mat-icon>
                <strong>{{ conflict.field }}</strong>
                <span class="op">{{ conflict.opNo }}</span>
                <button mat-icon-button (click)="dismiss(conflict.id)"><mat-icon>close</mat-icon></button>
              </div>
              <div class="conflict-values">
                <div><label>基线</label><code>{{ format(conflict.baseValue) }}</code></div>
                <div><label>本地（已保留）</label><code class="local">{{ format(conflict.localValue) }}</code></div>
                <div><label>远端</label><code>{{ format(conflict.remoteValue) }}</code></div>
              </div>
            </div>
            <div class="empty" *ngIf="(conflicts$ | async)?.length === 0">暂无冲突</div>
          </div>
        </section>
      </div>

      <section class="panel sync-log-panel">
        <div class="panel-head"><h3>同步事件记录</h3><span class="muted">失败与重试留痕，补全审计时间线</span></div>
        <div class="sync-log">
          <div class="log-row" *ngFor="let entry of syncLog$ | async" [class.failed]="entry.event === 'sync_failed'" [class.succeeded]="entry.event === 'sync_succeeded'">
            <mat-icon>{{ logIcon(entry.event) }}</mat-icon>
            <div>
              <strong>{{ logLabel(entry.event) }}</strong>
              <p>{{ entry.detail }}</p>
              <small>{{ entry.opNo }} · {{ entry.at }}</small>
            </div>
          </div>
          <div class="empty" *ngIf="(syncLog$ | async)?.length === 0">暂无同步事件</div>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .audit-grid { display: grid; grid-template-columns: minmax(0,1fr) 380px; gap: 14px; align-items: start; }
    .timeline { padding: 18px 20px; }
    .timeline article { display: grid; grid-template-columns: 72px 22px minmax(0,1fr); }
    .time { padding-top: 2px; color: #66757e; font-family: monospace; font-size: 11px; text-align: right; }
    .rail { position: relative; }
    .rail i { position: absolute; z-index: 2; top: 3px; left: 7px; width: 8px; height: 8px; border: 2px solid #fff; border-radius: 50%; background: #2c7f89; box-shadow: 0 0 0 1px #2c7f89; }
    .rail b { position: absolute; top: 11px; bottom: -2px; left: 10px; width: 1px; background: #ccd8dc; }
    .event { padding: 0 0 22px 8px; }
    .event strong { font-size: 13px; }
    .event p { margin: 6px 0; color: #56656e; font-size: 12px; line-height: 1.55; }
    .event small { color: #89949b; font-size: 10px; }
    aside { display: grid; gap: 14px; }
    .file-list { padding: 8px 14px 16px; }
    .file-list > div { padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .file-list article { display: grid; grid-template-columns: 28px minmax(0,1fr) auto; gap: 8px; align-items: center; padding: 8px; margin-top: 6px; background: #f5f7f7; border-radius: 6px; }
    .file-list article span, .file-list article small { display: block; }
    .file-list article span { font-size: 12px; }
    .file-list article small { margin-top: 3px; color: #7b878f; font-size: 10px; }
    .draft-card { padding: 16px; }
    .draft-card > div { display: flex; align-items: center; gap: 8px; }
    .draft-card p { margin: 9px 0 12px; color: #69767f; font-size: 12px; line-height: 1.55; }

    .sync-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 14px; margin-top: 14px; align-items: start; }
    .head-actions { display: flex; gap: 4px; }
    .head-actions button { font-size: 12px; }
    .queue { padding: 8px 14px 14px; }
    .queue-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .queue-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .queue-main strong { font-size: 12px; font-family: monospace; }
    .kind { color: #4f626d; font-size: 11px; padding: 2px 6px; background: #eef2f3; border-radius: 4px; }
    .retries { color: #b55a2e; font-size: 11px; }
    .legacy { color: #6b5b95; font-size: 11px; }
    .queue-detail { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
    .queue-detail .claim { color: #6c7a84; font-size: 11px; }
    .queue-detail .summary { color: #4f626d; font-size: 12px; }
    .queue-detail .error { color: #b55a2e; font-size: 11px; }
    .queue-actions { display: flex; align-items: center; }
    .empty { padding: 18px; color: #8b969d; font-size: 12px; text-align: center; }

    .conflicts { padding: 8px 14px 14px; }
    .conflict-row { padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .conflict-head { display: flex; align-items: center; gap: 8px; }
    .conflict-head mat-icon { font-size: 16px; width: 16px; height: 16px; color: #b55a2e; }
    .conflict-head strong { font-size: 13px; }
    .conflict-head .op { color: #89949b; font-size: 10px; font-family: monospace; }
    .conflict-head button { margin-left: auto; }
    .conflict-values { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; margin-top: 8px; }
    .conflict-values label { display: block; color: #8b969d; font-size: 10px; margin-bottom: 3px; }
    .conflict-values code { display: block; padding: 6px 8px; background: #f5f7f7; border-radius: 4px; font-size: 11px; word-break: break-all; }
    .conflict-values code.local { background: #fff3e8; color: #984313; }

    .sync-log-panel { margin-top: 14px; }
    .sync-log { padding: 8px 14px 14px; }
    .log-row { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .log-row mat-icon { font-size: 18px; width: 18px; height: 18px; color: #6c7a84; }
    .log-row.failed mat-icon { color: #b55a2e; }
    .log-row.succeeded mat-icon { color: #246d55; }
    .log-row strong { font-size: 13px; }
    .log-row p { margin: 3px 0; color: #56656e; font-size: 12px; }
    .log-row small { color: #89949b; font-size: 10px; font-family: monospace; }

    @media (max-width: 1050px) { .audit-grid { grid-template-columns: 1fr; } .sync-grid { grid-template-columns: 1fr; } }
  `],
})
export class AuditPageComponent {
  private readonly store = inject(Store<AppState>)
  private readonly offlineSync = inject(OfflineSyncService)
  private readonly snackBar = inject(MatSnackBar)

  claim$: Observable<ClaimCase>
  queue$: Observable<PendingSyncItem[]>
  conflicts$: Observable<SyncConflict[]>
  syncLog$: Observable<SyncLogEntry[]>

  constructor() {
    this.claim$ = this.store.select(selectSelectedClaim)
    this.queue$ = this.store.select(selectSyncQueue)
    this.conflicts$ = this.store.select(selectConflicts)
    this.syncLog$ = this.store.select(selectSyncLog)
  }

  statusLabel(status: PendingSyncItem['status']): string {
    return { pending: '待同步', syncing: '同步中', failed: '同步失败', synced: '已同步' }[status]
  }

  statusTone(status: PendingSyncItem['status']): 'default' | 'warn' | 'good' {
    if (status === 'failed') return 'warn'
    if (status === 'synced') return 'good'
    return 'default'
  }

  kindLabel(kind: PendingSyncItem['kind']): string {
    return { lossItem: '损失科目', attachment: '附件版本', quote: '报价', text: '文本草稿' }[kind]
  }

  summarize(item: PendingSyncItem): string {
    const payload = item.payload
    switch (item.kind) {
      case 'lossItem':
        return `损失科目 ${new Set((payload.changes ?? []).map((c) => c.itemId)).size} 项字段变更`
      case 'attachment':
        return `附件 ${(payload.attachments ?? []).length} 项版本变更`
      case 'quote':
        return `报价 ${payload.quote?.amount ?? 0} 元`
      case 'text':
        return `文本草稿 ${(payload.text ?? '').slice(0, 16)}…`
    }
  }

  format(value: unknown): string {
    if (value === undefined || value === null) return '（空）'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  logIcon(event: SyncLogEntry['event']): string {
    return {
      enqueued: 'add_to_queue',
      sync_started: 'sync',
      sync_failed: 'sync_problem',
      sync_succeeded: 'check_circle',
      conflict_detected: 'warning',
      duplicate_skipped: 'filter_none',
    }[event]
  }

  logLabel(event: SyncLogEntry['event']): string {
    return {
      enqueued: '已入队',
      sync_started: '开始同步',
      sync_failed: '同步失败',
      sync_succeeded: '同步成功',
      conflict_detected: '检测到冲突',
      duplicate_skipped: '跳过重复记账',
    }[event]
  }

  retry(opNo: string) {
    this.offlineSync.retry(opNo)
  }

  syncAll() {
    this.offlineSync.syncAll()
  }

  clearSynced() {
    this.store.dispatch(clearSyncedOps())
  }

  dismiss(id: string) {
    this.store.dispatch(dismissConflict({ id }))
  }

  restoreDraft() {
    const draft = localStorage.getItem('claims-assessment-draft') ?? '待补充房屋檩条第三方复测依据。'
    this.store.dispatch(saveDraft({ draft }))
    this.snackBar.open('已恢复本地未提交草稿', '关闭', { duration: 1800 })
  }

  saveNewDraft() {
    this.store.dispatch(saveDraft({ draft: `草稿更新于 ${new Date().toLocaleString('zh-CN')}` }))
  }

  exportAudit(claim: ClaimCase) {
    const lines = ['时间,操作者,动作,说明', ...claim.audit.map((event) => [event.at, event.operator, event.action, event.detail].map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))]
    const url = URL.createObjectURL(new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${claim.id}-审计记录.csv`
    link.click()
    URL.revokeObjectURL(url)
    this.snackBar.open('审计包已导出', '关闭', { duration: 1600 })
  }
}
