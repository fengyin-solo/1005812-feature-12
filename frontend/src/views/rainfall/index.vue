<template>
  <section class="page" data-module="rainfall">
    <header class="page-head">
      <div>
        <h2>雨量监测管理</h2>
        <p class="page-desc">
          每份记录挂在雨量站名下，只有本站测报员能填报时段雨量与累计雨量；已核对记录整份锁定。
          累计雨量须与各时段之和对得上，超限标待核；同时段重报覆盖最新版并保留前版痕迹。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出台账</button>
        <button class="btn ghost" type="button" @click="resetDemo">恢复演示数据</button>
      </div>
    </header>

    <div class="identity-bar" :class="store.isObserver ? 'is-observer' : 'is-admin'">
      <strong>当前登录人：{{ store.operator }}（{{ store.role }}<template v-if="store.isObserver"> · {{ ownStationName }}</template>）</strong>
      <span v-if="store.isObserver">
        你只能为「{{ ownStationName }}」填报；选择其他站点提交会被退回。
      </span>
      <span v-else>
        管理员不归属站点，不能代填雨量；可以确认核对（锁定整份）和办理站点改名。
      </span>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div v-if="notice" class="notice-bar" :class="notice.kind" role="status">
      {{ notice.text }}
    </div>

    <div class="work-grid">
      <form class="panel" @submit.prevent="onSubmit">
        <h3 class="panel-title">{{ form.resubmitOf ? '重报（前一版自动留痕）' : '雨量报送' }}</h3>
        <label class="panel-field">
          <span>归属雨量站</span>
          <select v-model="form.stationId" :disabled="form.resubmitOf > 0">
            <option v-for="station in stations" :key="station.id" :value="station.id">
              {{ station.name }}（{{ station.id }}）
            </option>
          </select>
        </label>
        <label class="panel-field">
          <span>报送时段</span>
          <input v-model="form.period" placeholder="如 2026-10-05 08:00-09:00" :disabled="form.resubmitOf > 0" />
        </label>
        <label class="panel-field">
          <span>各分时段雨量(mm)，逗号分隔</span>
          <input v-model="form.intervalsText" placeholder="如 2.5, 4.0, 5.5" />
          <small v-if="intervalPreview.valid" class="field-hint">
            共 {{ intervalPreview.values.length }} 个时段，合计 {{ intervalPreview.sum }}mm；
            累计差值 {{ intervalPreview.diff }}mm（容许 {{ tolerance }}mm）
          </small>
        </label>
        <label class="panel-field">
          <span>累计雨量(mm)</span>
          <input v-model="form.cumulative" placeholder="如 12.0" />
        </label>
        <label class="panel-field">
          <span>采集时间</span>
          <input v-model="form.collectedAt" type="datetime-local" />
        </label>
        <div class="panel-actions">
          <button class="btn primary" type="submit">
            {{ form.resubmitOf ? '提交重报（覆盖当前版）' : '提交报送' }}
          </button>
          <button v-if="form.resubmitOf" class="btn ghost" type="button" @click="cancelResubmit">取消重报</button>
        </div>
      </form>

      <form class="panel" @submit.prevent="onRace">
        <h3 class="panel-title">同站双测报员竞态报送（模拟并发）</h3>
        <label class="panel-field">
          <span>归属雨量站</span>
          <select v-model="race.stationId">
            <option v-for="station in stations" :key="station.id" :value="station.id">
              {{ station.name }}（测报员：{{ station.observers.join('、') || '无' }}）
            </option>
          </select>
        </label>
        <label class="panel-field">
          <span>同一报送时段</span>
          <input v-model="race.period" placeholder="两人必须同一时段才构成竞态" />
        </label>
        <div class="race-cols">
          <div class="race-col">
            <label class="panel-field">
              <span>测报员 A（先发）</span>
              <select v-model="race.reporterA">
                <option v-for="name in raceObservers" :key="name" :value="name">{{ name }}</option>
              </select>
            </label>
            <label class="panel-field">
              <span>A 的分时段雨量</span>
              <input v-model="race.intervalsA" placeholder="如 3.0, 3.0" />
            </label>
            <label class="panel-field">
              <span>A 的累计雨量</span>
              <input v-model="race.cumulativeA" placeholder="如 6.0" />
            </label>
          </div>
          <div class="race-col">
            <label class="panel-field">
              <span>测报员 B（后发）</span>
              <select v-model="race.reporterB">
                <option v-for="name in raceObservers" :key="name" :value="name">{{ name }}</option>
              </select>
            </label>
            <label class="panel-field">
              <span>B 的分时段雨量</span>
              <input v-model="race.intervalsB" placeholder="如 3.5, 3.5" />
            </label>
            <label class="panel-field">
              <span>B 的累计雨量</span>
              <input v-model="race.cumulativeB" placeholder="如 7.0" />
            </label>
          </div>
        </div>
        <label class="panel-field">
          <span>采集时间（两人相同）</span>
          <input v-model="race.collectedAt" type="datetime-local" />
        </label>
        <div class="panel-actions">
          <button class="btn primary" type="submit">同时提交，按到达裁决</button>
        </div>
        <p class="field-hint">裁决口径：只留先到（到达序号小）的一份，后到的整份退回、不进版本痕迹。</p>
      </form>
    </div>

    <section v-if="store.role === '值班管理员'" class="panel station-panel">
      <h3 class="panel-title">站点改名（仅管理员）</h3>
      <p class="field-hint">改名只更新当前站名；历史记录按当时归属站名保留，不会重新归属。</p>
      <div v-for="station in stations" :key="station.id" class="rename-row">
        <span class="rename-name">{{ station.id }} · {{ station.name }}</span>
        <input v-model="renameInputs[station.id]" :placeholder="`将「${station.name}」改名为`" />
        <button class="btn" type="button" @click="onRename(station.id)">更名</button>
      </div>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>归属站点</span>
        <select v-model="filters.stationId">
          <option value="">全部站点</option>
          <option v-for="station in stations" :key="station.id" :value="station.id">
            {{ station.name }}
          </option>
        </select>
      </label>
      <label class="filter-item">
        <span>状态</span>
        <select v-model="filters.status">
          <option value="">全部状态</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>关键字</span>
        <input v-model="filters.keyword" placeholder="编号 / 站名 / 时段 / 报送人" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>记录编号</th>
          <th>归属雨量站</th>
          <th>报送时段</th>
          <th>分时段雨量</th>
          <th>时段之和</th>
          <th>累计雨量</th>
          <th>勾稽差值</th>
          <th>状态</th>
          <th>报送人/到达</th>
          <th>版本痕迹</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="row.id">
          <tr :class="{ 'is-locked': row.locked, 'is-abnormal': row.abnormal }">
            <td>{{ row.recordNo }}</td>
            <td>
              {{ row.stationName }}
              <span class="cell-sub">{{ row.stationId }}</span>
              <span v-if="currentName(row.stationId) !== row.stationName" class="rename-tag">
                现已更名：{{ currentName(row.stationId) }}
              </span>
            </td>
            <td>{{ row.period }}</td>
            <td>{{ row.current.intervalValues.join('、') }}</td>
            <td>{{ row.current.intervalSum }}</td>
            <td>{{ row.current.cumulative }}</td>
            <td>
              <span :class="['diff-tag', row.discrepancy > row.tolerance ? 'bad' : 'ok']">
                {{ row.discrepancy }} / 容许 {{ row.tolerance }}
              </span>
            </td>
            <td>
              <span :class="['status-tag', statusClass(row.status)]">{{ row.status }}</span>
              <span v-if="row.locked" class="lock-tag">🔒 已锁定</span>
            </td>
            <td>
              {{ row.current.reporter }}
              <span class="cell-sub">序号 {{ row.current.arrivalSeq }}</span>
            </td>
            <td>
              <button class="link" type="button" @click="toggleVersions(row.id)">
                {{ expandedId === row.id ? '收起痕迹' : `查看痕迹（${row.versions.length}）` }}
              </button>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="prefillResubmit(row)">
                撤回重报
              </button>
              <button class="link" type="button" @click="onMarkAbnormal(row)">标记异常并通报水位侧</button>
              <button
                v-if="store.role === '值班管理员'"
                class="link"
                type="button"
                @click="onVerify(row)"
              >
                确认核对（锁定）
              </button>
            </td>
          </tr>
          <tr v-if="expandedId === row.id" class="version-row">
            <td colspan="11">
              <table class="version-table">
                <thead>
                  <tr>
                    <th>版本</th>
                    <th>分时段雨量</th>
                    <th>时段之和</th>
                    <th>累计雨量</th>
                    <th>采集时间</th>
                    <th>报送人</th>
                    <th>到达序号</th>
                    <th>被替换时间</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="version in [...row.versions].reverse()" :key="version.version">
                    <td>第 {{ version.version }} 版（已被替换）</td>
                    <td>{{ version.snapshot.intervalValues.join('、') }}</td>
                    <td>{{ version.snapshot.intervalSum }}</td>
                    <td>{{ version.snapshot.cumulative }}</td>
                    <td>{{ version.snapshot.collectedAt }}</td>
                    <td>{{ version.snapshot.reporter }}</td>
                    <td>{{ version.snapshot.arrivalSeq }}</td>
                    <td>{{ formatTime(version.replacedAt) }}</td>
                  </tr>
                  <tr class="current-version">
                    <td>当前版（第 {{ row.versions.length + 1 }} 版）</td>
                    <td>{{ row.current.intervalValues.join('、') }}</td>
                    <td>{{ row.current.intervalSum }}</td>
                    <td>{{ row.current.cumulative }}</td>
                    <td>{{ row.current.collectedAt }}</td>
                    <td>{{ row.current.reporter }}</td>
                    <td>{{ row.current.arrivalSeq }}</td>
                    <td>—</td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td colspan="11" class="empty-state">暂无雨量监测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条雨量记录（历史归属站名随记录固化，站点改名不影响旧记录）</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import {
  RAIN_TOLERANCE_MM,
  exportRainfallCsv,
  listRainfall,
  markRainfallAbnormal,
  renameRainStation,
  submitRainfall,
  submitRainfallRace,
  verifyRainfall,
} from '@/data/rainfall/service'
import { listStations, resetRainfall } from '@/data/rainfall/store'
import type { RainRecord } from '@/data/rainfall/types'
import type { OperatorIdentity } from '@/stores/session'
import { useSessionStore } from '@/stores/session'

// 导出 CSV：文件名和编码由雨量域服务统一给出。
function downloadRainfallCsvLocal() {
  const { filename, content } = exportRainfallCsv()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

const store = useSessionStore()
const tolerance = RAIN_TOLERANCE_MM
const statuses = ['已采集', '待核', '已核对', '数据异常']

const stations = ref(listStations())
const rows = ref<RainRecord[]>([])
const expandedId = ref<number | null>(null)
const notice = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)

const filters = reactive({ stationId: '', status: '', keyword: '' })
const renameInputs = reactive<Record<string, string>>({})

const form = reactive({
  stationId: store.stationId || stations.value[0]?.id || '',
  period: '',
  intervalsText: '',
  cumulative: '',
  collectedAt: '',
  resubmitOf: 0,
})

const race = reactive({
  stationId: 'RS01',
  period: '',
  reporterA: '张雨生',
  reporterB: '李秀兰',
  intervalsA: '',
  cumulativeA: '',
  intervalsB: '',
  cumulativeB: '',
  collectedAt: '',
})

const ownStationName = computed(
  () => stations.value.find((station) => station.id === store.stationId)?.name ?? store.stationId,
)

const raceObservers = computed(
  () => stations.value.find((station) => station.id === race.stationId)?.observers ?? [],
)

watch(
  () => [store.stationId, store.role] as const,
  ([stationId, role]) => {
    if (role === '测报员' && !form.resubmitOf) {
      form.stationId = stationId
    }
  },
)

watch(
  () => race.stationId,
  (stationId) => {
    const observers = stations.value.find((station) => station.id === stationId)?.observers ?? []
    if (!observers.includes(race.reporterA)) {
      race.reporterA = observers[0] ?? ''
    }
    if (!observers.includes(race.reporterB)) {
      race.reporterB = observers[1] ?? observers[0] ?? ''
    }
  },
)

const intervalPreview = computed(() => {
  const values = parseIntervals(form.intervalsText)
  if (!values) {
    return { valid: false, values: [] as number[], sum: 0, diff: 0 }
  }
  const sum = round1(values.reduce((total, value) => total + value, 0))
  const cumulative = Number(form.cumulative)
  const diff = Number.isNaN(cumulative) ? 0 : round1(Math.abs(cumulative - sum))
  return { valid: true, values, sum, diff }
})

const stats = computed(() => [
  { label: '在册雨量站', value: stations.value.length },
  { label: '待核记录', value: rows.value.filter((row) => row.status === '待核').length },
  { label: '已锁定记录', value: rows.value.filter((row) => row.locked).length },
  { label: '异常通报中', value: rows.value.filter((row) => row.abnormal).length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function parseIntervals(text: string): number[] | null {
  const parts = text
    .split(/[,，;；\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) {
    return null
  }
  const values = parts.map((part) => Number(part))
  if (values.some((value) => Number.isNaN(value) || value < 0)) {
    return null
  }
  return values.map((value) => round1(value))
}

function identityOf(): OperatorIdentity {
  return { name: store.operator, role: store.role, stationId: store.stationId }
}

function currentName(stationId: string): string {
  return stations.value.find((station) => station.id === stationId)?.name ?? stationId
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function statusClass(status: string): string {
  return {
    已采集: 'st-collected',
    待核: 'st-pending',
    已核对: 'st-verified',
    数据异常: 'st-abnormal',
  }[status] ?? ''
}

function showNotice(kind: 'ok' | 'err', text: string) {
  notice.value = { kind, text }
}

function reload() {
  stations.value = listStations()
  rows.value = listRainfall({
    stationId: filters.stationId,
    status: filters.status,
    keyword: filters.keyword,
  })
}

function resetFilters() {
  filters.stationId = ''
  filters.status = ''
  filters.keyword = ''
  reload()
}

function exportRows() {
  downloadRainfallCsvLocal()
}

function resetDemo() {
  resetRainfall()
  stations.value = listStations()
  reload()
  showNotice('ok', '雨量站点台账与报送记录已恢复为演示数据')
}

function toggleVersions(id: number) {
  expandedId.value = expandedId.value === id ? null : id
}

function onSubmit() {
  notice.value = null
  const values = parseIntervals(form.intervalsText)
  if (!values) {
    showNotice('err', '各分时段雨量需为不小于 0 的数字，用逗号分隔')
    return
  }
  const result = submitRainfall(
    form.stationId,
    {
      period: form.period,
      intervalValues: values,
      cumulative: Number(form.cumulative),
      collectedAt: form.collectedAt.replace('T', ' '),
    },
    identityOf(),
  )
  showNotice(result.ok ? 'ok' : 'err', result.message)
  if (result.ok) {
    form.period = ''
    form.intervalsText = ''
    form.cumulative = ''
    form.collectedAt = ''
    form.resubmitOf = 0
    if (store.isObserver) {
      form.stationId = store.stationId
    }
  }
  reload()
}

function prefillResubmit(row: RainRecord) {
  if (row.locked) {
    showNotice('err', `${row.recordNo} 已核对锁定，谁都不能再动，重报入口关闭`)
    return
  }
  if (store.role !== '测报员' || store.stationId !== row.stationId) {
    showNotice(
      'err',
      `重报被拒绝：时段雨量只有本站测报员能填，你当前不属于「${currentName(row.stationId)}」`,
    )
    return
  }
  form.stationId = row.stationId
  form.period = row.period
  form.intervalsText = row.current.intervalValues.join(', ')
  form.cumulative = String(row.current.cumulative)
  form.collectedAt = row.current.collectedAt.replace(' ', 'T')
  form.resubmitOf = row.id
  showNotice('ok', `已按 ${row.recordNo} 当前内容填好报送面板，提交后前一版会自动留痕`)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function cancelResubmit() {
  form.resubmitOf = 0
  form.period = ''
  form.intervalsText = ''
  form.cumulative = ''
  form.collectedAt = ''
  if (store.isObserver) {
    form.stationId = store.stationId
  }
}

function onMarkAbnormal(row: RainRecord) {
  if (row.locked) {
    showNotice('err', `${row.recordNo} 已核对锁定，不能再标记异常`)
    return
  }
  if (store.role !== '测报员' || store.stationId !== row.stationId) {
    showNotice(
      'err',
      `越权操作被退回：异常只能由「${currentName(row.stationId)}」本站测报员上报`,
    )
    return
  }
  const text = window.prompt(`为 ${row.recordNo} 填写异常情况说明（将通报水位监测侧）`, row.notice)
  if (text === null) {
    return
  }
  const result = markRainfallAbnormal(row.id, text, identityOf())
  showNotice(result.ok ? 'ok' : 'err', result.message)
  reload()
}

function onVerify(row: RainRecord) {
  const result = verifyRainfall(row.id, identityOf())
  showNotice(result.ok ? 'ok' : 'err', result.message)
  reload()
}

function onRename(stationId: string) {
  const result = renameRainStation(stationId, renameInputs[stationId] ?? '', identityOf())
  showNotice(result.ok ? 'ok' : 'err', result.message)
  if (result.ok) {
    renameInputs[stationId] = ''
  }
  reload()
}

function onRace() {
  const valuesA = parseIntervals(race.intervalsA)
  const valuesB = parseIntervals(race.intervalsB)
  if (!valuesA || !valuesB) {
    showNotice('err', '两人的分时段雨量都需为不小于 0 的数字')
    return
  }
  const { winner, loser } = submitRainfallRace(
    race.stationId,
    race.period,
    {
      reporter: race.reporterA,
      input: {
        period: race.period,
        intervalValues: valuesA,
        cumulative: Number(race.cumulativeA),
        collectedAt: race.collectedAt.replace('T', ' '),
      },
    },
    {
      reporter: race.reporterB,
      input: {
        period: race.period,
        intervalValues: valuesB,
        cumulative: Number(race.cumulativeB),
        collectedAt: race.collectedAt.replace('T', ' '),
      },
    },
  )
  showNotice(
    winner.ok ? 'ok' : 'err',
    winner.ok ? `【先到】${winner.message}　【后到】${loser.message}` : winner.message,
  )
  reload()
}

reload()
</script>

<style scoped>
.identity-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: #fff;
  font-size: 13px;
}
.identity-bar.is-observer { border-left: 4px solid var(--brand); }
.identity-bar.is-admin { border-left: 4px solid #b54708; }
.identity-bar strong { white-space: nowrap; }

.work-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}
.panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin: 0;
}
.panel-title { margin: 0 0 8px; font-size: 14px; }
.panel-field { display: block; margin-bottom: 8px; font-size: 12px; color: var(--muted); }
.panel-field input,
.panel-field select,
.rename-row input {
  width: 100%;
  margin-top: 2px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
}
.panel-field input:disabled { background: #f1f5f9; }
.panel-actions { display: flex; gap: 8px; }
.field-hint { display: block; margin-top: 4px; color: var(--muted); }
.race-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.station-panel { margin-bottom: 12px; }
.rename-row {
  display: grid;
  grid-template-columns: 220px 1fr auto;
  gap: 10px;
  align-items: center;
  margin-bottom: 6px;
}
.rename-name { font-size: 13px; }

.notice-bar {
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
  border: 1px solid;
}
.notice-bar.ok { background: #ecfdf3; border-color: #6ce9a6; color: #027a48; }
.notice-bar.err { background: #fef3f2; border-color: #fda29b; color: #b42318; }

.cell-sub { display: block; color: var(--muted); font-size: 12px; }
.rename-tag {
  display: inline-block;
  margin-top: 2px;
  font-size: 12px;
  color: #b54708;
  background: #fffaeb;
  border-radius: 4px;
  padding: 0 6px;
}
.diff-tag { border-radius: 999px; padding: 1px 8px; font-size: 12px; }
.diff-tag.ok { background: #ecfdf3; color: #027a48; }
.diff-tag.bad { background: #fef3f2; color: #b42318; }
.status-tag { border-radius: 999px; padding: 1px 8px; font-size: 12px; }
.st-collected { background: #eef4ff; color: #1d4ed8; }
.st-pending { background: #fffaeb; color: #b54708; }
.st-verified { background: #ecfdf3; color: #027a48; }
.st-abnormal { background: #fef3f2; color: #b42318; }
.lock-tag { margin-left: 6px; font-size: 12px; color: #027a48; }

tr.is-locked { background: #f8fafc; }
tr.is-abnormal { background: #fff7f6; }
.version-table { width: 100%; background: #f8fafc; }
.version-table th, .version-table td { padding: 6px 8px; font-size: 12px; }
.current-version { font-weight: 600; background: #eef4ff; }
</style>
