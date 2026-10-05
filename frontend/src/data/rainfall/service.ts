import {
  listRainRecords,
  listStations,
  nextArrivalSeq,
  resetRainfall,
  saveRainRecords,
  saveStations,
} from '@/data/rainfall/store'
import type {
  RainAlert,
  RainRecord,
  RainSnapshot,
  RainStation,
  RainSubmitInput,
  RainSubmitResult,
} from '@/data/rainfall/types'
import type { OperatorIdentity } from '@/stores/session'

// 累计雨量与各时段雨量之和的容许差值（毫米）：超过就标「待核」。
export const RAIN_TOLERANCE_MM = 2

export type RainFilter = {
  stationId?: string
  status?: string
  keyword?: string
}

export function findStation(stationId: string): RainStation | undefined {
  return listStations().find((station) => station.id === stationId)
}

function requireStation(stationId: string): RainStation {
  const station = findStation(stationId)
  if (!station) {
    throw new Error(`没有编号为 ${stationId} 的雨量站`)
  }
  return station
}

/** 归属闸门：时段雨量、累计雨量只有本站测报员能填，其他站一律退回并说明越在哪。 */
function assertStationObserver(identity: OperatorIdentity, station: RainStation): string | null {
  if (identity.role !== '测报员') {
    return `已退回：${identity.name} 是值班管理员，不归属任何雨量站，不能替站点填报时段雨量与累计雨量`
  }
  if (identity.stationId !== station.id) {
    const own = findStation(identity.stationId)
    const ownName = own ? own.name : identity.stationId
    return (
      `越权报送已退回：${identity.name} 归属「${ownName}」，` +
      `不能为「${station.name}」填报。时段雨量与累计雨量只接受本站测报员报送。`
    )
  }
  if (!station.observers.includes(identity.name)) {
    return `已退回：${identity.name} 不在「${station.name}」测报员名册中`
  }
  return null
}

function assertNotLocked(record: RainRecord): string | null {
  if (record.locked) {
    return (
      `记录 ${record.recordNo} 已核对并整份锁定（核对人：${record.checkedBy ?? '—'}），` +
      `谁都不能再动，重报、异常标记、修改一律拒绝`
    )
  }
  return null
}

function parseInput(input: RainSubmitInput): {
  ok: boolean
  values: number[]
  cumulative: number
  message?: string
} {
  const period = input.period.trim()
  const collectedAt = input.collectedAt.trim()
  if (!period) {
    return { ok: false, values: [], cumulative: 0, message: '请填写报送时段（如 2026-10-05 08:00-09:00）' }
  }
  if (!collectedAt) {
    return { ok: false, values: [], cumulative: 0, message: '请填写采集时间' }
  }
  if (input.intervalValues.length === 0) {
    return { ok: false, values: [], cumulative: 0, message: '至少填写一个分时段雨量' }
  }
  const values = input.intervalValues.map((value) => Number(value))
  if (values.some((value) => Number.isNaN(value) || value < 0)) {
    return { ok: false, values: [], cumulative: 0, message: '各分时段雨量必须是不小于 0 的数字' }
  }
  const cumulative = Number(input.cumulative)
  if (Number.isNaN(cumulative) || cumulative < 0) {
    return { ok: false, values: [], cumulative: 0, message: '累计雨量必须是不小于 0 的数字' }
  }
  return { ok: true, values, cumulative }
}

/** 降雨强度按本次时段内雨量合计粗分级，仅作演示展示。 */
function intensityOf(intervalSum: number): string {
  if (intervalSum < 10) return '小雨'
  if (intervalSum < 25) return '中雨'
  if (intervalSum < 50) return '大雨'
  return '暴雨'
}

function buildSnapshot(
  station: RainStation,
  reporter: string,
  input: RainSubmitInput,
  values: number[],
  cumulative: number,
): RainSnapshot {
  const intervalSum = round1(values.reduce((sum, value) => sum + value, 0))
  return {
    intervalValues: values.map((value) => round1(value)),
    intervalSum,
    cumulative: round1(cumulative),
    intensity: intensityOf(intervalSum),
    collectedAt: input.collectedAt.trim(),
    reporter,
    period: input.period.trim(),
    receivedAt: Date.now(),
    arrivalSeq: nextArrivalSeq(),
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function statusFor(discrepancy: number, tolerance: number): RainRecord['status'] {
  return discrepancy > tolerance ? '待核' : '已采集'
}

function findRecord(records: RainRecord[], recordId: number): RainRecord | undefined {
  return records.find((record) => record.id === recordId)
}

function persist(records: RainRecord[]): void {
  saveRainRecords(records.map((record) => ({ ...record })))
}

function nextRecordNo(records: RainRecord[]): string {
  const max = records.reduce((top, record) => Math.max(top, record.id), 0)
  return `RAIN-${String(max + 1).padStart(4, '0')}`
}

/**
 * 雨量报送主入口：
 * - 本站测报员才能填，越站退回；
 * - 已核对记录整份锁定；
 * - 同一站同一时段重复报送：最新一次覆盖当前内容，前一版进版本痕迹；
 * - 累计雨量与分时段之和超容许差，标「待核」。
 */
export function submitRainfall(
  stationId: string,
  input: RainSubmitInput,
  identity: OperatorIdentity,
): RainSubmitResult {
  const station = findStation(stationId)
  if (!station) {
    return { ok: false, message: `没有编号为 ${stationId} 的雨量站，报送无从归属` }
  }
  const denied = assertStationObserver(identity, station)
  if (denied) {
    return { ok: false, message: denied }
  }
  const parsed = parseInput(input)
  if (!parsed.ok) {
    return { ok: false, message: parsed.message ?? '报送数据不合规' }
  }

  const records = listRainRecords()
  // 同一站同一时段视为同一记录：存在则按「最新覆盖、旧版留痕」处理，不存在则新建。
  const target = records.find(
    (record) => record.stationId === station.id && record.period === input.period.trim(),
  )
  if (target) {
    const locked = assertNotLocked(target)
    if (locked) {
      return { ok: false, message: locked }
    }
  }

  const snapshot = buildSnapshot(station, identity.name, input, parsed.values, parsed.cumulative)
  const discrepancy = round1(Math.abs(snapshot.cumulative - snapshot.intervalSum))

  if (target) {
    const replacedVersion = {
      version: target.versions.length + 1,
      replacedAt: Date.now(),
      snapshot: target.current,
    }
    target.versions = [...target.versions, replacedVersion]
    target.current = snapshot
    target.stationName = station.name
    target.discrepancy = discrepancy
    target.tolerance = RAIN_TOLERANCE_MM
    target.status = statusFor(discrepancy, RAIN_TOLERANCE_MM)
    // 重报代表本站重新出具数据，上一版上挂的异常通报随旧版留痕、当前版解除。
    target.abnormal = false
    target.notice = ''
    persist(records)
    return {
      ok: true,
      recordId: target.id,
      replaced: { recordId: target.id, version: replacedVersion.version },
      message:
        `已按最新报送覆盖 ${target.recordNo}，前一版（第 ${replacedVersion.version} 版）已留痕；` +
        (discrepancy > RAIN_TOLERANCE_MM
          ? `累计雨量与时段之和相差 ${discrepancy}mm，超过容许 ${RAIN_TOLERANCE_MM}mm，标记待核`
          : `勾稽差值 ${discrepancy}mm，在容许范围内`),
    }
  }

  const record: RainRecord = {
    id: records.reduce((top, item) => Math.max(top, item.id), 0) + 1,
    recordNo: nextRecordNo(records),
    stationId: station.id,
    stationName: station.name,
    period: snapshot.period,
    status: statusFor(discrepancy, RAIN_TOLERANCE_MM),
    abnormal: false,
    locked: false,
    current: snapshot,
    versions: [],
    discrepancy,
    tolerance: RAIN_TOLERANCE_MM,
    notice: '',
  }
  records.push(record)
  persist(records)
  return {
    ok: true,
    recordId: record.id,
    message:
      `${station.name} 的 ${record.recordNo} 已接收（到达序号 ${snapshot.arrivalSeq}），归属本站；` +
      (discrepancy > RAIN_TOLERANCE_MM
        ? `累计雨量与时段之和相差 ${discrepancy}mm，超过容许 ${RAIN_TOLERANCE_MM}mm，标记待核`
        : `勾稽差值 ${discrepancy}mm，在容许范围内`),
  }
}

/**
 * 同一站两位测报员并发（竞态）报送同一时段：
 * 两份都先收下做校验，但按到达序号裁决，只留先到的一份，后到的整份退回并说明败给谁。
 */
export function submitRainfallRace(
  stationId: string,
  period: string,
  first: { reporter: string; input: RainSubmitInput },
  second: { reporter: string; input: RainSubmitInput },
): { winner: RainSubmitResult; loser: RainSubmitResult } {
  const station = requireStation(stationId)
  const members = [first.reporter, second.reporter]
  for (const reporter of members) {
    if (!station.observers.includes(reporter)) {
      const message = `竞态报送无法成立：${reporter} 不在「${station.name}」测报员名册中`
      return {
        winner: { ok: false, message },
        loser: { ok: false, message },
      }
    }
  }
  if (first.reporter === second.reporter) {
    const message = '竞态报送需要两位不同的测报员同时提交'
    return {
      winner: { ok: false, message },
      loser: { ok: false, message },
    }
  }

  const records = listRainRecords()
  const target = records.find(
    (record) => record.stationId === station.id && record.period === period.trim(),
  )
  if (target?.locked) {
    const message = assertNotLocked(target) ?? '记录已锁定'
    return { winner: { ok: false, message }, loser: { ok: false, message } }
  }

  const parsedA = parseInput(first.input)
  const parsedB = parseInput(second.input)
  if (!parsedA.ok || !parsedB.ok) {
    const message = parsedA.message ?? parsedB.message ?? '报送数据不合规'
    return { winner: { ok: false, message }, loser: { ok: false, message } }
  }

  // 到达序号按提交动作先后发放：A 先拿号，B 后拿号；B 无论内容如何都退回。
  const seqA = nextArrivalSeq()
  const seqB = nextArrivalSeq()
  const makeSnapshot = (
    reporter: string,
    input: RainSubmitInput,
    values: number[],
    cumulative: number,
    seq: number,
  ): RainSnapshot => ({
    intervalValues: values.map((value) => round1(value)),
    intervalSum: round1(values.reduce((sum, value) => sum + value, 0)),
    cumulative: round1(cumulative),
    intensity: intensityOf(round1(values.reduce((sum, value) => sum + value, 0))),
    collectedAt: input.collectedAt.trim(),
    reporter,
    period: input.period.trim(),
    receivedAt: Date.now(),
    arrivalSeq: seq,
  })

  const snapshotA = makeSnapshot(first.reporter, first.input, parsedA.values, parsedA.cumulative, seqA)
  const discrepancyA = round1(Math.abs(snapshotA.cumulative - snapshotA.intervalSum))

  if (target) {
    target.versions = [
      ...target.versions,
      { version: target.versions.length + 1, replacedAt: Date.now(), snapshot: target.current },
    ]
    target.current = snapshotA
    target.stationName = station.name
    target.discrepancy = discrepancyA
    target.tolerance = RAIN_TOLERANCE_MM
    target.status = statusFor(discrepancyA, RAIN_TOLERANCE_MM)
    target.abnormal = false
    target.notice = ''
    persist(records)
  } else {
    const record: RainRecord = {
      id: records.reduce((top, item) => Math.max(top, item.id), 0) + 1,
      recordNo: nextRecordNo(records),
      stationId: station.id,
      stationName: station.name,
      period: snapshotA.period,
      status: statusFor(discrepancyA, RAIN_TOLERANCE_MM),
      abnormal: false,
      locked: false,
      current: snapshotA,
      versions: [],
      discrepancy: discrepancyA,
      tolerance: RAIN_TOLERANCE_MM,
      notice: '',
    }
    records.push(record)
    persist(records)
  }

  const saved = records.find(
    (record) => record.stationId === station.id && record.period === period.trim(),
  )!
  return {
    winner: {
      ok: true,
      recordId: saved.id,
      message:
        `竞态裁决：${first.reporter} 的报送先到（序号 ${seqA}），已保存为 ${saved.recordNo} 当前版本` +
        (discrepancyA > RAIN_TOLERANCE_MM ? '；勾稽超限，标记待核' : ''),
    },
    loser: {
      ok: false,
      message:
        `竞态裁决：${second.reporter} 的报送（序号 ${seqB}）晚于 ${first.reporter}（序号 ${seqA}），` +
        `同一站同一时段只留先到的一份，本报送整份退回、未留版本`,
    },
  }
}

/** 站点上报异常：只接受本站测报员，且必须写清说明——水位监测那边要看到原因。 */
export function markRainfallAbnormal(
  recordId: number,
  notice: string,
  identity: OperatorIdentity,
): RainSubmitResult {
  const records = listRainRecords()
  const record = findRecord(records, recordId)
  if (!record) {
    return { ok: false, message: `没有找到编号为 ${recordId} 的雨量记录` }
  }
  const station = requireStation(record.stationId)
  const denied = assertStationObserver(identity, station)
  if (denied) {
    return { ok: false, message: denied }
  }
  const locked = assertNotLocked(record)
  if (locked) {
    return { ok: false, message: locked }
  }
  const text = notice.trim()
  if (!text) {
    return { ok: false, message: '请填写异常情况说明，水位监测侧需要据此联动判断' }
  }
  record.abnormal = true
  record.status = '数据异常'
  record.notice = text
  persist(records)
  return {
    ok: true,
    recordId: record.id,
    message: `${record.recordNo} 已标记数据异常并通报水位监测侧：${text}`,
  }
}

/** 核对整份记录并锁住：值班管理员操作，锁住后谁都不能再动。 */
export function verifyRainfall(recordId: number, identity: OperatorIdentity): RainSubmitResult {
  if (identity.role !== '值班管理员') {
    return { ok: false, message: '只有值班管理员可以确认核对，测报员不能自锁本站记录' }
  }
  const records = listRainRecords()
  const record = findRecord(records, recordId)
  if (!record) {
    return { ok: false, message: `没有找到编号为 ${recordId} 的雨量记录` }
  }
  if (record.locked) {
    return { ok: false, message: `${record.recordNo} 已是核对锁定状态，无需重复核对` }
  }
  if (record.abnormal) {
    return { ok: false, message: `${record.recordNo} 仍处数据异常，需本站重报解除后才能核对` }
  }
  record.status = '已核对'
  record.locked = true
  record.checkedBy = identity.name
  record.checkedAt = new Date().toLocaleString('zh-CN', { hour12: false })
  persist(records)
  return { ok: true, recordId: record.id, message: `${record.recordNo} 已核对，整份记录锁定` }
}

/**
 * 站点改名：只改站点台账上的当前名称。
 * 历史记录按当时的归属站名快照保留，不因此重新归属或改头换面。
 */
export function renameRainStation(
  stationId: string,
  newName: string,
  identity: OperatorIdentity,
): RainSubmitResult {
  if (identity.role !== '值班管理员') {
    return { ok: false, message: '只有值班管理员可以变更雨量站名称' }
  }
  const stations = listStations()
  const station = stations.find((item) => item.id === stationId)
  if (!station) {
    return { ok: false, message: `没有编号为 ${stationId} 的雨量站` }
  }
  const name = newName.trim()
  if (!name) {
    return { ok: false, message: '新站名不能为空' }
  }
  if (name === station.name) {
    return { ok: false, message: '新站名与当前名称一致，无需变更' }
  }
  const oldName = station.name
  station.name = name
  saveStations(stations)
  const affected = listRainRecords().filter((record) => record.stationId === stationId).length
  return {
    ok: true,
    message:
      `站点 ${stationId} 已由「${oldName}」更名为「${name}」；此后新报送按新名归属，` +
      `既有 ${affected} 份历史记录仍保留「${oldName}」快照，不重新归属`,
  }
}

export function listRainfall(filter: RainFilter = {}): RainRecord[] {
  let rows = listRainRecords()
  if (filter.stationId) {
    rows = rows.filter((record) => record.stationId === filter.stationId)
  }
  if (filter.status) {
    rows = rows.filter((record) => record.status === filter.status)
  }
  const keyword = filter.keyword?.trim()
  if (keyword) {
    rows = rows.filter(
      (record) =>
        record.recordNo.includes(keyword) ||
        record.stationName.includes(keyword) ||
        record.period.includes(keyword) ||
        record.current.reporter.includes(keyword),
    )
  }
  return [...rows].sort((a, b) => b.current.arrivalSeq - a.current.arrivalSeq)
}

/** 水位监测侧读取的雨量异常通报：按到达序号倒序，附带站点当前名以便对照改名情况。 */
export function listRainfallAlerts(): RainAlert[] {
  const records = listRainRecords()
  return records
    .filter((record) => record.abnormal)
    .map((record) => ({
      recordId: record.id,
      recordNo: record.recordNo,
      stationId: record.stationId,
      stationName: record.stationName,
      currentStationName: findStation(record.stationId)?.name ?? record.stationName,
      period: record.period,
      reporter: record.current.reporter,
      notice: record.notice,
      receivedAt: record.current.receivedAt,
    }))
    .sort((a, b) => b.receivedAt - a.receivedAt)
}

export function exportRainfallCsv(): { filename: string; content: string } {
  const header = [
    '记录编号', '站点编号', '归属站名(报送当时)', '时段', '分时段雨量(mm)',
    '时段之和(mm)', '累计雨量(mm)', '勾稽差值(mm)', '容许差(mm)', '降雨强度',
    '状态', '是否锁定', '报送人', '采集时间', '到达序号', '历史版本数', '异常通报', '核对人', '核对时间',
  ]
  const lines = [header.join(',')]
  for (const record of listRainfall()) {
    lines.push(
      [
        record.recordNo,
        record.stationId,
        record.stationName,
        record.period,
        record.current.intervalValues.join('|'),
        record.current.intervalSum,
        record.current.cumulative,
        record.discrepancy,
        record.tolerance,
        record.current.intensity,
        record.status,
        record.locked ? '是' : '否',
        record.current.reporter,
        record.current.collectedAt,
        record.current.arrivalSeq,
        record.versions.length,
        record.notice,
        record.checkedBy ?? '',
        record.checkedAt ?? '',
      ]
        .map((cell) => String(cell).replace(/,/g, '，'))
        .join(','),
    )
  }
  return { filename: '雨量监测-归属台账.csv', content: `﻿${lines.join('\n')}` }
}

export { listStations, resetRainfall }
