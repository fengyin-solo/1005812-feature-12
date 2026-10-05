<template>
  <section class="page" data-module="waterlevel">
    <header class="page-head">
      <div>
        <h2>水位监测管理</h2>
        <p class="page-desc">维护水位监测记录，围绕监测编号、监测点位、水位读数、警戒水位做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记水位监测记录</button>
        <button class="btn" type="button" @click="exportRows">导出水位监测清单</button>
      </div>
    </header>

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

    <section class="rain-alerts" :class="{ empty: !rainAlerts.length }">
      <header class="rain-alerts-head">
        <h3>雨量站异常通报（雨量监测侧上报）</h3>
        <span>{{ rainAlerts.length }} 条待关注</span>
      </header>
      <table v-if="rainAlerts.length" class="data-table">
        <thead>
          <tr>
            <th>雨量记录</th>
            <th>上报站点</th>
            <th>报送时段</th>
            <th>测报员</th>
            <th>异常情况</th>
            <th>上报时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="alert in rainAlerts" :key="alert.recordId">
            <td>{{ alert.recordNo }}</td>
            <td>
              {{ alert.stationName }}
              <span class="alert-sub">{{ alert.stationId }}<template v-if="alert.currentStationName !== alert.stationName">
                ，现名「{{ alert.currentStationName }}」
              </template></span>
            </td>
            <td>{{ alert.period }}</td>
            <td>{{ alert.reporter }}</td>
            <td>{{ alert.notice }}</td>
            <td>{{ formatTime(alert.receivedAt) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="alert-empty">当前没有雨量站上报异常；雨量记录一旦被本站测报员标记异常，会立即出现在这里。</p>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无水位监测数据，可先登记水位监测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条水位监测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listRainfallAlerts } from '@/data/rainfall/service'
import type { EntryRow } from '@/data/types'
import type { RainAlert } from '@/data/rainfall/types'

const meta = moduleMeta('waterlevel')
const columns = ["监测编号", "监测点位", "水位读数", "警戒水位", "采集时间", "监测人", "超标判定", "监测状态"]
const actions = ["提交采集", "判定正常", "标记超警戒"]
const statuses = ["待采集", "已采集", "水位正常", "超警戒"]
const stats = [{"label": "待采集点位", "value": 0}, {"label": "水位正常点位", "value": 0}, {"label": "超警戒点位数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
// 雨量站上报的异常：本站测报员标记后，水位监测侧在本面板直接看到。
const rainAlerts = ref<RainAlert[]>([])

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '水位监测记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    rainAlerts.value = listRainfallAlerts()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水位监测列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.rain-alerts {
  background: #fff;
  border: 1px solid #fda29b;
  border-left-width: 4px;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.rain-alerts.empty { border-color: var(--border); border-left-color: #12b76a; }
.rain-alerts-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.rain-alerts-head h3 { margin: 0; font-size: 14px; }
.alert-sub { display: block; color: var(--muted); font-size: 12px; }
.alert-empty { margin: 0; color: var(--muted); font-size: 13px; }
</style>
