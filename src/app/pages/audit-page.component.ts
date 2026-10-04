import { Component } from '@angular/core'
import { CommonModule } from '@angular/common'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatIconModule } from '@angular/material/icon'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Store } from '@ngrx/store'
import { map, type Observable } from 'rxjs'
import { SyncService } from '../core/sync.service'
import type { ClaimCase, SyncConflict } from '../core/models'
import { selectConflicts, selectFailedCount, selectSelectedClaim, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'
import { SyncQueueComponent } from '../shared/sync-queue.component'

@Component({
  selector: 'app-audit-page',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatCardModule, MatIconModule, StatusChipComponent, SyncQueueComponent],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">AUDIT & EVIDENCE / 审计与证据</p>
          <h1>附件版本与操作时间线</h1>
          <p class="muted">报价调整、同步失败与重试、审批动作全部保留在不可覆盖的审计记录中。</p>
        </div>
        <div class="actions">
          <button mat-stroked-button color="primary" [disabled]="!(failedCount$ | async)" (click)="retryFailed()"><mat-icon>refresh</mat-icon> 重试失败操作</button>
          <button mat-flat-button color="primary" (click)="exportAudit(claim)"><mat-icon>download</mat-icon> 导出审计包</button>
        </div>
      </div>

      <div class="audit-grid">
        <section class="panel">
          <div class="panel-head"><h3>案件操作时间线</h3><span class="muted">{{ claim.audit.length }} 条记录</span></div>
          <div class="timeline">
            <article *ngFor="let event of claim.audit.slice().reverse(); let first = first" [class.sync-failed]="event.action === '同步失败'" [class.sync-retry]="event.action === '同步重试'">
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
          <section class="panel" *ngIf="(conflicts$ | async)?.length">
            <div class="panel-head"><h3>字段冲突</h3><app-status-chip [label]="(conflicts$ | async)?.length + ' 处'" tone="warn" /></div>
            <div class="conflict-list">
              <article *ngFor="let conflict of conflicts$ | async">
                <div><strong>{{ conflict.target }}</strong><app-status-chip [label]="conflict.resolution" tone="warn" /></div>
                <p>{{ conflict.opId }} · {{ conflict.field }}：本地「{{ conflict.localValue }}」，对方「{{ conflict.remoteValue }}」</p>
              </article>
            </div>
          </section>

          <app-sync-queue />

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
        </aside>
      </div>
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
    .timeline article.sync-failed .rail i { background: #c05a1f; box-shadow: 0 0 0 1px #c05a1f; }
    .timeline article.sync-retry .rail i { background: #b98a1d; box-shadow: 0 0 0 1px #b98a1d; }
    .event { padding: 0 0 22px 8px; }
    .event strong { font-size: 13px; }
    .event p { margin: 6px 0; color: #56656e; font-size: 12px; line-height: 1.55; }
    .event small { color: #89949b; font-size: 10px; }
    aside { display: grid; gap: 14px; }
    .conflict-list { display: grid; gap: 8px; padding: 12px 14px 14px; }
    .conflict-list article { padding: 9px 11px; border-left: 3px solid #b98a1d; border-radius: 6px; background: #fdf9ec; }
    .conflict-list article > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .conflict-list strong { font-size: 12px; }
    .conflict-list p { margin: 6px 0 0; color: #7a5a12; font-size: 11px; line-height: 1.5; }
    .file-list { padding: 8px 14px 16px; }
    .file-list > div { padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .file-list article { display: grid; grid-template-columns: 28px minmax(0,1fr) auto; gap: 8px; align-items: center; padding: 8px; margin-top: 6px; background: #f5f7f7; border-radius: 6px; }
    .file-list article span, .file-list article small { display: block; }
    .file-list article span { font-size: 12px; }
    .file-list article small { margin-top: 3px; color: #7b878f; font-size: 10px; }
    @media (max-width: 1050px) { .audit-grid { grid-template-columns: 1fr; } }
  `],
})
export class AuditPageComponent {
  claim$: Observable<ClaimCase>
  conflicts$: Observable<SyncConflict[]>
  failedCount$: Observable<number>

  constructor(
    private readonly store: Store<AppState>,
    private readonly syncService: SyncService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
    this.conflicts$ = this.store.select(selectConflicts).pipe(map((conflicts) => conflicts.slice().reverse()))
    this.failedCount$ = this.store.select(selectFailedCount)
  }

  retryFailed() {
    this.syncService.retry()
  }

  exportAudit(claim: any) {
    const lines = ['时间,操作者,动作,说明', ...claim.audit.map((event: any) => [event.at, event.operator, event.action, event.detail].map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))]
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${claim.id}-审计记录.csv`
    link.click()
    URL.revokeObjectURL(url)
    this.snackBar.open('审计包已导出', '关闭', { duration: 1600 })
  }
}
