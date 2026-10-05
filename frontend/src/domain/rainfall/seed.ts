import type { RainfallRecord, RainfallStation, SessionIdentity } from './types'

// 站点档案：归属以稳定编码 code 为准，name 只是显示名，改名不影响任何历史记录的归属。
export const RAINFALL_STATIONS: RainfallStation[] = [
  {
    code: 'ST-CS01',
    name: '城东一号雨量站',
    observers: [
      { code: 'U101', name: '王雨生' },
      { code: 'U102', name: '李秀英' },
    ],
  },
  {
    code: 'ST-CX02',
    name: '城西二号雨量站',
    observers: [{ code: 'U201', name: '张卫国' }],
  },
  {
    code: 'ST-JS03',
    name: '金山三号雨量站',
    observers: [{ code: 'U301', name: '陈阿强' }],
  },
]

// 可切换的演示身份：含各站测报员与一名不归属站点的监测协调员（负责核对）。
export const IDENTITIES: SessionIdentity[] = [
  { code: 'U101', name: '王雨生', role: '雨量测报员', stationId: 'ST-CS01' },
  { code: 'U102', name: '李秀英', role: '雨量测报员', stationId: 'ST-CS01' },
  { code: 'U201', name: '张卫国', role: '雨量测报员', stationId: 'ST-CX02' },
  { code: 'U301', name: '陈阿强', role: '雨量测报员', stationId: 'ST-JS03' },
  { code: 'U900', name: '调度协调员', role: '监测协调员', stationId: null },
]

function rec(
  partial: Partial<RainfallRecord> & Pick<RainfallRecord, 'id' | 'stationId' | 'stationName' | 'period' | 'observerCode' | 'observerName'>,
): RainfallRecord {
  const intervals = partial.intervals ?? [
    { slot: '08:00-09:00', amount: '2.5' },
    { slot: '09:00-10:00', amount: '3.0' },
  ]
  const intervalTotal = intervals.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  const cumulative = partial.cumulative ?? String(intervalTotal)
  const diff = round2(Number(cumulative) - intervalTotal)
  return {
    stationNameAtSubmit: partial.stationNameAtSubmit ?? partial.stationName!,
    submittedAt: partial.submittedAt ?? '2026-10-05 09:05',
    intervals,
    cumulative,
    intervalTotal: round2(intervalTotal),
    diff,
    withinTolerance: Math.abs(diff) <= TOLERANCE_MM,
    status: partial.status ?? '已采集',
    pendingReview: partial.pendingReview ?? Math.abs(diff) > TOLERANCE_MM,
    locked: partial.locked ?? partial.status === '已核对',
    abnormal: partial.abnormal ?? false,
    abnormalNote: partial.abnormalNote ?? '',
    version: partial.version ?? 1,
    revisions: partial.revisions ?? [],
    ...partial,
  }
}

// 容许范围：累计雨量与各时段之和相差不超过 0.2mm，超了整条标为待核。
export const TOLERANCE_MM = 0.2

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// 初始记录：包含正常、已核对锁定、待核三种样态；站名快照与现名一致（改名后两者才会分叉）。
export function seedRainfallRecords(): RainfallRecord[] {
  return [
    rec({
      id: 1,
      stationId: 'ST-CS01',
      stationName: '城东一号雨量站',
      period: '2026-10-05 08:00-10:00',
      observerCode: 'U101',
      observerName: '王雨生',
      submittedAt: '2026-10-05 10:02',
      cumulative: '5.5',
    }),
    rec({
      id: 2,
      stationId: 'ST-CX02',
      stationName: '城西二号雨量站',
      period: '2026-10-05 08:00-10:00',
      observerCode: 'U201',
      observerName: '张卫国',
      submittedAt: '2026-10-05 10:04',
      intervals: [
        { slot: '08:00-09:00', amount: '1.0' },
        { slot: '09:00-10:00', amount: '1.2' },
      ],
      cumulative: '2.2',
      status: '已核对',
    }),
    rec({
      id: 3,
      stationId: 'ST-JS03',
      stationName: '金山三号雨量站',
      period: '2026-10-05 08:00-10:00',
      observerCode: 'U301',
      observerName: '陈阿强',
      submittedAt: '2026-10-05 10:06',
      intervals: [
        { slot: '08:00-09:00', amount: '4.0' },
        { slot: '09:00-10:00', amount: '4.0' },
      ],
      // 手填累计 10.0，与时段和 8.0 相差 2.0，超过 0.2mm 容许范围 → 待核。
      cumulative: '10.0',
    }),
  ]
}
