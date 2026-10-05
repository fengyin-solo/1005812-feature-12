import { defineStore } from 'pinia'

export type OperatorRole = '测报员' | '值班管理员'

export type OperatorIdentity = {
  name: string
  role: OperatorRole
  /** 测报员所属雨量站；值班管理员为空串（可以核对，但不能代任何站填报）。 */
  stationId: string
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '张雨生',
    role: '测报员' as OperatorRole,
    stationId: 'RS01',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市排水防涝泵站运行与内涝处置管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isObserver: (state) => state.role === '测报员',
  },
  actions: {
    switchIdentity(identity: OperatorIdentity) {
      this.operator = identity.name
      this.role = identity.role
      this.stationId = identity.stationId
    },
    setShift(label: string) {
      this.shiftLabel = label
    },
  },
})
