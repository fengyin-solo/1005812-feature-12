<template>
  <section class="page" data-module="rainfall">
    <header class="page-head">
      <div>
        <h2>雨量监测管理（站点归属）</h2>
        <p class="page-desc">
          每份记录挂在雨量站名下；时段雨量与累计雨量仅本站测报员可填，越站提交一律退回。
          已核对记录整份锁定。累计与时段和相差超 {{ tolerance }} 标待核；同站同时段重复报送按最新存、旧版留痕。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetData">恢复雨量示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">当前身份</span>
        <strong class="stat-value">{{ identity.name }}</strong>
        <span class="stat-sub">{{ identity.role }}{{ myStation ? '·' + myStation.name : '（不属站点）' }}</span>
      </article>
      <article class="stat-card">
        <span class="stat-label">记录总数</span>
        <strong class="stat-value">{{ rows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待核（勾稽超限）</span>
        <strong class="stat-value warn">{{ rows.filter((r) => r.pendingReview).length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已锁定</span>
        <strong class="stat-value">{{ rows.filter((r) => r.locked).length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已上报异常</span>
        <strong class="stat-value warn">{{ rows.filter((r) => r.abnormal).length }}</strong>
      </article>
    </div>

    <p v-if="message" :class="lastOk ? 'ok-text' : 'error-text'" class="form-message">{{ message }}</p>

    <!-- 报送表单 -->
    <form class="report-card" @submit.prevent="submit">
      <h3>{{ form.id ? `重新报送（覆盖第 ${form.version} 版，旧版自动留痕）` : '雨量报送' }}</h3>
      <div class="form-grid">
        <label class="form-item">
          <span>归属雨量站</span>
          <select v-model="form.stationId" :disabled="identity.role === '雨量测报员'">
            <option v-for="station in stations" :key="station.code" :value="station.code">
              {{ station.name }}（{{ station.code }}）
            </option>
          </select>
          <small v-if="identity.role === '雨量测报员'">测报员只能填报本站</small>
          <small v-else class="warn">协调员无填报权，提交将被退回</small>
        </label>
        <label class="form-item">
          <span>报送时段</span>
          <input v-model="form.period" placeholder="如 2026-10-05 10:00-12:00" />
        </label>
      </div>

      <div class="interval-block">
        <div class="interval-head">
          <span>各时段雨量（mm）</span>
          <button class="btn ghost" type="button" @click="addInterval">加一个时段</button>
        </div>
        <div v-for="(item, index) in form.intervals" :key="index" class="interval-row">
          <input v-model="item.slot" placeholder="时段 如 10:00-11:00" />
          <input v-model="item.amount" placeholder="雨量 mm" inputmode="decimal" />
          <button class="link" type="button" @click="removeInterval(index)">删除</button>
        </div>
        <div class="interval-sum">各时段之和：{{ intervalTotal }} mm</div>
      </div>

      <div class="form-grid">
        <label class="form-item">
          <span>累计雨量（mm）</span>
          <input v-model="form.cumulative" placeholder="测报员手填" inputmode="decimal" />
        </label>
        <div class="form-item">
          <span>差值（累计 − 时段和）</span>
          <strong :class="Math.abs(liveDiff) <= toleranceValue ? 'ok-text' : 'warn-text'">
            {{ liveDiff }} mm
          </strong>
          <small>{{ Math.abs(liveDiff) <= toleranceValue ? '在容许范围内' : `超出 ${tolerance}，提交后标为待核` }}</small>
        </div>
      </div>

      <div class="form-actions">
        <button class="btn primary" type="submit">{{ form.id ? '按最新报送覆盖' : '提交报送' }}</button>
        <button v-if="form.id" class="btn ghost" type="button" @click="resetForm">取消重填</button>
      </div>
    </form>

    <!-- 竞态演示 -->
    <section class="race-card">
      <h3>同站同时段竞态报送演示（只留先到的一份）</h3>
      <p class="page-desc">
        选同站两位测报员（{{ sameStationObservers.map((o) => o.name).join(' / ') }}），用同一时段、不同累计值「同时」提交：
        先到者落库，后到者拿不到站点时段锁，原样退回。
      </p>
      <div class="race-controls">
        <label>时段 <input v-model="race.period" placeholder="如 2026-10-05 14:00-15:00" /></label>
        <label>先到者累计 <input v-model="race.firstCum" inputmode="decimal" /></label>
        <label>后到者累计 <input v-model="race.secondCum" inputmode="decimal" /></label>
        <button class="btn primary" type="button" @click="runRace">模拟两人几乎同时提交</button>
      </div>
    </section>

    <!-- 站点改名演示 -->
    <section class="race-card">
      <h3>站点改名（历史不重新归属）</h3>
      <div class="race-controls">
        <select v-model="rename.code">
          <option v-for="station in stations" :key="station.code" :value="station.code">
            {{ station.name }}
          </option>
        </select>
        <input v-model="rename.name" placeholder="新站名" />
        <button class="btn" type="button" @click="doRename">改名（仅协调员）</button>
      </div>
    </section>

    <!-- 记录表 -->
    <table class="data-table">
      <thead>
        <tr>
          <th>编号</th>
          <th>归属站点（现名 / 报送时名）</th>
          <th>报送时段</th>
          <th>测报员</th>
          <th>时段雨量</th>
          <th>时段和</th>
          <th>累计</th>
          <th>差值</th>
          <th>版本/痕迹</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :class="{ locked: row.locked, 'pending-row': row.pendingReview }">
          <td>{{ row.id }}</td>
          <td>
            {{ row.stationCurrentName }}
            <small v-if="row.stationCurrentName !== row.stationNameAtSubmit" class="rename-note">
              （报送时：{{ row.stationNameAtSubmit }}，改名不重归属）
            </small>
          </td>
          <td>{{ row.period }}</td>
          <td>{{ row.observerName }}</td>
          <td>
            <span v-for="(item, i) in row.intervals" :key="i" class="interval-chip">
              {{ item.slot }}:{{ item.amount }}
            </span>
          </td>
          <td>{{ row.intervalTotal }}</td>
          <td>{{ row.cumulative }}</td>
          <td :class="row.withinTolerance ? '' : 'warn-text'">{{ row.diff }}</td>
          <td>
            第{{ row.version }}版
            <button v-if="row.revisions.length" class="link" type="button" @click="openHistory(row)">
              旧版{{ row.revisions.length }}份
            </button>
          </td>
          <td>
            <span v-if="row.locked" class="tag tag-lock">已核对锁定</span>
            <span v-else-if="row.abnormal" class="tag tag-abn">数据异常</span>
            <span v-else-if="row.pendingReview" class="tag tag-pending">待核</span>
            <span v-else class="tag">已采集</span>
            <div v-if="row.abnormal && row.abnormalNote" class="abn-note">{{ row.abnormalNote }}</div>
          </td>
          <td class="row-actions">
            <template v-if="!row.locked">
              <button class="link" type="button" @click="editAsNew(row)">重新报送</button>
              <button class="link" type="button" @click="openVerify(row)">核对锁定</button>
              <button class="link" type="button" @click="openAbnormal(row)">上报异常</button>
            </template>
            <span v-else class="muted">已锁定，谁都不能动</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="11" class="empty-state">暂无雨量记录</td>
        </tr>
      </tbody>
    </table>

    <!-- 历史版本弹窗 -->
    <div v-if="history" class="modal-mask" @click.self="history = null">
      <div class="modal">
        <h3>「{{ history.stationCurrentName }} · {{ history.period }}」历史版本痕迹</h3>
        <p class="page-desc">当前为第 {{ history.version }} 版，下列为被顶替下来的前一版，整份保留。</p>
        <table class="data-table">
          <thead>
            <tr><th>版本</th><th>报送时站名</th><th>测报员</th><th>报送时间</th><th>时段</th><th>累计</th><th>时段和</th><th>差值</th><th>留痕原因</th></tr>
          </thead>
          <tbody>
            <tr v-for="rev in history.revisions" :key="rev.version">
              <td>第{{ rev.version }}版</td>
              <td>{{ rev.stationNameAtSubmit }}</td>
              <td>{{ rev.observerName }}</td>
              <td>{{ rev.submittedAt }}</td>
              <td>
                <span v-for="(item, i) in rev.intervals" :key="i" class="interval-chip">
                  {{ item.slot }}:{{ item.amount }}
                </span>
              </td>
              <td>{{ rev.cumulative }}</td>
              <td>{{ rev.intervalTotal }}</td>
              <td>{{ rev.diff }}</td>
              <td>{{ rev.note }}</td>
            </tr>
          </tbody>
        </table>
        <div class="form-actions"><button class="btn" type="button" @click="history = null">关闭</button></div>
      </div>
    </div>

    <!-- 核对确认 -->
    <div v-if="verifyTarget" class="modal-mask" @click.self="verifyTarget = null">
      <div class="modal">
        <h3>确认核对并整份锁定</h3>
        <p>站点：{{ verifyTarget.stationCurrentName }}；时段：{{ verifyTarget.period }}</p>
        <p>累计 {{ verifyTarget.cumulative }}mm，时段和 {{ verifyTarget.intervalTotal }}mm，差值 {{ verifyTarget.diff }}mm。</p>
        <p v-if="verifyTarget.pendingReview" class="error-text">该记录待核：差值超容许范围，不能核对，请先由本站重新报送修正。</p>
        <div class="form-actions">
          <button class="btn primary" type="button" :disabled="verifyTarget.pendingReview" @click="doVerify">确认核对（锁定后谁都不能再动）</button>
          <button class="btn ghost" type="button" @click="verifyTarget = null">取消</button>
        </div>
      </div>
    </div>

    <!-- 异常上报 -->
    <div v-if="abnormalTarget" class="modal-mask" @click.self="abnormalTarget = null">
      <div class="modal">
        <h3>上报雨量异常（水位监测侧可见）</h3>
        <p>{{ abnormalTarget.stationCurrentName }} · {{ abnormalTarget.period }}</p>
        <textarea v-model="abnormalNote" rows="3" placeholder="说明异常情况，如翻斗式雨量计卡滞、数据突增" class="note-input"></textarea>
        <div class="form-actions">
          <button class="btn primary" type="button" @click="doAbnormal">上报异常</button>
          <button class="btn ghost" type="button" @click="abnormalTarget = null">取消</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import { useSessionStore } from '@/stores/session'
import { IDENTITIES } from '@/domain/rainfall/seed'
import {
  changeStationName,
  listRainfall,
  markAbnormal,
  resetRainfallData,
  stationOptions,
  submitRainfall,
  submitRainfallConcurrent,
  toleranceText,
  toleranceValue,
  verifyRecord,
  type RainfallView,
} from '@/domain/rainfall/service'
import type { RainfallInterval, SubmitRainfallInput } from '@/domain/rainfall/types'

const session = useSessionStore()
const identity = computed(() => session.identity)
const tolerance = toleranceText()

const rows = ref<RainfallView[]>([])
const stations = stationOptions()
const message = ref('')
const lastOk = ref(true)

const myStation = computed(() => stations.find((s) => s.code === identity.value.stationId) ?? null)

const defaultStation = () =>
  identity.value.role === '雨量测报员' && identity.value.stationId
    ? identity.value.stationId
    : stations[0].code

const form = reactive<{
  id: number | null
  version: number
  stationId: string
  period: string
  intervals: RainfallInterval[]
  cumulative: string
}>({
  id: null,
  version: 1,
  stationId: defaultStation(),
  period: '',
  intervals: [
    { slot: '', amount: '' },
    { slot: '', amount: '' },
  ],
  cumulative: '',
})

const intervalTotal = computed(() =>
  Math.round(form.intervals.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) * 100) / 100,
)
const liveDiff = computed(() => {
  const cum = Number(form.cumulative)
  if (form.cumulative.trim() === '' || Number.isNaN(cum)) {
    return 0
  }
  return Math.round((cum - intervalTotal.value) * 100) / 100
})

function addInterval() {
  form.intervals.push({ slot: '', amount: '' })
}
function removeInterval(index: number) {
  form.intervals.splice(index, 1)
}
function resetForm() {
  form.id = null
  form.version = 1
  form.stationId = defaultStation()
  form.period = ''
  form.intervals = [
    { slot: '', amount: '' },
    { slot: '', amount: '' },
  ]
  form.cumulative = ''
}

function submit() {
  const input: SubmitRainfallInput = {
    stationId: form.stationId,
    period: form.period.trim(),
    intervals: form.intervals.filter((item) => item.slot.trim() !== '' || item.amount.trim() !== ''),
    cumulative: form.cumulative.trim(),
  }
  const result = submitRainfall(identity.value, input)
  message.value = result.message
  lastOk.value = result.ok
  if (result.ok) {
    resetForm()
    reload()
  }
}

function editAsNew(row: RainfallView) {
  form.id = row.id
  form.version = row.version
  form.stationId = row.stationId
  form.period = row.period
  form.intervals = row.intervals.map((item) => ({ ...item }))
  form.cumulative = row.cumulative
  message.value = '已载入旧记录，提交即按最新报送覆盖，当前版本会自动进入历史痕迹'
  lastOk.value = true
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// 历史版本
const history = ref<RainfallView | null>(null)
function openHistory(row: RainfallView) {
  history.value = row
}

// 核对
const verifyTarget = ref<RainfallView | null>(null)
function openVerify(row: RainfallView) {
  verifyTarget.value = row
}
function doVerify() {
  if (!verifyTarget.value) {
    return
  }
  const result = verifyRecord(identity.value, verifyTarget.value.id)
  message.value = result.message
  lastOk.value = result.ok
  verifyTarget.value = null
  reload()
}

// 异常
const abnormalTarget = ref<RainfallView | null>(null)
const abnormalNote = ref('')
function openAbnormal(row: RainfallView) {
  abnormalTarget.value = row
  abnormalNote.value = ''
}
function doAbnormal() {
  if (!abnormalTarget.value) {
    return
  }
  const result = markAbnormal(identity.value, abnormalTarget.value.id, abnormalNote.value)
  message.value = result.message
  lastOk.value = result.ok
  abnormalTarget.value = null
  abnormalNote.value = ''
  reload()
}

// 竞态演示
const sameStationObservers = computed(() => {
  const stationId = stations[0].code
  return IDENTITIES.filter((item) => item.role === '雨量测报员' && item.stationId === stationId)
})
const race = reactive({ period: '2026-10-05 14:00-15:00', firstCum: '3.0', secondCum: '8.8' })
function runRace() {
  const [a, b] = sameStationObservers.value
  if (!a || !b) {
    message.value = '需要同站两位测报员才能演示'
    lastOk.value = false
    return
  }
  const mk = (cum: string): SubmitRainfallInput => ({
    stationId: stations[0].code,
    period: race.period.trim(),
    intervals: [{ slot: race.period.trim(), amount: cum }],
    cumulative: cum,
  })
  const { winner, loser } = submitRainfallConcurrent(
    { identity: { ...a }, input: mk(race.firstCum) },
    { identity: { ...b }, input: mk(race.secondCum) },
  )
  message.value = `【先到者 ${a.name}】${winner.message} ｜ 【后到者 ${b.name}】${loser.message}`
  lastOk.value = winner.ok && !loser.ok
  reload()
}

// 改名演示
const rename = reactive({ code: stations[0].code, name: '' })
function doRename() {
  const result = changeStationName(identity.value, rename.code, rename.name)
  message.value = result.message
  lastOk.value = result.ok
  rename.name = ''
  reload()
}

function resetData() {
  resetRainfallData()
  message.value = '雨量站点与记录已恢复为示例数据'
  lastOk.value = true
  reload()
}

function reload() {
  rows.value = listRainfall(identity.value)
}

onMounted(reload)

// 切换身份后：本站测报员的表单归属站跟随身份，并刷新「是否本站」标记。
watch(
  () => identity.value.code,
  () => {
    if (identity.value.role === '雨量测报员' && identity.value.stationId) {
      form.stationId = identity.value.stationId
    }
    reload()
  },
)
</script>

<style scoped>
.stat-sub { display: block; font-size: 12px; color: var(--muted); }
.warn { color: #b54708; }
.warn-text { color: #b42318; font-weight: 600; }
.ok-text { color: #067647; }
.form-message { font-size: 13px; margin: 8px 0; white-space: pre-wrap; }
.report-card, .race-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; }
.report-card h3, .race-card h3 { margin: 0 0 10px; font-size: 14px; }
.form-grid { display: flex; gap: 14px; flex-wrap: wrap; }
.form-item { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.form-item small { color: var(--muted); }
.form-item select, .form-item input, .race-controls input, .race-controls select, .note-input {
  border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 13px;
}
.interval-block { margin: 12px 0; }
.interval-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; margin-bottom: 6px; }
.interval-row { display: flex; gap: 8px; margin-bottom: 6px; }
.interval-row input { flex: 1; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 13px; }
.interval-sum { font-size: 13px; color: var(--muted); }
.form-actions { display: flex; gap: 8px; margin-top: 10px; }
.race-controls { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; font-size: 13px; }
.race-controls label { display: flex; flex-direction: column; gap: 4px; }
.interval-chip { display: inline-block; background: #eef2f7; border-radius: 4px; padding: 1px 6px; margin: 1px 2px; font-size: 12px; }
.rename-note { color: #b54708; }
.tag { display: inline-block; border-radius: 999px; padding: 1px 10px; font-size: 12px; background: #eef2f7; }
.tag-lock { background: #ecfdf3; color: #067647; }
.tag-abn { background: #fef3f2; color: #b42318; }
.tag-pending { background: #fffaeb; color: #b54708; }
.abn-note { font-size: 12px; color: #b42318; margin-top: 2px; }
tr.locked { background: #fafafa; color: var(--muted); }
tr.pending-row { background: #fffdf5; }
.muted { color: var(--muted); font-size: 12px; }
.modal-mask { position: fixed; inset: 0; background: rgba(16, 24, 40, 0.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: #fff; border-radius: 8px; padding: 16px 18px; width: min(860px, 92vw); max-height: 86vh; overflow: auto; }
.note-input { width: 100%; resize: vertical; }
</style>
