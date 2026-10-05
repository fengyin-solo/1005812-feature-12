import { RAINFALL_STATIONS, seedRainfallRecords } from './seed'
import type { RainfallRecord, RainfallStation } from './types'

// 雨量域独立存放，和通用 entries 存储互不干扰。
const STATIONS_KEY = 'drainage-pump:rainfall-stations'
const RECORDS_KEY = 'drainage-pump:rainfall-records'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function read<T>(key: string, fallback: () => T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback()
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    const seeded = fallback()
    window.localStorage.setItem(key, JSON.stringify(seeded))
    return seeded
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    const seeded = fallback()
    window.localStorage.setItem(key, JSON.stringify(seeded))
    return seeded
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

let stationCache: RainfallStation[] | null = null
let recordCache: RainfallRecord[] | null = null

export function listStations(): RainfallStation[] {
  if (stationCache === null) {
    stationCache = read(STATIONS_KEY, () => clone(RAINFALL_STATIONS))
  }
  return stationCache
}

export function getStation(code: string): RainfallStation | undefined {
  return listStations().find((station) => station.code === code)
}

// 站点改名：只改档案显示名。历史记录的 stationNameAtSubmit 快照不动 → 历史不重新归属。
export function renameStation(code: string, name: string): void {
  const stations = listStations().map((station) =>
    station.code === code ? { ...station, name } : station,
  )
  stationCache = stations
  write(STATIONS_KEY, stations)
}

export function listRecords(): RainfallRecord[] {
  if (recordCache === null) {
    recordCache = read(RECORDS_KEY, () => seedRainfallRecords())
  }
  return recordCache
}

export function saveRecords(records: RainfallRecord[]): void {
  recordCache = records
  write(RECORDS_KEY, records)
}

export function resetRainfall(): { stations: RainfallStation[]; records: RainfallRecord[] } {
  stationCache = clone(RAINFALL_STATIONS)
  recordCache = seedRainfallRecords()
  write(STATIONS_KEY, stationCache)
  write(RECORDS_KEY, recordCache)
  return { stations: stationCache, records: recordCache }
}
