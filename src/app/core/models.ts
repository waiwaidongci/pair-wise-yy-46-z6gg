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
  surveyNotes: string[]
}

export type SyncOperationType = 'loss-item' | 'attachment' | 'draft-note'

export type SyncOperationStatus = '待同步' | '同步中' | '同步失败' | '已同步' | '有冲突'

export type SyncChange = {
  field: string
  label: string
  base: unknown
  value: unknown
}

export type SyncConflict = {
  opId: string
  itemId: string
  target: string
  field: string
  localValue: string
  remoteValue: string
  resolution: string
}

export type SyncOperation = {
  opId: string
  claimId: string
  type: SyncOperationType
  itemId?: string
  attachmentId?: string
  summary: string
  changes: SyncChange[]
  status: SyncOperationStatus
  attempts: number
  createdAt: string
  syncedAt?: string
  lastError?: string
  conflicts?: SyncConflict[]
}

export type SyncResult = {
  duplicate: boolean
  conflicts: SyncConflict[]
  claim: ClaimCase
}

export type ClaimFilters = {
  query: string
  status: string
  risk: string
  page: number
  pageSize: number
}

export type PagedClaims = {
  items: ClaimCase[]
  total: number
  page: number
  pageSize: number
}
