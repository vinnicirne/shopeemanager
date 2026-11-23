import { agents, splitMarketBrief, workflowLabels, workflows, type AgentId, type Run, type Task } from '../../contracts/src/index'

export const officeAgents = Object.fromEntries(agents.map((agent) => [agent.id, agent])) as Record<AgentId, typeof agents[number]>

interface ActivityDetails {
  id: string
  runId: string
  agent: AgentId
  workflow: string
  brief: string
  stage: number
  stages: number
}

export type OfficeActivity = ActivityDetails & (
  | { kind: 'task'; status: Task['status']; attempts: number; ready: boolean }
  | { kind: 'handoff'; from: AgentId }
)

export function officeActivity(runs: Run[]): OfficeActivity[] {
  return runs.flatMap((run) => {
    const stages = workflows[run.workflow]
    const byAgent = new Map(run.tasks.map((task) => [task.agent, task]))
    const tasks = stages.flatMap((group, index) => group.flatMap((agent): OfficeActivity[] => {
      const task = byAgent.get(agent)
      if (!task) return []
      const details = {
        runId: run.id, agent, workflow: workflowLabels[run.workflow], brief: splitMarketBrief(run.brief).brief,
        stage: index + 1, stages: stages.length,
      }
      const events: OfficeActivity[] = []
      const required = stages[index - 1] ?? []
      const predecessors = required.flatMap((id) => {
        const entry = byAgent.get(id)
        return entry?.status === 'done' ? [entry] : []
      })
      const ready = predecessors.length === required.length
      if (ready && (task.status === 'running' || task.status === 'done' || task.attempts > 0)) {
        for (const previous of predecessors) {
          events.push({ ...details, kind: 'handoff', id: `${previous.id}:${task.id}`, from: previous.agent })
        }
      }
      events.push({ ...details, kind: 'task', id: task.id, status: task.status, attempts: task.attempts, ready })
      return events
    }))
    return tasks.reverse()
  })
}

export function activityLabel(entry: OfficeActivity) {
  const name = officeAgents[entry.agent].name
  if (entry.kind === 'handoff') return `${officeAgents[entry.from].name} → ${name}`
  return `${name} · ${{
    queued: 'Na fila', running: 'Em execução', done: 'Concluída', failed: 'Falhou', blocked: 'Bloqueada',
  }[entry.status]}`
}
