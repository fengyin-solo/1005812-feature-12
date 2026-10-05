import { TOLERANCE_MM, round2 } from './seed'
import { getStation, listRecords, listStations, renameStation, resetRainfall, saveRecords } from './store'
import type {
  RainfallRecord,
  RainfallRevision,
  RainfallStation,
  SessionIdentity,
  SubmitOutcome,
  SubmitRainfallInput,
} from './types'

// 同站同时段竞态：JS 单线程下用一张「在途锁」表表达数据库行锁。
// 两位测报员几乎同时提交时，先拿到锁的那份落库，后到的原样退回。
const inFlightKeys = new Set<string>()

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function isStationObserver(identity: SessionIdentity, stationId: string): boolean {
  return identity.role === '雨量测报员' && identity.stationId === stationId
}

function describeIdentity(identity: SessionIdentity): string {
  if (identity.role === '监测协调员') {
    return '监测协调员（不归属任何雨量站）'
  }
  const station = identity.stationId ? getStation(identity.stationId) : undefined
  return `测报员${identity.name}（隶属${station ? station.name : identity.stationId}）`
}

export function stationOptions(): RainfallStation[] {
  return listStations()
}

export function toleranceText(): string {
  return `±${TOLERANCE_MM}mm`
}

export { TOLERANCE_MM as toleranceValue }

export type RainfallView = RainfallRecord & {
  /** 站点现用名（改名后可能与 stationNameAtSubmit 不同）。 */
  stationCurrentName: string
  /** 是否当前身份所属站。 */
  ownedByMe: boolean
}

export function listRainfall(identity: SessionIdentity): RainfallView[] {
  return listRecords().map((record) => {
    const station = getStation(record.stationId)
    return {
      ...record,
      stationCurrentName: station ? station.name : record.stationId,
      ownedByMe: isStationObserver(identity, record.stationId),
    }
  })
}

function computeTotal(intervals: SubmitRainfallInput['intervals']): number {
  return round2(intervals.reduce((sum, item) => sum + (Number(item.amount) || 0), 0))
}

function snapshotRevision(record: RainfallRecord, note: string): RainfallRevision {
  return {
    version: record.version,
    stationNameAtSubmit: record.stationNameAtSubmit,
    observerCode: record.observerCode,
    observerName: record.observerName,
    submittedAt: record.submittedAt,
    intervals: record.intervals,
    cumulative: record.cumulative,
    intervalTotal: record.intervalTotal,
    diff: record.diff,
    note,
  }
}

/**
 * 提交（或重复报送）一份雨量记录。
 * 规则：
 *  - 只有该站在册测报员能填本站的时段雨量与累计雨量，别站/协调员一律退回并说明越权点；
 *  - 同站同时段已有未锁定记录时按最新一次存，前一版整份进 revisions 留痕；
 *  - 已核对记录整份锁住，重复报送也不能覆盖；
 *  - 累计雨量与各时段之和差值超容许范围，整条标为待核。
 */
export function submitRainfall(
  identity: SessionIdentity,
  input: SubmitRainfallInput,
): SubmitOutcome {
  const lockKey = `${input.stationId}|${input.period.trim()}`
  // 顺序重复报送：同一站点同时段此刻没有其它在途提交，拿到处理权再走完整流程。
  if (inFlightKeys.has(lockKey)) {
    return raceLost(lockKey, input.period)
  }
  inFlightKeys.add(lockKey)
  try {
    return applySubmit(identity, input)
  } finally {
    inFlightKeys.delete(lockKey)
  }
}

// 入站校验：站点存在、时段非空、身份归属本站、数值合法。返回 null 表示通过。
function validateSubmit(
  identity: SessionIdentity,
  input: SubmitRainfallInput,
): SubmitOutcome | null {
  const station = getStation(input.stationId)
  if (!station) {
    return { ok: false, reason: 'invalid', replaced: false, message: '雨量站不存在，无法归属记录' }
  }
  if (input.period.trim() === '') {
    return { ok: false, reason: 'invalid', replaced: false, message: '报送时段不能为空' }
  }
  // 关口一：站点归属。时段雨量、累计雨量只有本站测报员能填。
  if (!isStationObserver(identity, input.stationId)) {
    const where =
      identity.role === '监测协调员'
        ? '协调员不归属任何雨量站，不得代填时段雨量与累计雨量'
        : `你隶属${identity.stationId ? getStation(identity.stationId)?.name ?? '其它站' : '其它站'}，不得填报${station.name}的数据`
    return {
      ok: false,
      reason: 'forbidden_station',
      replaced: false,
      message: `退回：越权填报——${where}。本份时段雨量与累计雨量仅允许${station.name}在册测报员提交。`,
    }
  }
  const cumulative = Number(input.cumulative)
  if (input.cumulative.trim() === '' || Number.isNaN(cumulative) || cumulative < 0) {
    return { ok: false, reason: 'invalid', replaced: false, message: '累计雨量需为不小于 0 的数字（mm）' }
  }
  if (input.intervals.some((item) => item.amount.trim() !== '' && (Number.isNaN(Number(item.amount)) || Number(item.amount) < 0))) {
    return { ok: false, reason: 'invalid', replaced: false, message: '各时段雨量需为不小于 0 的数字（mm）' }
  }
  return null
}

// 落库：调用方必须已经持有该站点+时段的在途锁。
function applySubmit(identity: SessionIdentity, input: SubmitRainfallInput): SubmitOutcome {
  const invalid = validateSubmit(identity, input)
  if (invalid) {
    return invalid
  }
  const station = getStation(input.stationId)!
  const cumulative = Number(input.cumulative)
  const records = listRecords()
  const existing = records.find(
    (row) => row.stationId === input.stationId && row.period === input.period,
  )

  // 关口二：整份锁定。已核对的记录谁都不能再动，同站测报员重复报送也不行。
  if (existing?.locked) {
    return {
      ok: false,
      reason: 'locked',
      replaced: false,
      message: `退回：${station.name}「${input.period}」记录已核对并整份锁定，任何人不得再修改或重复报送`,
    }
  }

  const intervalTotal = computeTotal(input.intervals)
  const diff = round2(cumulative - intervalTotal)
  const withinTolerance = Math.abs(diff) <= TOLERANCE_MM
  const stamp = nowText()

  if (existing) {
    // 重复报送：按最新一次存，但前一版整份留痕。
    const revision = snapshotRevision(existing, `被 ${identity.name} 于 ${stamp} 的重新报送顶替`)
    const updated: RainfallRecord = {
      ...existing,
      stationName: station.name,
      observerCode: identity.code,
      observerName: identity.name,
      submittedAt: stamp,
      intervals: input.intervals.map((item) => ({ ...item })),
      cumulative: String(cumulative),
      intervalTotal,
      diff,
      withinTolerance,
      status: '已采集',
      pendingReview: !withinTolerance,
      abnormal: existing.abnormal,
      abnormalNote: existing.abnormalNote,
      version: existing.version + 1,
      revisions: [...existing.revisions, revision],
    }
    saveRecords(records.map((row) => (row.id === existing.id ? updated : row)))
    return {
      ok: true,
      replaced: true,
      record: updated,
      message: withinTolerance
        ? `已按最新报送覆盖（第 ${updated.version} 版），前一版已留痕；累计与时段和相差 ${diff}mm，在容许范围内`
        : `已按最新报送覆盖（第 ${updated.version} 版），前一版已留痕；但累计(${cumulative}mm)与时段和(${intervalTotal}mm)相差 ${diff}mm，超出 ${toleranceText()} 容许范围，已标为待核`,
    }
  }

  const id = records.reduce((max, row) => Math.max(max, row.id), 0) + 1
  const created: RainfallRecord = {
    id,
    stationId: station.code,
    stationNameAtSubmit: station.name,
    stationName: station.name,
    period: input.period,
    observerCode: identity.code,
    observerName: identity.name,
    submittedAt: stamp,
    intervals: input.intervals.map((item) => ({ ...item })),
    cumulative: String(cumulative),
    intervalTotal,
    diff,
    withinTolerance,
    status: '已采集',
    pendingReview: !withinTolerance,
    locked: false,
    abnormal: false,
    abnormalNote: '',
    version: 1,
    revisions: [],
  }
  saveRecords([...records, created])
  return {
    ok: true,
    replaced: false,
    record: created,
    message: withinTolerance
      ? `报送成功，已归属${station.name}；累计与时段和相差 ${diff}mm，在容许范围内`
      : `报送成功，已归属${station.name}；但累计(${cumulative}mm)与时段和(${intervalTotal}mm)相差 ${diff}mm，超出 ${toleranceText()} 容许范围，已标为待核`,
  }
}

/**
 * 竞态报送：同一站点同一时段，两位测报员几乎同时提交。
 * 用在途锁模拟数据库行锁——两份请求争同一把锁，先到者拿锁、校验并落库；
 * 后到者拿不到锁，原样退回（即使内容不同也不覆盖），只留先到的那一份。
 */
export function submitRainfallConcurrent(
  first: { identity: SessionIdentity; input: SubmitRainfallInput },
  second: { identity: SessionIdentity; input: SubmitRainfallInput },
): { winner: SubmitOutcome; loser: SubmitOutcome } {
  const key = `${first.input.stationId}|${first.input.period.trim()}`
  if (inFlightKeys.has(key)) {
    return { winner: raceLost(key, first.input.period), loser: raceLost(key, second.input.period) }
  }
  inFlightKeys.add(key)
  try {
    const winner = applySubmit(first.identity, first.input)
    // 后到者在锁仍被持有时到达：若先到者落库成功，后到者一律按竞态落败退回；
    // 若先到者自身不合法（如越权），后到者仍可独立判定。
    if (!winner.ok) {
      return { winner, loser: applySubmit(second.identity, second.input) }
    }
    return { winner, loser: raceReject(second.identity, second.input) }
  } finally {
    inFlightKeys.delete(key)
  }
}

function raceLost(lockKey: string, period: string): SubmitOutcome {
  const [stationId] = lockKey.split('|')
  const station = getStation(stationId)
  return {
    ok: false,
    reason: 'race_lost',
    replaced: false,
    message: `退回：${station ? station.name : stationId}「${period}」已有一份报送在途，本份未取得处理权`,
  }
}

function raceReject(identity: SessionIdentity, input: SubmitRainfallInput): SubmitOutcome {
  const station = getStation(input.stationId)
  // 后到者若是别站身份，优先说明越权点；否则按竞态退回。
  if (!isStationObserver(identity, input.stationId)) {
    return {
      ok: false,
      reason: 'forbidden_station',
      replaced: false,
      message: `退回：越权填报——${describeIdentity(identity)}不得填报${station ? station.name : input.stationId}的数据；且该站此时段已有先到报送`,
    }
  }
  return {
    ok: false,
    reason: 'race_lost',
    replaced: false,
    message: `退回：竞态落败——${station ? station.name : ''}「${input.period}」同站同时段已有另一位测报员的报送先到并落库，本份不作覆盖，只保留先到的那一份`,
  }
}

// 确认核对：待核（勾稽超限）记录不能直接核对，必须先由本站重新报送修正；核对后整份锁定。
export function verifyRecord(identity: SessionIdentity, id: number): SubmitOutcome {
  const records = listRecords()
  const record = records.find((row) => row.id === id)
  if (!record) {
    return { ok: false, replaced: false, message: '没有找到这条雨量记录' }
  }
  const station = getStation(record.stationId)
  if (record.locked) {
    return { ok: false, reason: 'locked', replaced: false, message: '该记录已核对锁定，不能重复核对' }
  }
  if (record.pendingReview) {
    return {
      ok: false,
      reason: 'pending_review',
      replaced: false,
      message: `核对被拦：累计雨量(${record.cumulative}mm)与各时段之和(${record.intervalTotal}mm)相差 ${record.diff}mm，超出 ${toleranceText()} 容许范围，请先由${station ? station.name : record.stationId}测报员重新报送修正后再核对`,
    }
  }
  const updated: RainfallRecord = { ...record, status: '已核对', locked: true, pendingReview: false }
  saveRecords(records.map((row) => (row.id === id ? updated : row)))
  return { ok: true, replaced: false, record: updated, message: `已核对，记录整份锁定，任何人不得再修改（核对人：${identity.name}）` }
}

// 上报异常：本站测报员对本站未锁定记录上报；异常要让水位监测那边看得到。
export function markAbnormal(identity: SessionIdentity, id: number, note: string): SubmitOutcome {
  const records = listRecords()
  const record = records.find((row) => row.id === id)
  if (!record) {
    return { ok: false, replaced: false, message: '没有找到这条雨量记录' }
  }
  if (record.locked) {
    return { ok: false, reason: 'locked', replaced: false, message: '该记录已核对锁定，不能再上报异常' }
  }
  if (!isStationObserver(identity, record.stationId)) {
    return {
      ok: false,
      reason: 'forbidden_station',
      replaced: false,
      message: `退回：越权操作——${describeIdentity(identity)}不得替${getStation(record.stationId)?.name ?? '别站'}上报异常`,
    }
  }
  if (note.trim() === '') {
    return { ok: false, reason: 'invalid', replaced: false, message: '上报异常需填写异常说明' }
  }
  const updated: RainfallRecord = {
    ...record,
    status: '数据异常',
    abnormal: true,
    abnormalNote: note.trim(),
  }
  saveRecords(records.map((row) => (row.id === id ? updated : row)))
  return { ok: true, replaced: false, record: updated, message: '异常已上报，并同步给水位监测侧可见' }
}

// 水位监测侧调用：只看雨量站报上来的异常。
export function rainfallAlertsForWaterLevel(): RainfallView[] {
  return listRecords()
    .filter((row) => row.abnormal)
    .map((record) => {
      const station = getStation(record.stationId)
      return {
        ...record,
        stationCurrentName: station ? station.name : record.stationId,
        ownedByMe: false,
      }
    })
}

// 管理动作：站点改名（仅演示「历史不重新归属」）。
export function changeStationName(identity: SessionIdentity, code: string, name: string): SubmitOutcome {
  if (identity.role !== '监测协调员') {
    return { ok: false, reason: 'forbidden_station', replaced: false, message: '仅监测协调员可调整站点名称' }
  }
  if (name.trim() === '') {
    return { ok: false, reason: 'invalid', replaced: false, message: '站点名称不能为空' }
  }
  renameStation(code, name.trim())
  return { ok: true, replaced: false, message: '站点已改名；历史记录仍按报送当时的站名与归属保留，不重新归属' }
}

export function resetRainfallData(): void {
  resetRainfall()
}
