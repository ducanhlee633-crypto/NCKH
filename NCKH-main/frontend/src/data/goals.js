export function readGoals() {
  const saved = JSON.parse(localStorage.getItem('nhip-hoc-goals') || '[]')
  return Array.isArray(saved) ? saved.filter((goal) => goal && typeof goal.title === 'string').map((goal, index) => ({
    ...goal,
    id: goal.id || `goal-${index}`,
    status: goal.status === 'completed' ? 'completed' : 'in_progress',
  })) : []
}

export function addGoal(goal) {
  localStorage.setItem('nhip-hoc-goals', JSON.stringify([...readGoals(), {
    ...goal, id: crypto.randomUUID(), status: 'in_progress',
  }]))
}
