import { createAction, createReducer, createSelector, on, props } from '@ngrx/store'
import { seedClaims } from './seed'
import { mergeClaims, opIdOf, timestamp } from './sync.engine'
import type { ClaimCase, ClaimFilters, SyncConflict, SyncOperation } from './models'

export type ClaimsState = {
  items: ClaimCase[]
  filters: ClaimFilters
  total: number
  selectedId: string
  loading: boolean
  draft: string
  toast: string
  syncQueue: SyncOperation[]
  opSeq: number
  offline: boolean
  syncing: boolean
  lastSyncAt: string
}

export type AppState = { claims: ClaimsState }

const STORAGE_KEY = 'property-claims-draft-v1'
const LEGACY_DRAFT_KEY = 'claims-assessment-draft'
const DEFAULT_DRAFT = '待补充房屋檩条第三方复测依据。'

const isActive = (op: SyncOperation) => op.status === '待同步' || op.status === '同步中' || op.status === '同步失败'

function draftOp(claimId: string, text: string, seq: number): SyncOperation {
  return {
    opId: opIdOf(seq),
    claimId,
    type: 'draft-note',
    summary: `查勘草稿：${text.length > 24 ? `${text.slice(0, 24)}…` : text}`,
    changes: [{ field: 'surveyNote', label: '查勘草稿', base: '', value: text }],
    status: '待同步',
    attempts: 0,
    createdAt: timestamp(),
  }
}

function buildInitialState(): ClaimsState {
  const defaults: ClaimsState = {
    items: structuredClone(seedClaims),
    filters: { query: '', status: '', risk: '', page: 1, pageSize: 10 },
    total: seedClaims.length,
    selectedId: seedClaims[0].id,
    loading: false,
    draft: '',
    toast: '',
    syncQueue: [],
    opSeq: 1,
    offline: false,
    syncing: false,
    lastSyncAt: '',
  }
  const legacyDraft = localStorage.getItem(LEGACY_DRAFT_KEY)
  const raw = localStorage.getItem(STORAGE_KEY)
  let state = defaults
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ClaimsState>
      state = {
        ...defaults,
        ...parsed,
        items: (parsed.items ?? defaults.items).map((claim) => ({ ...claim, surveyNotes: claim.surveyNotes ?? [] })),
        filters: { ...defaults.filters, ...parsed.filters },
        offline: false,
        syncing: false,
        toast: '',
      }
      if (Array.isArray(parsed.syncQueue)) {
        // 中断在「同步中」的操作恢复为待同步，进度不丢
        state.syncQueue = parsed.syncQueue.map((op) => (op.status === '同步中' ? { ...op, status: '待同步' as const } : op))
        state.opSeq = parsed.opSeq ?? parsed.syncQueue.length + 1
      } else {
        // 旧版本数据兼容：纯文本草稿按当前案件补成初始待同步项
        state.syncQueue = []
        state.opSeq = 1
        const texts = [parsed.draft, legacyDraft].filter((text): text is string => !!text?.trim())
        for (const text of new Set(texts)) state.syncQueue.push(draftOp(state.selectedId, text, state.opSeq++))
        state.draft = ''
      }
    } catch {
      state = defaults
    }
  } else {
    // 全新安装或仅有旧版纯文本草稿：补成当前案件的初始待同步项
    const texts = [legacyDraft?.trim() ? legacyDraft : DEFAULT_DRAFT]
    state.syncQueue = texts.map((text) => draftOp(state.selectedId, text, state.opSeq++))
  }
  localStorage.removeItem(LEGACY_DRAFT_KEY)
  return state
}

export const initialClaimsState: ClaimsState = buildInitialState()

export const loadClaimsSuccess = createAction('[Claims] Load Success', props<{ items: ClaimCase[]; total: number }>())
export const setFilters = createAction('[Claims] Set Filters', props<{ filters: Partial<ClaimFilters> }>())
export const selectClaim = createAction('[Claims] Select', props<{ id: string }>())
export const saveDraft = createAction('[Claims] Save Draft', props<{ draft: string }>())
export const updateClaim = createAction('[Claims] Update Claim', props<{ claim: ClaimCase }>())
export const setToast = createAction('[Claims] Toast', props<{ message: string }>())
export const saveAssessment = createAction('[Claims] Save Assessment', props<{ claim: ClaimCase; ops: SyncOperation[] }>())
export const enqueueOps = createAction('[Sync] Enqueue', props<{ ops: SyncOperation[] }>())
export const opSyncing = createAction('[Sync] Op Syncing', props<{ opId: string }>())
export const opSynced = createAction('[Sync] Op Synced', props<{ opId: string; claim: ClaimCase; conflicts: SyncConflict[]; duplicate: boolean }>())
export const opFailed = createAction('[Sync] Op Failed', props<{ opId: string; claimId: string; error: string }>())
export const retryOps = createAction('[Sync] Retry', props<{ opId?: string }>())
export const setOffline = createAction('[Sync] Set Offline', props<{ offline: boolean }>())

export const claimsReducer = createReducer(
  initialClaimsState,
  on(loadClaimsSuccess, (state, { items, total }) => ({
    ...state,
    // 服务端数据与本地待同步操作合并，未提交的本地进度不被覆盖
    items: items.map((remote) => {
      const local = state.items.find((claim) => claim.id === remote.id)
      if (!local) return { ...remote, surveyNotes: remote.surveyNotes ?? [] }
      const pending = state.syncQueue.filter((op) => op.claimId === remote.id && isActive(op))
      return mergeClaims(local, { ...remote, surveyNotes: remote.surveyNotes ?? [] }, pending)
    }),
    total,
    loading: false,
  })),
  on(setFilters, (state, { filters }) => ({ ...state, filters: { ...state.filters, ...filters } })),
  on(selectClaim, (state, { id }) => ({ ...state, selectedId: id })),
  on(saveDraft, (state, { draft }) => ({ ...state, draft })),
  on(updateClaim, (state, { claim }) => ({
    ...state,
    items: state.items.map((item) => (item.id === claim.id ? claim : item)),
    toast: '案件版本已更新',
  })),
  on(setToast, (state, { message }) => ({ ...state, toast: message })),
  on(saveAssessment, (state, { claim, ops }) => ({
    ...state,
    items: state.items.map((item) => (item.id === claim.id ? claim : item)),
    syncQueue: [...state.syncQueue, ...ops],
    opSeq: state.opSeq + ops.length,
    toast: ops.length ? `已保存 ${ops.length} 项操作到待同步队列` : '没有需要同步的变更',
  })),
  on(enqueueOps, (state, { ops }) => ({
    ...state,
    syncQueue: [...state.syncQueue, ...ops],
    opSeq: state.opSeq + ops.length,
    toast: `已生成 ${ops.length} 项待同步操作`,
  })),
  on(opSyncing, (state, { opId }) => ({
    ...state,
    syncing: true,
    syncQueue: state.syncQueue.map((op) => (op.opId === opId ? { ...op, status: '同步中' as const } : op)),
  })),
  on(opSynced, (state, { opId, claim, conflicts, duplicate }) => {
    const syncQueue = state.syncQueue.map((op) =>
      op.opId === opId ? { ...op, status: (conflicts.length ? '有冲突' : '已同步') as SyncOperation['status'], syncedAt: timestamp(), conflicts } : op,
    )
    const local = state.items.find((item) => item.id === claim.id)
    const pending = syncQueue.filter((op) => op.claimId === claim.id && isActive(op))
    const merged = local ? mergeClaims(local, claim, pending) : claim
    return {
      ...state,
      items: state.items.map((item) => (item.id === claim.id ? merged : item)),
      syncQueue,
      syncing: false,
      lastSyncAt: timestamp(),
      toast: duplicate ? `${opId} 服务端已记账，未重复写入` : conflicts.length ? `${opId} 已同步，${conflicts.length} 处冲突保留本地版本` : `${opId} 同步成功`,
    }
  }),
  on(opFailed, (state, { opId, claimId, error }) => {
    const syncQueue = state.syncQueue.map((op) =>
      op.opId === opId ? { ...op, status: '同步失败' as const, attempts: op.attempts + 1, lastError: error } : op,
    )
    const op = syncQueue.find((candidate) => candidate.opId === opId)
    const items = state.items.map((claim) =>
      claim.id !== claimId || !op
        ? claim
        : {
            ...claim,
            audit: [
              ...claim.audit,
              {
                id: `A-${opId}-F${op.attempts}`,
                at: timestamp(),
                operator: '系统',
                action: '同步失败',
                detail: `${opId} 提交失败：${error}。本地进度已保留，可重试。`,
              },
            ],
          },
    )
    return { ...state, syncQueue, items, syncing: false, toast: '同步失败，进度已保留在待办队列' }
  }),
  on(retryOps, (state, { opId }) => {
    const targets = state.syncQueue.filter((op) => op.status === '同步失败' && (!opId || op.opId === opId))
    if (!targets.length) return state
    const syncQueue = state.syncQueue.map((op) => (targets.includes(op) ? { ...op, status: '待同步' as const, lastError: undefined } : op))
    const items = state.items.map((claim) => {
      const ops = targets.filter((op) => op.claimId === claim.id)
      if (!ops.length) return claim
      return {
        ...claim,
        audit: [
          ...claim.audit,
          ...ops.map((op) => ({
            id: `A-${op.opId}-R${op.attempts}`,
            at: timestamp(),
            operator: '当前用户',
            action: '同步重试',
            detail: `第 ${op.attempts + 1} 次提交 ${op.opId}（${op.summary}）。`,
          })),
        ],
      }
    })
    return { ...state, syncQueue, items, toast: '已重新加入同步队列' }
  }),
  on(setOffline, (state, { offline }) => ({ ...state, offline, toast: offline ? '已切换为离线模式，操作将进入待同步队列' : '已恢复在线，可继续同步' })),
)

export const selectClaimsState = (state: AppState) => state.claims
export const selectAllClaims = createSelector(selectClaimsState, (state) => state.items)
export const selectFilters = createSelector(selectClaimsState, (state) => state.filters)
export const selectSelectedClaim = createSelector(selectClaimsState, (state) => state.items.find((item) => item.id === state.selectedId) ?? state.items[0])
export const selectFilteredClaims = createSelector(selectAllClaims, selectFilters, (claims, filters) =>
  claims.filter(
    (item) =>
      (!filters.query || `${item.id}${item.insured}${item.policyNo}`.toLowerCase().includes(filters.query.toLowerCase())) &&
      (!filters.status || item.status === filters.status) &&
      (!filters.risk || item.riskLevel === filters.risk),
  ),
)
export const selectSyncQueue = createSelector(selectClaimsState, (state) => state.syncQueue)
export const selectOpSeq = createSelector(selectClaimsState, (state) => state.opSeq)
export const selectOffline = createSelector(selectClaimsState, (state) => state.offline)
export const selectLastSyncAt = createSelector(selectClaimsState, (state) => state.lastSyncAt)
export const selectPendingCount = createSelector(selectSyncQueue, (queue) => queue.filter(isActive).length)
export const selectFailedCount = createSelector(selectSyncQueue, (queue) => queue.filter((op) => op.status === '同步失败').length)
export const selectConflicts = createSelector(selectSyncQueue, (queue) => queue.flatMap((op) => op.conflicts ?? []))
