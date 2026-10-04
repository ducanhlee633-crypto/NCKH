const paths = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  schedule: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M7 3v4 M17 3v4 M3 11h18 M8 15h2 M14 15h2',
  assistant: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  pomodoro: 'M9 2h6 M12 6a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z M12 10v4l3 2 M18 5l2 2',
  roadmap: 'M6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z M18 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z M8 5h7a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h7',
  goals: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z M12 11v2',
  stats: 'M4 3v17h17 M8 15v-4 M13 15V7 M18 15V4',
  friends: 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M2 21v-3a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v3 M17 4a4 4 0 0 1 0 7 M18 14a5 5 0 0 1 4 5v2',
  settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 3 M12 17h.01',
  book: 'M12 5v15 M12 5C8 2 4 3 2 4v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-2-1-6-2-10 1Z',
  check: 'm5 12 4 4L19 6',
  arrow: 'M4 12h16 M14 6l6 6-6 6',
  plus: 'M12 5v14 M5 12h14',
}

export default function Icon({ name, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.book} /></svg>
}
