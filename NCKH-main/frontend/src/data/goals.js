export function readGoals() {
  const saved = JSON.parse(localStorage.getItem('nhip-hoc-goals') || '[]')
  return Array.isArray(saved) ? saved.filter((goal) => goal && typeof goal.title === 'string').map((goal, index) => ({
    ...goal,
    id: goal.id || `goal-${index}`,
    progress: Number.isFinite(Number(goal.progress)) ? Math.max(0, Math.min(100, Number(goal.progress))) : 0,
  })) : []
}

export function addGoal(goal) {
  localStorage.setItem('nhip-hoc-goals', JSON.stringify([...readGoals(), {
    ...goal, id: crypto.randomUUID(), progress: 0,
  }]))
}
