import cron from 'node-cron'

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const userTimers = new Map<number, string[]>()

export function scheduleRelative(
  userId: number,
  delayMs: number,
  message: string,
  onFire: (msg: string) => void
) {
  const id = `u${userId}_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const timer = setTimeout(() => {
    onFire(message)
    timers.delete(id)
    const list = userTimers.get(userId)
    if (list) userTimers.set(userId, list.filter(t => t !== id))
  }, delayMs)
  timers.set(id, timer)
  if (!userTimers.has(userId)) userTimers.set(userId, [])
  userTimers.get(userId)!.push(id)
}

export function scheduleCron(
  userId: number,
  schedule: string,
  message: string,
  onFire: (msg: string) => void
) {
  if (!cron.validate(schedule)) {
    console.warn(`Invalid cron: ${schedule}`)
    return
  }
  cron.schedule(schedule, () => {
    onFire(message)
  })
}

export function cancelTimer(userId: number) {
  const ids = userTimers.get(userId)
  if (!ids) return
  ids.forEach((id) => {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
  })
  userTimers.delete(userId)
}
