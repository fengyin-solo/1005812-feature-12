import { RAIN_RECORDS_SEED, RAIN_STATIONS_SEED } from './seed'
import type { RainRecord, RainStation } from './types'

// 雨量域独立持久化：站点台账、报送记录、到达序号分开存放，不与通用条目混用。
const STATION_KEY = 'drainage-pump:rain-stations'
const RECORD_KEY = 'drainage-pump:rain-records'
const SEQ_KEY = 'drainage-pump:rain-seq'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

let stationsCache: RainStation[] | null = null
let recordsCache: RainRecord[] | null = null
let seqCache: number | null = null

export function listStations(): RainStation[] {
  if (stationsCache === null) {
    stationsCache = read(STATION_KEY, RAIN_STATIONS_SEED)
  }
  return stationsCache
}

export function saveStations(stations: RainStation[]): void {
  stationsCache = stations
  write(STATION_KEY, stations)
}

export function listRainRecords(): RainRecord[] {
  if (recordsCache === null) {
    recordsCache = read(RECORD_KEY, RAIN_RECORDS_SEED)
  }
  return recordsCache
}

export function saveRainRecords(records: RainRecord[]): void {
  recordsCache = records
  write(RECORD_KEY, records)
}

/** 取全局单调的到达序号：同一站同一时段并发报送时，序号小的先到、先得。 */
export function nextArrivalSeq(): number {
  if (seqCache === null) {
    const start = Math.max(
      ...listRainRecords().map((record) => record.current.arrivalSeq),
      1000,
    )
    seqCache = read(SEQ_KEY, start)
  }
  seqCache += 1
  write(SEQ_KEY, seqCache)
  return seqCache
}

export function resetRainfall(): { stations: RainStation[]; records: RainRecord[] } {
  const stations = clone(RAIN_STATIONS_SEED)
  const records = clone(RAIN_RECORDS_SEED)
  saveStations(stations)
  saveRainRecords(records)
  return { stations, records }
}
