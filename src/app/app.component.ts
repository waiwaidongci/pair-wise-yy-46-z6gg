import { Component, OnInit } from '@angular/core'
import { CommonModule } from '@angular/common'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { MatSidenavModule } from '@angular/material/sidenav'
import { MatToolbarModule } from '@angular/material/toolbar'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'
import { MatListModule } from '@angular/material/list'
import { MatChipsModule } from '@angular/material/chips'
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar'
import { Store } from '@ngrx/store'
import { ClaimsService } from './core/claims.service'
import { SyncService } from './core/sync.service'
import { loadClaimsSuccess, selectClaimsState, selectLastSyncAt, selectPendingCount, type AppState } from './core/claims.store'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatSidenavModule,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatListModule,
    MatChipsModule,
    MatSnackBarModule,
  ],
  template: `
    <mat-sidenav-container class="shell">
      <mat-sidenav mode="side" opened class="sidebar" [class.mobile-hidden]="false">
        <div class="brand">
          <div class="brand-mark">财险</div>
          <div>
            <strong>查勘定损中心</strong>
            <small>华东财产险 · 专业工作台</small>
          </div>
        </div>
        <mat-nav-list>
          <a mat-list-item routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
            <mat-icon matListItemIcon>dashboard</mat-icon>
            <span matListItemTitle>案件总览</span>
          </a>
          <a mat-list-item routerLink="/assessment" routerLinkActive="active">
            <mat-icon matListItemIcon>fact_check</mat-icon>
            <span matListItemTitle>查勘定损</span>
          </a>
          <a mat-list-item routerLink="/review" routerLinkActive="active">
            <mat-icon matListItemIcon>approval</mat-icon>
            <span matListItemTitle>准备金审批</span>
          </a>
          <a mat-list-item routerLink="/audit" routerLinkActive="active">
            <mat-icon matListItemIcon>history</mat-icon>
            <span matListItemTitle>审计与附件</span>
          </a>
        </mat-nav-list>
        <div class="side-note">
          <div class="sync" [class.pending]="(pendingCount$ | async)">
            <i></i> {{ (pendingCount$ | async) ? '待同步 ' + (pendingCount$ | async) + ' 项操作' : '全部操作已同步' }}
          </div>
          <small>最后同步 {{ (lastSyncAt$ | async) || '—' }} · 规则版本 2026.09</small>
        </div>
      </mat-sidenav>
      <mat-sidenav-content>
        <mat-toolbar class="mobile-bar">
          <button mat-icon-button (click)="mobileOpen = !mobileOpen"><mat-icon>menu</mat-icon></button>
          <strong>查勘定损中心</strong>
        </mat-toolbar>
        <router-outlet />
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    .shell { min-height: 100vh; background: #edf1f3; }
    .sidebar { width: 244px; border: 0; color: #e8f0f3; background: #143443; }
    .brand { display: flex; align-items: center; gap: 11px; padding: 20px 16px; border-bottom: 1px solid rgba(255,255,255,.1); }
    .brand-mark { display: grid; width: 42px; height: 42px; place-items: center; border: 1px solid #67a8b5; border-radius: 9px; color: #a6d8df; font-size: 13px; font-weight: 800; }
    .brand strong, .brand small { display: block; }
    .brand strong { font-size: 14px; }
    .brand small { margin-top: 4px; color: #8da5b1; font-size: 10px; }
    mat-nav-list { padding: 16px 10px; }
    mat-nav-list a { margin-bottom: 4px; border-radius: 7px; color: #b9cbd4; }
    mat-nav-list a.active { color: #fff; background: #235062; box-shadow: inset 3px 0 #66b6c2; }
    .side-note { position: absolute; right: 12px; bottom: 14px; left: 12px; padding: 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: rgba(255,255,255,.04); }
    .sync { font-size: 11px; font-weight: 700; }
    .sync i { display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: #56b989; }
    .sync.pending i { background: #e0a23c; }
    .side-note small { display: block; margin-top: 6px; color: #92a8b3; font-size: 9px; }
    .mobile-bar { display: none; }
    mat-sidenav-content { min-width: 0; }
    @media (max-width: 820px) {
      .sidebar { display: none; }
      .mobile-bar { display: flex; gap: 8px; background: #143443; color: white; }
    }
  `],
})
export class AppComponent implements OnInit {
  mobileOpen = false
  readonly pendingCount$
  readonly lastSyncAt$
  private lastToast = ''

  constructor(
    private readonly service: ClaimsService,
    private readonly syncService: SyncService,
    private readonly store: Store<AppState>,
    private readonly snackBar: MatSnackBar,
  ) {
    this.pendingCount$ = this.store.select(selectPendingCount)
    this.lastSyncAt$ = this.store.select(selectLastSyncAt)
  }

  ngOnInit() {
    this.service.list({ query: '', status: '', risk: '', page: 1, pageSize: 10 }).subscribe({
      next: (result) => this.store.dispatch(loadClaimsSuccess({ items: result.items, total: result.total })),
      error: () => undefined, // 离线时沿用本地持久化数据
    })
    // 启动时续传待同步队列，失败进度保留可重试
    this.syncService.syncNow()
    this.store.select(selectClaimsState).subscribe((state) => {
      localStorage.setItem('property-claims-draft-v1', JSON.stringify(state))
      if (state.toast && state.toast !== this.lastToast) this.snackBar.open(state.toast, '关闭', { duration: 1800 })
      this.lastToast = state.toast
    })
  }
}
