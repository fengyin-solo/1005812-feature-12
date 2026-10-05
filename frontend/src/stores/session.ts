import { defineStore } from 'pinia'

import { IDENTITIES } from '@/domain/rainfall/seed'
import type { SessionIdentity } from '@/domain/rainfall/types'

// 值班会话：纯前端没有登录态，用身份切换来演示「只有本站测报员能填本站数据」。
export const useSessionStore = defineStore('session', {
  state: () => ({
    // 兼容旧外壳字段
    operator: IDENTITIES[0].name,
    shiftLabel: '白班 08:00-20:00',
    scope: '城市排水防涝泵站运行与内涝处置管理平台',
    identity: IDENTITIES[0] as SessionIdentity,
  }),
  getters: {
    canOperate: (state) => state.identity.name.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchIdentity(code: string) {
      const next = IDENTITIES.find((item) => item.code === code)
      if (!next) {
        return
      }
      this.identity = { ...next }
      this.operator = next.name
    },
  },
})
