import { Component, OnDestroy, inject } from '@angular/core'
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
import { MatTooltipModule } from '@angular/material/tooltip'
import { Store } from '@ngrx/store'
import type { Observable, Subscription } from 'rxjs'
import { ClaimsService } from '../core/claims.service'
import { OfflineSyncService } from '../core/offline-sync.service'
import type { Attachment, ClaimCase, FieldChange } from '../core/models'
import { selectSelectedClaim, selectSyncQueue, type AppState } from '../core/claims.store'
import { isEqual } from '../core/sync.engine'
import { StatusChipComponent } from '../shared/status-chip.component'

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
    MatTooltipModule,
    StatusChipComponent,
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
          <span class="sync-status" *ngIf="pendingCount > 0">
            <mat-icon [class.spin]="syncing">sync</mat-icon>
            {{ pendingCount }} 项待同步
            <button mat-button color="warn" *ngIf="failedCount > 0" (click)="retryAll()">重试 {{ failedCount }} 项失败</button>
          </span>
          <button mat-stroked-button matTooltip="模拟另一位查勘员在远端修改同一字段，用于演示冲突检测" (click)="simulateRemoteChange()">
            <mat-icon>person_off</mat-icon> 模拟他人修改
          </button>
          <button mat-stroked-button (click)="fileInput.click()"><mat-icon>upload_file</mat-icon> 上传查勘材料</button>
          <input #fileInput type="file" hidden (change)="addAttachment(firstItem(), $event)" />
          <input #sharedFileInput type="file" hidden (change)="addAttachment(attachmentTarget, $event)" />
          <button mat-flat-button color="primary" (click)="saveAll()"><mat-icon>cloud_upload</mat-icon> 保存本次查勘</button>
        </div>
      </div>

      <div class="summary-grid">
        <mat-card appearance="outlined"><span>损失科目</span><strong>{{ draftClaim?.lossItems?.length ?? 0 }}</strong><small>{{ disputedCount() }} 项存在争议</small></mat-card>
        <mat-card appearance="outlined"><span>修复报价合计</span><strong>{{ quoteTotal() | currency:'CNY':'symbol':'1.0-0' }}</strong><small>取各科目最新报价</small></mat-card>
        <mat-card appearance="outlined"><span>残值合计</span><strong>{{ salvageTotal() | currency:'CNY':'symbol':'1.0-0' }}</strong><small>待扣减</small></mat-card>
        <mat-card appearance="outlined"><span>建议准备金</span><strong>{{ suggestedReserve() | currency:'CNY':'symbol':'1.0-0' }}</strong><small>责任比例后计入免赔</small></mat-card>
      </div>

      <div class="assessment-grid" *ngIf="draftClaim as draft">
        <section class="panel">
          <div class="panel-head"><h3>损失科目与报价版本</h3><span class="muted">每次调整必须保留理由 · 保存后按操作号同步</span></div>
          <mat-accordion multi>
            <mat-expansion-panel *ngFor="let item of draft.lossItems; let itemIndex = index" [expanded]="itemIndex === activeIndex" (opened)="activeIndex = itemIndex">
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
                    <button mat-icon-button matTooltip="上传新版本" (click)="bumpAttachment(item, file)"><mat-icon>upgrade</mat-icon></button>
                  </span>
                  <button mat-stroked-button (click)="attachmentTarget = item; sharedFileInput.click()">添加附件</button>
                </div>
                <button mat-stroked-button color="primary" (click)="startQuote(item)"><mat-icon>edit_road</mat-icon> 调整最新报价</button>
                <div class="quote-form" *ngIf="quotingItemId === item.id">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>新报价</mat-label><input matInput type="number" [(ngModel)]="quoteAmount" /></mat-form-field>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="reason-field"><mat-label>调整理由（必填）</mat-label><input matInput [(ngModel)]="quoteReason" /></mat-form-field>
                  <button mat-flat-button color="primary" [disabled]="!quoteReason.trim() || !quoteAmount" (click)="submitQuote(draft.id, item.id)">生成新版本</button>
                </div>
              </div>
            </mat-expansion-panel>
          </mat-accordion>
        </section>

        <aside>
          <section class="panel">
            <div class="panel-head"><h3>专家记录</h3><span class="muted">不可覆盖</span></div>
            <div class="expert-list">
              <div *ngFor="let item of draft.lossItems">
                <strong>{{ item.category }}</strong>
                <p *ngFor="let note of item.expertNotes">{{ note }}</p>
                <small *ngIf="item.expertNotes.length === 0">暂无专家补充说明</small>
              </div>
            </div>
          </section>
          <section class="panel draft-panel">
            <div class="panel-head"><h3>查勘草稿</h3><mat-icon>cloud_done</mat-icon></div>
            <textarea rows="7" [(ngModel)]="draftText" (blur)="saveText(draft.id)"></textarea>
            <small>离开页面后仍可恢复到本地；保存后按操作号同步到待办队列。</small>
          </section>
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
    .attachment-row > span { display: inline-flex; align-items: center; gap: 3px; padding: 5px 7px; color: #4f626d; background: #f0f4f5; border-radius: 5px; font-size: 11px; }
    .attachment-row mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .quote-form { padding: 12px; background: #f4f7f8; border-left: 3px solid #277b89; }
    .reason-field { flex: 1; min-width: 220px; }
    aside { display: grid; gap: 14px; }
    .expert-list { padding: 8px 16px 16px; }
    .expert-list div { padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .expert-list p { margin: 6px 0 0; color: #65737c; font-size: 11px; line-height: 1.5; }
    .expert-list small { color: #8b969d; font-size: 11px; }
    .draft-panel { padding-bottom: 14px; }
    .draft-panel textarea { width: calc(100% - 28px); margin: 14px; }
    .draft-panel small { display: block; margin: -6px 14px 0; color: #7d8991; }
    .sync-status { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; color: #1d6670; background: #eaf4f5; border-radius: 6px; font-size: 12px; }
    .sync-status mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .spin { animation: spin 1.2s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 1050px) { .assessment-grid { grid-template-columns: 1fr; } .summary-grid { grid-template-columns: repeat(2,1fr); } }
    @media (max-width: 620px) { .summary-grid { grid-template-columns: 1fr 1fr; } }
  `],
})
export class AssessmentPageComponent implements OnDestroy {
  private readonly store = inject(Store<AppState>)
  private readonly service = inject(ClaimsService)
  private readonly offlineSync = inject(OfflineSyncService)
  private readonly snackBar = inject(MatSnackBar)

  claim$: Observable<ClaimCase>
  draftClaim: ClaimCase | null = null
  draftText = ''
  quoteColumns = ['version', 'amount', 'reason']
  activeIndex = 0
  quotingItemId = ''
  quoteAmount = 0
  quoteReason = ''
  pendingCount = 0
  failedCount = 0
  syncing = false
  attachmentTarget: { id: string; attachments: Attachment[] } | undefined

  private baseClaim: ClaimCase | null = null
  private lastEnqueuedText = ''
  private readonly subs: Subscription[] = []

  constructor() {
    this.claim$ = this.store.select(selectSelectedClaim)
    this.subs.push(
      this.claim$.subscribe((claim) => {
        const idChanged = !this.baseClaim || this.baseClaim.id !== claim.id
        const refChanged = this.baseClaim !== claim
        this.baseClaim = claim
        if (idChanged || refChanged) {
          this.draftClaim = structuredClone(claim)
        }
      }),
    )
    this.subs.push(
      this.store.select((state) => state.claims.draft).subscribe((draft) => {
        if (this.draftText === '' || this.draftText === this.lastEnqueuedText) {
          this.draftText = draft
          this.lastEnqueuedText = draft
        }
      }),
    )
    this.subs.push(
      this.store.select(selectSyncQueue).subscribe((queue) => {
        const claimId = this.baseClaim?.id
        const mine = queue.filter((item) => item.claimId === claimId)
        this.pendingCount = mine.filter((item) => item.status === 'pending' || item.status === 'failed' || item.status === 'syncing').length
        this.failedCount = mine.filter((item) => item.status === 'failed').length
        this.syncing = mine.some((item) => item.status === 'syncing')
      }),
    )
  }

  ngOnDestroy(): void {
    this.subs.forEach((sub) => sub.unsubscribe())
  }

  firstItem() {
    return this.draftClaim?.lossItems[0]
  }

  latestQuote(item: { repairQuotes: Array<{ amount: number }> }) {
    return item.repairQuotes.at(-1)?.amount ?? 0
  }

  quoteTotal() {
    if (!this.draftClaim) return 0
    return this.draftClaim.lossItems.reduce((sum, item) => sum + this.latestQuote(item), 0)
  }

  salvageTotal() {
    if (!this.draftClaim) return 0
    return this.draftClaim.lossItems.reduce((sum, item) => sum + item.salvage, 0)
  }

  suggestedReserve() {
    if (!this.draftClaim) return 0
    const net = this.draftClaim.lossItems.reduce(
      (sum, item) => sum + (this.latestQuote(item) - item.salvage) * item.liability,
      0,
    )
    return Math.max(0, net - this.draftClaim.deductible)
  }

  disputedCount() {
    return this.draftClaim?.lossItems.filter((item) => item.disputed).length ?? 0
  }

  startQuote(item: { id: string; repairQuotes: Array<{ amount: number }> }) {
    this.quotingItemId = item.id
    this.quoteAmount = this.latestQuote(item)
    this.quoteReason = ''
  }

  submitQuote(claimId: string, itemId: string) {
    if (!this.quoteReason.trim()) return
    this.offlineSync.enqueue(
      claimId,
      'quote',
      { quote: { itemId, amount: Number(this.quoteAmount), reason: this.quoteReason } },
      1,
    )
    this.snackBar.open('报价已提交到待同步队列', '关闭', { duration: 1800 })
    this.quotingItemId = ''
  }

  bumpAttachment(item: { id: string; attachments: Attachment[] }, file: Attachment) {
    const idx = item.attachments.findIndex((entry) => entry.id === file.id)
    if (idx >= 0) {
      item.attachments[idx] = {
        ...file,
        version: file.version + 1,
        uploadedBy: '当前用户',
        uploadedAt: new Date().toLocaleString('zh-CN'),
      }
    }
  }

  addAttachment(item: { id: string; attachments: Attachment[] } | undefined, event: Event) {
    if (!item) return
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const newAtt: Attachment = {
      id: `AT-${Date.now()}`,
      name: file.name,
      category: '现场照片',
      version: 1,
      uploadedBy: '当前用户',
      uploadedAt: new Date().toLocaleString('zh-CN'),
    }
    item.attachments.push(newAtt)
    input.value = ''
  }

  saveText(claimId: string) {
    if (this.draftText.trim() && this.draftText !== this.lastEnqueuedText) {
      this.offlineSync.enqueue(claimId, 'text', { text: this.draftText }, 1)
      this.lastEnqueuedText = this.draftText
    }
  }

  saveAll() {
    if (!this.draftClaim || !this.baseClaim) return
    const claimId = this.baseClaim.id

    // 科目字段变更：逐字段 diff，按操作号提交
    const changes: FieldChange[] = []
    for (const draftItem of this.draftClaim.lossItems) {
      const baseItem = this.baseClaim.lossItems.find((entry) => entry.id === draftItem.id)
      if (!baseItem) continue
      for (const field of ['damage', 'salvage', 'liability', 'description', 'disputed'] as const) {
        const baseValue = (baseItem as unknown as Record<string, unknown>)[field]
        const localValue = (draftItem as unknown as Record<string, unknown>)[field]
        if (!isEqual(localValue, baseValue)) {
          changes.push({ itemId: draftItem.id, field, baseValue, localValue })
        }
      }
    }
    if (changes.length > 0) {
      this.offlineSync.enqueue(claimId, 'lossItem', { changes }, 1)
    }

    // 附件版本变更：按附件分别合并
    const attachmentOps: Array<{ itemId: string; attachment: Attachment; baseAttachmentVersion: number }> = []
    for (const draftItem of this.draftClaim.lossItems) {
      const baseItem = this.baseClaim.lossItems.find((entry) => entry.id === draftItem.id)
      if (!baseItem) continue
      for (const draftAtt of draftItem.attachments) {
        const baseAtt = baseItem.attachments.find((entry) => entry.id === draftAtt.id)
        if (!baseAtt) {
          attachmentOps.push({ itemId: draftItem.id, attachment: draftAtt, baseAttachmentVersion: 0 })
        } else if (draftAtt.version !== baseAtt.version) {
          attachmentOps.push({ itemId: draftItem.id, attachment: draftAtt, baseAttachmentVersion: baseAtt.version })
        }
      }
    }
    if (attachmentOps.length > 0) {
      this.offlineSync.enqueue(claimId, 'attachment', { attachments: attachmentOps }, 1)
    }

    // 文本草稿
    if (this.draftText.trim() && this.draftText !== this.lastEnqueuedText) {
      this.offlineSync.enqueue(claimId, 'text', { text: this.draftText }, 1)
      this.lastEnqueuedText = this.draftText
    }

    this.snackBar.open('已提交到待同步队列，首次同步可能失败，可重试', '关闭', { duration: 2200 })
  }

  retryAll() {
    this.offlineSync.syncAll()
    this.snackBar.open('已重新提交全部待同步项', '关闭', { duration: 1600 })
  }

  simulateRemoteChange() {
    if (!this.baseClaim || !this.draftClaim) return
    const target = this.draftClaim.lossItems[0]
    if (!target) return
    const remoteValue = `${target.damage}（远端他人已修改）`
    this.service.simulateRemote(this.baseClaim.id, target.id, 'damage', remoteValue).subscribe(() => {
      this.snackBar.open('已模拟远端他人修改同一字段，下次同步将检测冲突', '关闭', { duration: 2200 })
    })
  }
}
