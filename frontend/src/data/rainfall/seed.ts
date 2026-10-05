import type { RainRecord, RainStation } from './types'

// 站点台账：记录归属挂在站点编号上，改名只改名称，编号不动，历史归属不受影响。
export const RAIN_STATIONS_SEED: RainStation[] = [
  { id: 'RS01', name: '北门岭雨量站', observers: ['张雨生', '李秀兰'] },
  { id: 'RS02', name: '沿江路雨量站', observers: ['王海涛'] },
  { id: 'RS03', name: '东郊闸雨量站', observers: ['陈晓敏'] },
]

// 到达序号初值：报送一律按到达先后裁决，种子数据排在所有真实报送之前。
const SEQ = { value: 1000 }

function nowPlus(offset: number): number {
  return new Date(`2026-10-04T08:${String(offset).padStart(2, '0')}:00`).getTime()
}

export const RAIN_RECORDS_SEED: RainRecord[] = [
  {
    id: 1,
    recordNo: 'RAIN-0001',
    stationId: 'RS01',
    stationName: '北门岭雨量站',
    period: '2026-10-04 08:00-09:00',
    status: '已采集',
    abnormal: false,
    locked: false,
    discrepancy: 0,
    tolerance: 2,
    notice: '',
    current: {
      intervalValues: [2.5, 4.0, 5.5],
      intervalSum: 12.0,
      cumulative: 12.0,
      intensity: '小雨',
      collectedAt: '2026-10-04 09:00',
      reporter: '张雨生',
      period: '2026-10-04 08:00-09:00',
      receivedAt: nowPlus(5),
      arrivalSeq: 1,
    },
    versions: [],
  },
  {
    id: 2,
    recordNo: 'RAIN-0002',
    stationId: 'RS02',
    stationName: '沿江路雨量站',
    period: '2026-10-04 08:00-09:00',
    status: '已采集',
    abnormal: false,
    locked: false,
    discrepancy: 1.0,
    tolerance: 2,
    notice: '',
    current: {
      intervalValues: [6.0, 7.0, 6.0],
      intervalSum: 19.0,
      cumulative: 20.0,
      intensity: '中雨',
      collectedAt: '2026-10-04 09:00',
      reporter: '王海涛',
      period: '2026-10-04 08:00-09:00',
      receivedAt: nowPlus(7),
      arrivalSeq: 2,
    },
    // 同一时段重报过一次：前一版留痕，最新一版覆盖当前内容。
    versions: [
      {
        version: 1,
        replacedAt: nowPlus(20),
        snapshot: {
          intervalValues: [5.5, 6.5, 6.0],
          intervalSum: 18.0,
          cumulative: 18.0,
          intensity: '中雨',
          collectedAt: '2026-10-04 09:00',
          reporter: '王海涛',
          period: '2026-10-04 08:00-09:00',
          receivedAt: nowPlus(6),
          arrivalSeq: 2,
        },
      },
    ],
  },
  {
    id: 3,
    recordNo: 'RAIN-0003',
    stationId: 'RS03',
    stationName: '东郊闸雨量站',
    period: '2026-10-04 07:00-08:00',
    status: '数据异常',
    abnormal: true,
    locked: false,
    discrepancy: 8.5,
    tolerance: 2,
    notice: '翻斗式雨量计疑似堵塞，时段读数跳变，已通知现场检修',
    current: {
      intervalValues: [12.0, 0, 26.5],
      intervalSum: 38.5,
      cumulative: 30.0,
      intensity: '大雨',
      collectedAt: '2026-10-04 08:00',
      reporter: '陈晓敏',
      period: '2026-10-04 07:00-08:00',
      receivedAt: nowPlus(10),
      arrivalSeq: 3,
    },
    versions: [],
  },
  {
    id: 4,
    recordNo: 'RAIN-0004',
    stationId: 'RS01',
    stationName: '北门岭雨量站',
    period: '2026-10-04 07:00-08:00',
    status: '已核对',
    abnormal: false,
    locked: true,
    discrepancy: 0,
    tolerance: 2,
    notice: '',
    checkedBy: '值班管理员',
    checkedAt: '2026-10-04 08:20',
    current: {
      intervalValues: [0.5, 1.0, 0.5],
      intervalSum: 2.0,
      cumulative: 2.0,
      intensity: '小雨',
      collectedAt: '2026-10-04 08:00',
      reporter: '李秀兰',
      period: '2026-10-04 07:00-08:00',
      receivedAt: nowPlus(3),
      arrivalSeq: 4,
    },
    versions: [],
  },
]

export function rainArrivalStart(): number {
  return SEQ.value
}
