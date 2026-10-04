import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatExpansionModule } from '@angular/material/expansion'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { take, type Observable } from 'rxjs'
import { ClaimsService } from '../core/claims.service'
import { SyncService } from '../core/sync.service'
import { buildClaimOps, opIdOf, timestamp } from '../core/sync.engine'
import type { Attachment, ClaimCase, SyncOperation } from '../core/models'
import { enqueueOps, saveAssessment, saveDraft, selectOpSeq, selectSelectedClaim, selectSyncQueue, updateClaim, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'
import { SyncQueueComponent } from '../shared/sync-queue.component'

@Component({
  selector: 'app-assessment-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    StatusChipComponent,
    SyncQueueComponent,
  ],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">ASSESSMENT / 查勘定损</p>
          <h1>{{ claim.id }} · {{ claim.insured }}</h1>
          <p class="muted">{{ claim.lossAddress }} · 事故日 {{ claim.accidentDate }} · 查勘员 {{ claim.adjuster }}</p>
        </div>
        <div class="actions">
          <button mat-stroked-button><mat-icon>upload_file</mat-icon> 上传查勘材料</button>
          <button mat-flat-button color="primary" (click)="saveAll(claim)">保存本次查勘</button>
        </div>
      </div>

      <div class="summary-grid">
        <mat-card appearance="outlined"><span>损失科目</span><strong>{{ claim.lossItems.length }}</strong><small>{{ disputedCount(claim) }} 项存在争议</small></mat-card>
        <mat-card appearance="outlined"><span>修复报价合计</span><strong>{{ quoteTotal(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong><small>取各科目最新报价</small></mat-card>
        <mat-card appearance="outlined"><span>残值合计</span><strong>{{ salvageTotal(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong><small>待扣减</small></mat-card>
        <mat-card appearance="outlined"><span>建议准备金</span><strong>{{ suggestedReserve(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong><small>责任比例后计入免赔</small></mat-card>
      </div>

      <div class="assessment-grid">
        <section class="panel">
          <div class="panel-head"><h3>损失科目与报价版本</h3><span class="muted">保存时按操作号进入待同步队列</span></div>
          <mat-accordion multi>
            <mat-expansion-panel *ngFor="let item of claim.lossItems; let itemIndex = index" [expanded]="itemIndex === activeIndex" (opened)="activeIndex = itemIndex">
              <mat-expansion-panel-header>
                <mat-panel-title>
                  <strong>{{ item.category }}</strong>
                  <span>{{ item.description }}</span>
                </mat-panel-title>
                <mat-panel-description>
                  <app-status-chip [label]="item.disputed ? '争议项' : '已确认'" [tone]="item.disputed ? 'warn' : 'good'" />
                  <span class="quote">{{ latestQuote(item) | currency:'CNY':'symbol':'1.0-0' }}</span>
                </mat-panel-description>
              </mat-expansion-panel-header>
              <div class="loss-body">
                <div class="facts">
                  <label>损失事实</label>
                  <textarea [(ngModel)]="item.damage" rows="3"></textarea>
                  <div class="inline-fields">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>残值</mat-label><input matInput type="number" [(ngModel)]="item.salvage" /></mat-form-field>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>责任比例</mat-label><input matInput type="number" step="0.05" [(ngModel)]="item.liability" /></mat-form-field>
                  </div>
                </div>
                <div class="quote-history">
                  <h4>报价版本</h4>
                  <table mat-table [dataSource]="item.repairQuotes">
                    <ng-container matColumnDef="version"><th mat-header-cell *matHeaderCellDef>版本</th><td mat-cell *matCellDef="let quote">V{{ quote.version }}</td></ng-container>
                    <ng-container matColumnDef="amount"><th mat-header-cell *matHeaderCellDef>金额</th><td mat-cell *matCellDef="let quote">{{ quote.amount | currency:'CNY':'symbol':'1.0-0' }}</td></ng-container>
                    <ng-container matColumnDef="reason"><th mat-header-cell *matHeaderCellDef>调整理由</th><td mat-cell *matCellDef="let quote">{{ quote.reason }}<small>{{ quote.operator }} · {{ quote.createdAt }}</small></td></ng-container>
                    <tr mat-header-row *matHeaderRowDef="quoteColumns"></tr>
                    <tr mat-row *matRowDef="let row; columns: quoteColumns"></tr>
                  </table>
                </div>
                <div class="attachment-row">
                  <strong>关联材料</strong>
                  <span *ngFor="let file of item.attachments">
                    <mat-icon>attach_file</mat-icon>{{ file.name }} · V{{ file.version }}
                    <button mat-icon-button class="bump" (click)="bumpVersion(file)" title="上传新版本"><mat-icon>add</mat-icon></button>
                  </span>
                </div>
                <button mat-stroked-button color="primary" (click)="startQuote(item)"><mat-icon>edit_road</mat-icon> 调整最新报价</button>
                <div class="quote-form" *ngIf="quotingItemId === item.id">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>新报价</mat-label><input matInput type="number" [(ngModel)]="quoteAmount" /></mat-form-field>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="reason-field"><mat-label>调整理由（必填）</mat-label><input matInput [(ngModel)]="quoteReason" /></mat-form-field>
                  <button mat-flat-button color="primary" [disabled]="!quoteReason.trim() || !quoteAmount" (click)="submitQuote(claim.id, item.id)">生成新版本</button>
                </div>
              </div>
            </mat-expansion-panel>
          </mat-accordion>
        </section>

        <aside>
          <section class="panel">
            <div class="panel-head"><h3>专家记录</h3><span class="muted">不可覆盖</span></div>
            <div class="expert-list">
              <div *ngFor="let item of claim.lossItems">
                <strong>{{ item.category }}</strong>
                <p *ngFor="let note of item.expertNotes">{{ note }}</p>
                <small *ngIf="item.expertNotes.length === 0">暂无专家补充说明</small>
              </div>
            </div>
          </section>
          <section class="panel draft-panel">
            <div class="panel-head"><h3>查勘草稿</h3><app-status-chip [label]="draftOpsFor(claim.id).length ? '待同步 ' + draftOpsFor(claim.id).length + ' 项' : '无待同步'" [tone]="draftOpsFor(claim.id).length ? 'warn' : 'good'" /></div>
            <textarea rows="5" [(ngModel)]="draft" (blur)="persistDraft()" placeholder="离线时先记录，提交后按操作号进入待同步队列。"></textarea>
            <div class="draft-actions">
              <button mat-stroked-button color="primary" [disabled]="!draft.trim()" (click)="commitDraft(claim.id)"><mat-icon>playlist_add</mat-icon> 提交草稿到待同步队列</button>
            </div>
            <div class="draft-ops" *ngIf="draftOpsFor(claim.id).length">
              <article *ngFor="let op of draftOpsFor(claim.id)">
                <app-status-chip [label]="op.status" [tone]="op.status === '同步失败' ? 'warn' : 'default'" />
                <span>{{ op.opId }} · {{ op.summary }}</span>
              </article>
            </div>
            <div class="synced-notes" *ngIf="claim.surveyNotes?.length">
              <strong>已同步草稿</strong>
              <p *ngFor="let note of claim.surveyNotes">{{ note }}</p>
            </div>
            <small>每次提交生成独立操作号，多人草稿按操作号合并，不再互相覆盖。</small>
          </section>
          <app-sync-queue />
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .summary-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; margin-bottom: 14px; }
    .summary-grid mat-card { padding: 15px; border-color: #dce3e6; }
    .summary-grid span, .summary-grid small { display: block; color: #6e7a83; font-size: 12px; }
    .summary-grid strong { display: block; margin: 6px 0; color: #153747; font-size: 24px; }
    .assessment-grid { display: grid; grid-template-columns: minmax(0,1fr) 330px; gap: 14px; align-items: start; }
    mat-panel-title { display: flex; flex-direction: column; gap: 4px; }
    mat-panel-title span { color: #7a858c; font-size: 11px; }
    mat-panel-description { justify-content: flex-end; gap: 12px; }
    .quote { color: #1d6670; font-weight: 800; }
    .loss-body { display: grid; gap: 16px; padding-top: 10px; }
    .facts > label { display: block; margin-bottom: 6px; color: #53636d; font-size: 12px; font-weight: 700; }
    textarea { width: 100%; padding: 10px; border: 1px solid #cbd5da; border-radius: 8px; resize: vertical; font: inherit; }
    .inline-fields, .quote-form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .inline-fields mat-form-field { width: 150px; }
    .quote-history h4 { margin: 0 0 8px; font-size: 13px; }
    table { width: 100%; }
    td small { display: block; margin-top: 4px; color: #7a858c; }
    .attachment-row { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
    .attachment-row span { display: inline-flex; align-items: center; gap: 3px; padding: 5px 7px; color: #4f626d; background: #f0f4f5; border-radius: 5px; font-size: 11px; }
    .attachment-row mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .attachment-row .bump { width: 22px; height: 22px; padding: 0; margin-left: 2px; }
    .attachment-row .bump mat-icon { font-size: 15px; width: 15px; height: 15px; color: #2c7f89; }
    .quote-form { padding: 12px; background: #f4f7f8; border-left: 3px solid #277b89; }
    .reason-field { flex: 1; min-width: 220px; }
    aside { display: grid; gap: 14px; }
    .expert-list { padding: 8px 16px 16px; }
    .expert-list div { padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .expert-list p { margin: 6px 0 0; color: #65737c; font-size: 11px; line-height: 1.5; }
    .expert-list small { color: #8b969d; font-size: 11px; }
    .draft-panel { padding-bottom: 14px; }
    .draft-panel textarea { width: calc(100% - 28px); margin: 14px 14px 6px; }
    .draft-actions { padding: 0 14px; }
    .draft-ops { display: grid; gap: 6px; padding: 10px 14px 0; }
    .draft-ops article { display: flex; align-items: center; gap: 7px; font-size: 11px; color: #55646d; }
    .synced-notes { margin: 10px 14px 0; padding: 8px 10px; border-radius: 6px; background: #f0f7f4; }
    .synced-notes strong { font-size: 11px; color: #2c6b52; }
    .synced-notes p { margin: 5px 0 0; color: #4f6a5c; font-size: 11px; line-height: 1.5; }
    .draft-panel small { display: block; margin: 8px 14px 0; color: #7d8991; }
    @media (max-width: 1050px) { .assessment-grid { grid-template-columns: 1fr; } .summary-grid { grid-template-columns: repeat(2,1fr); } }
    @media (max-width: 620px) { .summary-grid { grid-template-columns: 1fr 1fr; } }
  `],
})
export class AssessmentPageComponent {
  claim$: Observable<ClaimCase>
  quoteColumns = ['version', 'amount', 'reason']
  activeIndex = 0
  quotingItemId = ''
  quoteAmount = 0
  quoteReason = ''
  draft = ''
  queue: SyncOperation[] = []
  private snapshot?: ClaimCase

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly syncService: SyncService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
    // 快照作为保存时的合并基线，ngModel 的本地改动与之对比生成操作
    this.claim$.subscribe((claim) => (this.snapshot = structuredClone(claim)))
    this.store.select((state) => state.claims.draft).subscribe((draft) => (this.draft = draft))
    this.store.select(selectSyncQueue).subscribe((queue) => (this.queue = queue))
  }

  draftOpsFor(claimId: string) {
    return this.queue.filter((op) => op.type === 'draft-note' && op.claimId === claimId && op.status !== '已同步')
  }

  latestQuote(item: { repairQuotes: Array<{ amount: number }> }) {
    return item.repairQuotes.at(-1)?.amount ?? 0
  }

  quoteTotal(claim: { lossItems: Array<{ repairQuotes: Array<{ amount: number }> }> }) {
    return claim.lossItems.reduce((sum, item) => sum + this.latestQuote(item), 0)
  }

  salvageTotal(claim: { lossItems: Array<{ salvage: number }> }) {
    return claim.lossItems.reduce((sum, item) => sum + item.salvage, 0)
  }

  suggestedReserve(claim: any) {
    const net = claim.lossItems.reduce((sum: number, item: any) => sum + (this.latestQuote(item) - item.salvage) * item.liability, 0)
    return Math.max(0, net - claim.deductible)
  }

  disputedCount(claim: { lossItems: Array<{ disputed: boolean }> }) {
    return claim.lossItems.filter((item) => item.disputed).length
  }

  startQuote(item: any) {
    this.quotingItemId = item.id
    this.quoteAmount = this.latestQuote(item)
    this.quoteReason = ''
  }

  submitQuote(claimId: string, itemId: string) {
    if (!this.quoteReason.trim()) return
    this.service.addQuote(claimId, { itemId, amount: Number(this.quoteAmount), reason: this.quoteReason }).subscribe({
      next: () => {
        this.store.select(selectSelectedClaim).subscribe((claim) => this.store.dispatch(updateClaim({ claim: structuredClone(claim) })))
        this.snackBar.open('新报价版本已生成，原记录保持可追溯', '关闭', { duration: 2200 })
        this.quotingItemId = ''
      },
      error: () => this.snackBar.open('当前离线，报价未提交，请恢复在线后重试', '关闭', { duration: 2200 }),
    })
  }

  bumpVersion(file: Attachment) {
    file.version += 1
    file.uploadedBy = '当前用户'
    file.uploadedAt = timestamp()
  }

  saveAll(claim: ClaimCase) {
    const base = this.snapshot ?? claim
    this.store
      .select(selectOpSeq)
      .pipe(take(1))
      .subscribe((seq) => {
        const ops = buildClaimOps(claim.id, base, claim, seq)
        this.store.dispatch(saveAssessment({ claim: structuredClone(claim), ops }))
        this.snackBar.open(ops.length ? `已保存 ${ops.length} 项操作到待同步队列` : '没有需要同步的变更', '关闭', { duration: 1800 })
        this.syncService.syncNow()
      })
  }

  commitDraft(claimId: string) {
    const text = this.draft.trim()
    if (!text) return
    this.store
      .select(selectOpSeq)
      .pipe(take(1))
      .subscribe((seq) => {
        const op: SyncOperation = {
          opId: opIdOf(seq),
          claimId,
          type: 'draft-note',
          summary: `查勘草稿：${text.length > 24 ? `${text.slice(0, 24)}…` : text}`,
          changes: [{ field: 'surveyNote', label: '查勘草稿', base: '', value: text }],
          status: '待同步',
          attempts: 0,
          createdAt: timestamp(),
        }
        this.store.dispatch(enqueueOps({ ops: [op] }))
        this.store.dispatch(saveDraft({ draft: '' }))
        this.snackBar.open(`草稿已按 ${op.opId} 进入待同步队列`, '关闭', { duration: 1800 })
        this.syncService.syncNow()
      })
  }

  persistDraft() {
    this.store.dispatch(saveDraft({ draft: this.draft }))
  }
}
