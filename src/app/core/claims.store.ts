import { createAction, createReducer, createSelector, on, props } from '@ngrx/store'
import { seedClaims } from './seed'
import type {
  ClaimCase,
  ClaimFilters,
  OpKind,
  OpPayload,
  PendingSyncItem,
  SyncConflict,
  SyncLogEntry,
} from './models'

export type ClaimsState = {
  items: ClaimCase[]
  filters: ClaimFilters
  total: number
  selectedId: string
  loading: boolean
  draft: string
  toast: string
  syncQueue: PendingSyncItem[]
  conflicts: SyncConflict[]
  syncLog: SyncLogEntry[]
  legacyHydrated: boolean
}

export type AppState = { claims: ClaimsState }

let seq = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`

function now(): string {
  return new Date().toLocaleString('zh-CN')
}

function buildBaseState(): ClaimsState {
  return {
    items: structuredClone(seedClaims),
    filters: { query: '', status: '', risk: '', page: 1, pageSize: 10 },
    total: seedClaims.length,
    selectedId: seedClaims[0].id,
    loading: false,
    draft: '待补充房屋檩条第三方复测依据。',
    toast: '',
    syncQueue: [],
    conflicts: [],
    syncLog: [],
    legacyHydrated: false,
  }
}

/** 旧数据兼容：把纯文本草稿按当前案件补成初始待同步项。 */
function hydrateLegacyDrafts(state: ClaimsState): ClaimsState {
  if (state.legacyHydrated) return state
  const queue = [...state.syncQueue]
  const log = [...state.syncLog]
  const ts = Date.now()
  const at = now()

  const pushTextOp = (opNo: string, text: string, detail: string) => {
    if (queue.some((item) => item.opNo === opNo)) return
    queue.push({
      opNo,
      claimId: state.selectedId,
      kind: 'text',
      status: 'pending',
      baseVersion: 1,
      payload: { text },
      conflicts: [],
      retries: 0,
      error: '',
      legacy: true,
      createdAt: at,
      updatedAt: at,
    })
    log.push({ id: nextId('L'), opNo, claimId: state.selectedId, kind: 'text', event: 'enqueued', at, detail, ts })
  }

  if (state.draft && state.draft.trim()) {
    pushTextOp(`OP-LEGACY-${state.selectedId}`, state.draft, '旧版纯文本草稿已补入待同步队列')
  }
  const assessmentDraft = localStorage.getItem('claims-assessment-draft')
  if (assessmentDraft && assessmentDraft.trim()) {
    pushTextOp(`OP-LEGACY-ASSESSMENT-${state.selectedId}`, assessmentDraft, '旧版查勘草稿已补入待同步队列')
  }

  return { ...state, syncQueue: queue, syncLog: log, legacyHydrated: true }
}

function buildInitialState(): ClaimsState {
  const base = buildBaseState()
  const persistedRaw = localStorage.getItem('property-claims-draft-v1')
  if (persistedRaw) {
    try {
      const persisted = JSON.parse(persistedRaw) as Partial<ClaimsState>
      const merged: ClaimsState = {
        ...base,
        ...persisted,
        filters: { ...base.filters, ...(persisted.filters ?? {}) },
        syncQueue: persisted.syncQueue ?? [],
        conflicts: persisted.conflicts ?? [],
        syncLog: persisted.syncLog ?? [],
        legacyHydrated: persisted.legacyHydrated ?? false,
      }
      return hydrateLegacyDrafts(merged)
    } catch {
      // 解析失败则回退到初始状态
    }
  }
  return hydrateLegacyDrafts(base)
}

export const initialClaimsState: ClaimsState = buildInitialState()

export const loadClaimsSuccess = createAction('[Claims] Load Success', props<{ items: ClaimCase[]; total: number }>())
export const setFilters = createAction('[Claims] Set Filters', props<{ filters: Partial<ClaimFilters> }>())
export const selectClaim = createAction('[Claims] Select', props<{ id: string }>())
export const saveDraft = createAction('[Claims] Save Draft', props<{ draft: string }>())
export const updateClaim = createAction('[Claims] Update Claim', props<{ claim: ClaimCase }>())
export const setToast = createAction('[Claims] Toast', props<{ message: string }>())

// 待同步队列
export const enqueueOp = createAction(
  '[Sync] Enqueue Op',
  props<{ opNo: string; claimId: string; kind: OpKind; payload: OpPayload; baseVersion: number; legacy?: boolean }>(),
)
export const syncOpStarted = createAction('[Sync] Sync Started', props<{ opNo: string }>())
export const syncOpSucceeded = createAction(
  '[Sync] Sync Succeeded',
  props<{ opNo: string; claim: ClaimCase; conflicts: SyncConflict[]; applied: boolean; duplicated: boolean }>(),
)
export const syncOpFailed = createAction('[Sync] Sync Failed', props<{ opNo: string; error: string }>())
export const retryOp = createAction('[Sync] Retry Op', props<{ opNo: string }>())
export const clearSyncedOps = createAction('[Sync] Clear Synced Ops')
export const dismissConflict = createAction('[Sync] Dismiss Conflict', props<{ id: string }>())

export const claimsReducer = createReducer(
  initialClaimsState,
  on(loadClaimsSuccess, (state, { items, total }) => ({ ...state, items, total, loading: false })),
  on(setFilters, (state, { filters }) => ({ ...state, filters: { ...state.filters, ...filters } })),
  on(selectClaim, (state, { id }) => ({ ...state, selectedId: id })),
  on(saveDraft, (state, { draft }) => ({ ...state, draft, toast: '草稿已恢复并保存到本地' })),
  on(updateClaim, (state, { claim }) => ({
    ...state,
    items: state.items.map((item) => (item.id === claim.id ? claim : item)),
    toast: '案件版本已更新',
  })),
  on(setToast, (state, { message }) => ({ ...state, toast: message })),

  on(enqueueOp, (state, { opNo, claimId, kind, payload, baseVersion, legacy }) => {
    const at = now()
    const item: PendingSyncItem = {
      opNo,
      claimId,
      kind,
      status: 'pending',
      baseVersion,
      payload,
      conflicts: [],
      retries: 0,
      error: '',
      legacy: legacy ?? false,
      createdAt: at,
      updatedAt: at,
    }
    const log: SyncLogEntry = {
      id: nextId('L'),
      opNo,
      claimId,
      kind,
      event: 'enqueued',
      at,
      ts: Date.now(),
      detail: legacy ? '旧版纯文本草稿已补入待同步队列' : `操作号 ${opNo} 已提交到待办队列`,
    }
    return { ...state, syncQueue: [item, ...state.syncQueue], syncLog: [log, ...state.syncLog] }
  }),

  on(syncOpStarted, (state, { opNo }) => {
    const at = now()
    const item = state.syncQueue.find((entry) => entry.opNo === opNo)
    if (!item) return state
    const log: SyncLogEntry = {
      id: nextId('L'),
      opNo,
      claimId: item.claimId,
      kind: item.kind,
      event: 'sync_started',
      at,
      ts: Date.now(),
      detail: `开始同步（第 ${item.retries + 1} 次尝试）`,
    }
    return {
      ...state,
      syncQueue: state.syncQueue.map((entry) => (entry.opNo === opNo ? { ...entry, status: 'syncing', updatedAt: at } : entry)),
      syncLog: [log, ...state.syncLog],
    }
  }),

  on(syncOpSucceeded, (state, { opNo, claim, conflicts, applied, duplicated }) => {
    const at = now()
    const item = state.syncQueue.find((entry) => entry.opNo === opNo)
    if (!item) return state
    const updated: PendingSyncItem = {
      ...item,
      status: 'synced',
      conflicts: dedupeConflicts([...item.conflicts, ...conflicts]),
      error: duplicated ? item.error : '',
      updatedAt: at,
      syncedAt: at,
    }
    const log: SyncLogEntry = {
      id: nextId('L'),
      opNo,
      claimId: claim.id,
      kind: item.kind,
      event: duplicated ? 'duplicate_skipped' : 'sync_succeeded',
      at,
      ts: Date.now(),
      detail: duplicated ? '该操作号已生效，跳过重复记账' : `同步成功，已写入案件 ${claim.id}`,
    }
    return {
      ...state,
      items: state.items.map((entry) => (entry.id === claim.id ? claim : entry)),
      syncQueue: state.syncQueue.map((entry) => (entry.opNo === opNo ? updated : entry)),
      conflicts: dedupeConflicts([...conflicts, ...state.conflicts]),
      syncLog: [log, ...state.syncLog],
      toast: duplicated ? '操作已生效，未重复记账' : '草稿同步成功',
    }
  }),

  on(syncOpFailed, (state, { opNo, error }) => {
    const at = now()
    const item = state.syncQueue.find((entry) => entry.opNo === opNo)
    if (!item) return state
    const updated: PendingSyncItem = {
      ...item,
      status: 'failed',
      retries: item.retries + 1,
      error,
      updatedAt: at,
    }
    const log: SyncLogEntry = {
      id: nextId('L'),
      opNo,
      claimId: item.claimId,
      kind: item.kind,
      event: 'sync_failed',
      at,
      ts: Date.now(),
      detail: `同步失败（第 ${item.retries + 1} 次）：${error}`,
    }
    return {
      ...state,
      syncQueue: state.syncQueue.map((entry) => (entry.opNo === opNo ? updated : entry)),
      syncLog: [log, ...state.syncLog],
      toast: '同步失败，进度已保留，可重试',
    }
  }),

  on(retryOp, (state, { opNo }) => {
    const at = now()
    return {
      ...state,
      syncQueue: state.syncQueue.map((entry) =>
        entry.opNo === opNo ? { ...entry, status: 'pending', error: '', updatedAt: at } : entry,
      ),
    }
  }),

  on(clearSyncedOps, (state) => ({
    ...state,
    syncQueue: state.syncQueue.filter((entry) => entry.status !== 'synced'),
  })),

  on(dismissConflict, (state, { id }) => ({
    ...state,
    conflicts: state.conflicts.filter((entry) => entry.id !== id),
  })),
)

function dedupeConflicts(conflicts: SyncConflict[]): SyncConflict[] {
  const seen = new Set<string>()
  return conflicts.filter((conflict) => {
    if (seen.has(conflict.id)) return false
    seen.add(conflict.id)
    return true
  })
}

export const selectClaimsState = (state: AppState) => state.claims
export const selectAllClaims = createSelector(selectClaimsState, (state) => state.items)
export const selectFilters = createSelector(selectClaimsState, (state) => state.filters)
export const selectSelectedClaim = createSelector(
  selectClaimsState,
  (state) => state.items.find((item) => item.id === state.selectedId) ?? state.items[0],
)
export const selectFilteredClaims = createSelector(selectAllClaims, selectFilters, (claims, filters) =>
  claims.filter(
    (item) =>
      (!filters.query || `${item.id}${item.insured}${item.policyNo}`.toLowerCase().includes(filters.query.toLowerCase())) &&
      (!filters.status || item.status === filters.status) &&
      (!filters.risk || item.riskLevel === filters.risk),
  ),
)

// 待同步队列选择器
export const selectSyncQueue = createSelector(selectClaimsState, (state) => state.syncQueue)
export const selectPendingOps = createSelector(selectSyncQueue, (queue) => queue.filter((item) => item.status === 'pending'))
export const selectFailedOps = createSelector(selectSyncQueue, (queue) => queue.filter((item) => item.status === 'failed'))
export const selectSyncedOps = createSelector(selectSyncQueue, (queue) => queue.filter((item) => item.status === 'synced'))
export const selectSyncingOps = createSelector(selectSyncQueue, (queue) => queue.filter((item) => item.status === 'syncing'))
export const selectConflicts = createSelector(selectClaimsState, (state) => state.conflicts)
export const selectSyncLog = createSelector(selectClaimsState, (state) => state.syncLog)
export const selectPendingCount = createSelector(selectPendingOps, (items) => items.length)
export const selectFailedCount = createSelector(selectFailedOps, (items) => items.length)
export const selectHasPendingSync = createSelector(
  selectSyncQueue,
  (queue) => queue.some((item) => item.status === 'pending' || item.status === 'failed' || item.status === 'syncing'),
)
