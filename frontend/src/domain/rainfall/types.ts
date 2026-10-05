/** 雨量监测领域模型：站点归属、测报员、记录版本、勾稽与锁定都在这一层表达。 */

// 一条记录由若干「时段雨量」组成：每一行是该日内一个统计时段（如 08:00-09:00）的雨量。
export type RainfallInterval = {
  /** 时段标签，形如 08:00-09:00 */
  slot: string
  /** 该时段雨量，单位 mm；空串表示本站该时段未填 */
  amount: string
}

// 历史版本：同一站点同一时段重复报送时，被顶替下来的前一版整份存这里。
export type RainfallRevision = {
  version: number
  /** 该版报送当时的站名快照。 */
  stationNameAtSubmit: string
  observerCode: string
  observerName: string
  submittedAt: string
  intervals: RainfallInterval[]
  cumulative: string
  intervalTotal: number
  diff: number
  note: string
}

export type RainfallRecord = {
  id: number
  /** 归属雨量站的稳定编码：站点改名也不动它，历史归属靠它锁定。 */
  stationId: string
  /** 报送当时的站名快照：改名不改历史，页面上用它呈现「当时归属」。 */
  stationNameAtSubmit: string
  /** 现用站名（提交时写入，便于列表直接展示；权威值以 stations 表为准）。 */
  stationName: string
  /** 报送时段标识，同一站点同一 period 再次报送即视为重复报送。 */
  period: string
  observerCode: string
  observerName: string
  submittedAt: string
  intervals: RainfallInterval[]
  /** 测报员手填的累计雨量，单位 mm。 */
  cumulative: string
  /** 各时段雨量之和。 */
  intervalTotal: number
  /** 累计雨量与时段和之差。 */
  diff: number
  /** 差值是否在容许范围内；超范围则整条标为待核。 */
  withinTolerance: boolean
  status: '已采集' | '已核对' | '数据异常'
  /** 待核：勾稽差值超容许范围。 */
  pendingReview: boolean
  /** 已核对的记录整份锁住，谁都不能再动。 */
  locked: boolean
  abnormal: boolean
  abnormalNote: string
  version: number
  revisions: RainfallRevision[]
}

export type RainfallStation = {
  /** 稳定编码，改名不变。 */
  code: string
  name: string
  /** 本站测报员：只有这些人能填本站的时段雨量与累计雨量。 */
  observers: { code: string; name: string }[]
}

// 当前登录身份：测报员挂在某个雨量站名下；协调员不属任何站，用于核对等非填报操作。
export type SessionIdentity = {
  code: string
  name: string
  role: '雨量测报员' | '监测协调员'
  /** 测报员所属雨量站编码；协调员为 null。 */
  stationId: string | null
}

export type SubmitRainfallInput = {
  stationId: string
  period: string
  intervals: RainfallInterval[]
  cumulative: string
  note?: string
}

export type SubmitOutcome = {
  ok: boolean
  message: string
  /** 退回时说明越在哪一道关口：越权 / 锁定 / 待核拦截 / 竞态 等。 */
  reason?: 'forbidden_station' | 'locked' | 'pending_review' | 'race_lost' | 'invalid'
  record?: RainfallRecord
  /** 是否顶替了同站同时段的前一版。 */
  replaced: boolean
}
