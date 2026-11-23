import { useEffect, useRef } from 'react'
import { agents, type AgentId } from '../../contracts/src/index'
import { type OfficeActivity } from './activity'
import { drawFloor, drawDesk, desks, lounge, width, height, type Point } from './floor'
import { startGameLoop } from './upstream/office/engine/gameLoop'
import { getCachedSprite } from './upstream/office/sprites/spriteCache'

export type States = Partial<Record<AgentId, 'Trabalhando' | 'Em pausa' | 'Aguardando'>>

const body = [
  '...hhh...', '..hhhhh..', '..hsssh..', '..sksks..', '..sssss..',
  '...sss...', '..cccc...', '.sccccs..', '.sccccs..', '..cccc...',
  '..pppp...', '..pppp...',
]
const poses = [
  ['..p..p...', '.pp..pp..'],
  ['.pp..pp..', 'pp....pp.'],
  ['..ppp....', '...p.....'],
  ['...pp....', '..ppp....'],
]
const sprites = agents.map((agent) => poses.map((legs) => [...body, ...legs].map((row) =>
  [...row].map((letter) => ({ h: agent.hair, s: agent.skin, k: '#292128', c: agent.color, p: '#363344' })[letter] || ''),
)))

interface Character {
  position: Point
  atDesk: boolean
  path: Point[]
  visits: { start: number; end: number }[]
}

function advance(character: Character, remaining: number) {
  while (character.path.length && remaining > 0) {
    const { position } = character
    const target = character.path[0]
    const distance = Math.hypot(target.x - position.x, target.y - position.y)
    if (distance <= remaining) {
      character.position = character.path.shift()!
      remaining -= distance
    } else {
      character.position = {
        x: position.x + (target.x - position.x) * remaining / distance,
        y: position.y + (target.y - position.y) * remaining / distance,
      }
      break
    }
  }
}

export function Office({ states, activity, onSelect }: { states: States; activity: OfficeActivity[]; onSelect: (id: AgentId) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const labels = useRef<(HTMLButtonElement | null)[]>([])
  const inputs = useRef({ states, activity })
  useEffect(() => { inputs.current = { states, activity } }, [states, activity])
  useEffect(() => {
    let time = 0
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)')
    let observed = inputs.current.activity
    let previous = new Map(observed.map((entry) => [entry.id, entry]))
    let transfers: { from: AgentId; to: AgentId; start: number; end: number }[] = []
    const people: Character[] = agents.map(({ id }, index) => {
      const atDesk = inputs.current.states[id] === 'Trabalhando'
      return { position: atDesk ? desks[index] : lounge[index], atDesk, path: [], visits: [] }
    })
    const floor = document.createElement('canvas')
    floor.width = width * 2
    floor.height = height * 2
    const base = floor.getContext('2d')!
    base.scale(2, 2)
    drawFloor(base)
    let lastPaint = -Infinity
    let paintedStates: States | undefined
    let moving = false

    const loop = startGameLoop(canvas.current!, {
      update: (dt) => {
        time += dt
        if (observed !== inputs.current.activity) {
          observed = inputs.current.activity
          const changes = observed.filter((entry) => {
            const old = previous.get(entry.id)
            if (entry.kind === 'handoff') return !old
            return entry.status === 'done' && entry.attempts > 0 && (old?.kind !== 'task' || old.status === 'queued')
          })
          const firstStage = new Map<string, number>()
          for (const entry of changes) firstStage.set(entry.runId, Math.min(firstStage.get(entry.runId) ?? entry.stage, entry.stage))
          for (const entry of changes) {
            // Replay short, recorded stages in order when they finish within one polling interval.
            const start = time + (entry.stage - firstStage.get(entry.runId)!) * 0.65
            if (entry.kind === 'handoff') {
              transfers.push({ from: entry.from, to: entry.agent, start, end: start + 0.65 })
            } else {
              const index = agents.findIndex(({ id }) => id === entry.agent)
              people[index].visits.push({ start, end: start + 1.1 })
            }
          }
          previous = new Map(observed.map((entry) => [entry.id, entry]))
        }
        moving = people.some((character) => character.path.length > 0) || transfers.length > 0
        transfers = transfers.filter(({ end }) => end > time)
        people.forEach((character, index) => {
          const state = inputs.current.states[agents[index].id]
          character.visits = character.visits.filter(({ end }) => end > time)
          const atDesk = state === 'Trabalhando' || (state !== 'Em pausa' && character.visits.some(({ start }) => start <= time))
          if (atDesk !== character.atDesk) {
            character.atDesk = atDesk
            character.path = [atDesk ? desks[index] : lounge[index]]
            moving = true
          }
          advance(character, motionPreference.matches ? Infinity : dt * 204)
        })
      },
      render: (ctx) => {
        const { states } = inputs.current
        const typingFrame = !motionPreference.matches && agents.some(({ id }) => states[id] === 'Trabalhando')
          && Math.floor(lastPaint * 7) !== Math.floor(time * 7)
        if (!moving && paintedStates === states && !typingFrame) return
        lastPaint = time
        paintedStates = states
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(floor, 0, 0)
        ctx.scale(2, 2)
        desks.forEach((desk, index) => drawDesk(ctx, desk, states[agents[index].id] === 'Trabalhando'))
        for (const transfer of transfers) {
          if (transfer.start > time || motionPreference.matches) continue
          const from = desks[agents.findIndex(({ id }) => id === transfer.from)]
          const to = desks[agents.findIndex(({ id }) => id === transfer.to)]
          const progress = (time - transfer.start) / (transfer.end - transfer.start)
          const x = Math.round(from.x + (to.x - from.x) * progress)
          const y = Math.round(from.y + (to.y - from.y) * progress - Math.sin(progress * Math.PI) * 20)
          ctx.fillStyle = '#41275d'
          ctx.fillRect(x - 6, y - 11, 12, 10)
          ctx.fillStyle = '#f6bb72'
          ctx.fillRect(x - 4, y - 9, 8, 6)
          ctx.fillStyle = '#925663'
          ctx.fillRect(x - 3, y - 7, 6, 1)
        }
        for (const index of people.map((_, i) => i).sort((a, b) => people[a].position.y - people[b].position.y)) {
          const { position, path, atDesk } = people[index]
          const label = labels.current[index]
          const x = Math.round(position.x)
          const y = Math.round(position.y)
          const walking = path.length > 0
          const frame = walking && !motionPreference.matches ? 1 + Math.floor(time * 12) % 2 : atDesk ? 3 : 0
          const working = states[agents[index].id] === 'Trabalhando'
          const typing = working && !walking && !motionPreference.matches && Math.floor(time * 7) % 2 === 1
          ctx.fillStyle = 'rgba(32,22,34,.25)'
          ctx.fillRect(x - 9, y - 2, 18, 4)
          ctx.drawImage(getCachedSprite(sprites[index][frame], 2), x - 9, y - 27 + (typing ? 1 : 0), 18, 28)
          if (label) {
            label.style.setProperty('--agent-x', `${position.x / width * 100}%`)
            label.style.setProperty('--agent-y', `${(position.y + 3) / height * 100}%`)
            const pose = walking ? 'walking' : atDesk ? 'desk' : 'lounge'
            if (label.dataset.pose !== pose) label.dataset.pose = pose
          }
        }
      },
    })
    loop.redraw()
    return loop.stop
  }, [])
  return <div className="office-stage">
    <canvas ref={canvas} width={width * 2} height={height * 2} aria-hidden="true" />
    {agents.map((agent, index) => <button key={agent.id} ref={(element) => { labels.current[index] = element }}
      className="office-agent" data-working={states[agent.id] === 'Trabalhando'} data-paused={states[agent.id] === 'Em pausa'}
      onClick={() => onSelect(agent.id)} aria-label={`Abrir perfil de ${agent.name}`}>{agent.name}</button>)}
  </div>
}
