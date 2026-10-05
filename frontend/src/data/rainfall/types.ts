/** 雨量监测领域模型：站点归属、报送痕迹、锁定与勾稽校验都围绕这几份结构展开。 */

export type RainStation = {
  id: string
  /** 站点当前名称：改名只动这里，历史记录保留当时快照，不随之重新归属。 */
  name: string
  observers: string[]
}

export type RainRecordStatus = '已采集' | '待核' | '已核对' | '数据异常'

/** 一次报送留下的不可变快照；同一站同一时段重报时，前一版整份存进版本痕迹。 */
export type RainSnapshot = {
  intervalValues: number[]
  intervalSum: number
  cumulative: number
  intensity: string
  collectedAt: string
  reporter: string
  period: string
  receivedAt: number
  arrivalSeq: number
}

export type RainVersion = {
  version: number
  replacedAt: number
  snapshot: RainSnapshot
}

export type RainRecord = {
  id: number
  recordNo: string
  stationId: string
  /** 报送当时的站名快照：站点改名后，历史记录仍显示当时的归属站名。 */
  stationName: string
  period: string
  status: RainRecordStatus
  abnormal: boolean
  locked: boolean
  current: RainSnapshot
  /** 被后一版替换掉的历史报送，按版本号排列；最新内容始终在 current 上。 */
  versions: RainVersion[]
  discrepancy: number
  tolerance: number
  checkedBy?: string
  checkedAt?: string
  /** 标记异常时给水位监测那边的通报说明；无异常为空串。 */
  notice: string
}

export type RainSubmitInput = {
  period: string
  intervalValues: number[]
  cumulative: number
  collectedAt: string
}

export type RainSubmitResult = {
  ok: boolean
  message: string
  recordId?: number
  replaced?: { recordId: number; version: number }
}

/** 雨量异常通报：水位监测侧按这个结构读取雨量站上报的异常。 */
export type RainAlert = {
  recordId: number
  recordNo: string
  stationId: string
  stationName: string
  currentStationName: string
  period: string
  reporter: string
  notice: string
  receivedAt: number
}
