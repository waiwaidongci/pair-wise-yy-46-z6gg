export type ClaimStatus = '查勘中' | '待复核' | '退回补件' | '审批中' | '待支付' | '已结案'

export type Attachment = {
  id: string
  name: string
  category: '现场照片' | '修复报告' | '专家意见' | '保单摘录'
  version: number
  uploadedBy: string
  uploadedAt: string
}

export type LossItem = {
  id: string
  category: string
  description: string
  damage: string
  repairQuotes: Array<{ version: number; amount: number; reason: string; operator: string; createdAt: string }>
  salvage: number
  liability: number
  disputed: boolean
  attachments: Attachment[]
  expertNotes: string[]
}

export type ApprovalStep = {
  role: string
  threshold: number
  status: '待处理' | '已通过' | '已退回'
  operator?: string
  comment?: string
  completedAt?: string
}

export type ClaimCase = {
  id: string
  policyNo: string
  insured: string
  lossAddress: string
  accidentDate: string
  reportedAt: string
  adjuster: string
  status: ClaimStatus
  riskLevel: '低' | '中' | '高'
  reserve: number
  paid: number
  deductible: number
  lossItems: LossItem[]
  approvals: ApprovalStep[]
  audit: Array<{ id: string; at: string; operator: string; action: string; detail: string }>
}

export type ClaimFilters = {
  query: string
  status: string
  risk: string
  page: number
  pageSize: number
}

// ---- 离线同步待办队列 ----

export type SyncItemStatus = 'pending' | 'syncing' | 'failed' | 'synced'

export type OpKind = 'lossItem' | 'attachment' | 'quote' | 'text'

export type FieldChange = {
  itemId: string
  field: string
  baseValue: unknown
  localValue: unknown
}

export type OpPayload = {
  text?: string
  changes?: FieldChange[]
  attachments?: Array<{ itemId: string; attachment: Attachment; baseAttachmentVersion: number }>
  quote?: { itemId: string; amount: number; reason: string }
}

export type PendingSyncItem = {
  opNo: string
  claimId: string
  kind: OpKind
  status: SyncItemStatus
  baseVersion: number
  payload: OpPayload
  conflicts: SyncConflict[]
  retries: number
  error: string
  legacy: boolean
  createdAt: string
  updatedAt: string
  syncedAt?: string
}

export type SyncConflict = {
  id: string
  opNo: string
  claimId: string
  itemId?: string
  attachmentId?: string
  field: string
  baseValue: unknown
  localValue: unknown
  remoteValue: unknown
  detectedAt: string
}

export type SyncLogEntry = {
  id: string
  opNo: string
  claimId: string
  kind: OpKind
  event: 'enqueued' | 'sync_started' | 'sync_failed' | 'sync_succeeded' | 'conflict_detected' | 'duplicate_skipped'
  at: string
  detail: string
  ts: number
}

export type SyncResult = {
  claim: ClaimCase
  conflicts: SyncConflict[]
  applied: boolean
  duplicated: boolean
}

export type PagedClaims = {
  items: ClaimCase[]
  total: number
  page: number
  pageSize: number
}
