import type { EngineInterface, Register } from 'claude-code'

import { encode, frame, hyper, ROWS, type Ship } from './frame'

const FRAME_MS = 100 // 10 кадров в секунду: глазу хватает, терминалу легче
const EDGE = 4 // столбцы, оставленные пустыми у правого края
const MAX_COLS = 72 // сцена не шире этого: меньше клеток на кадр на широком экране

// фразы, пока модель думает (mode === 'thinking')
const THINKING = [
  'Варю мысль на медленном огне', 'Спорю сам с собой и проигрываю', 'Гоняю гипотезы по кругу',
  'Делаю вид, что знал это всегда', 'Собираю мозг из запчастей', 'Ищу подвох в собственном ответе',
  'Сверяю с картой реальности', 'Прокачиваю стат «интеллект»', 'Локнулся, не мешай',
  'Думаю дороже, чем стою', 'Чувствую возмущение в Силе', 'Рассчитываю прыжок через гиперпространство',
]

// случайный элемент массива
const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)]!

// состояние спиннера на ход; переменные модуля — перезагрузка начнёт заново, это ок
const spin = {
  turnAt: 0, working: false, last: '', blit: true, ship: 'xwing' as Ship,
  thought: pick(THINKING), lastMode: '',
  mount: null as { requestId: string; columns: number } | null,
  timer: null as { cancel: () => void } | null, busy: false,
}

// время хода в виде «12s» / «1m 05s»
const elapsed = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

// один тик анимации: перерисовать сетку через blit, без полного рендера
async function paint($: EngineInterface) {
  const m = spin.mount
  if (!m || !spin.working || spin.busy) return // прошлый кадр ещё в пути — пропускаем, не копим очередь
  spin.busy = true
  try {
    await paintOnce($, m)
  } finally {
    spin.busy = false
  }
}

// отрисовать один кадр в смонтированную сетку
async function paintOnce($: EngineInterface, m: { requestId: string; columns: number }) {
  const now = await $.clock.now()
  const cells = encode(frame(now - spin.turnAt, m.columns, spin.ship))
  if (cells === spin.last) return
  spin.last = cells
  if (!spin.blit) {
    $.ui.invalidate('ui.render')
    return
  }
  const r = await $.ui.blit({ requestId: m.requestId, key: 'sky', cells })
  if ('deny' in r && r.deny) {
    spin.blit = false
    $.ui.invalidate('ui.render')
  }
}

// завести таймер анимации, если ещё не идёт
function startTimer($: EngineInterface) {
  if (!spin.timer) spin.timer = $.clock.every(FRAME_MS, () => void paint($))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (!e.isInteractive) return next(e)
    try {
      const s = await $.store.get('ship')
      if (s === 'tie' || s === 'xwing') spin.ship = s
    } catch {
      // нет хранилища — летим на дефолтном
    }
    await $.command.register({ name: 'ship', description: 'Сменить корабль в спиннере: xwing / tie' })
    return next(e)
  })

  // /ship — переключить, /ship tie или /ship xwing — выбрать; выбор помнится между сессиями
  on('command.run', { command: 'ship' }, async ($, e) => {
    const arg = String((e as { args?: string }).args ?? '').trim().toLowerCase()
    spin.ship = arg === 'tie' || arg === 'xwing' ? arg : spin.ship === 'xwing' ? 'tie' : 'xwing'
    try {
      await $.store.set('ship', spin.ship)
    } catch {
      // запомнится только на эту сессию
    }
    spin.last = ''
    return { text: spin.ship === 'xwing' ? 'X-wing на взлёте. Red Five, standing by' : 'TIE в строю. Империя одобряет' }
  })

  // начало хода: засекаем время (субагент не сбрасывает часы главного хода)
  on('turn.start', async ($, e, next) => {
    if (!spin.working) [spin.working, spin.turnAt] = [true, await $.clock.now()]
    startTimer($)
    return next(e)
  })

  // конец главного хода: анимация стоп
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) {
      [spin.working, spin.mount] = [false, null]
      spin.timer?.cancel() // между ходами таймер не тикает вообще
      spin.timer = null
    }
    return done
  })

  // сцена над строкой спиннера; узкий терминал или не терминал — обычный спиннер со своими фразами
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const mode = e.props.mode
    if (mode === 'thinking' && spin.lastMode !== 'thinking') spin.thought = pick(THINKING)
    spin.lastMode = mode
    const word = mode === 'thinking' ? spin.thought : e.props.word
    const text = e.props.message ?? word

    const columns = Math.min(MAX_COLS, (e.viewport?.columns ?? 0) - EDGE)
    if (e.surface !== 'terminal' || columns < 40) {
      spin.mount = null
      return next({ ...e, props: { ...e.props, word } })
    }
    const { Raster, Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    if (!spin.working) [spin.working, spin.turnAt] = [true, now] // перезагрузка посреди хода
    startTimer($)
    if (spin.mount?.requestId !== e.requestId) spin.blit = true
    spin.mount = { requestId: e.requestId, columns }
    const t = now - spin.turnAt
    const cells = encode(frame(t, columns, spin.ship))
    spin.last = cells
    const color = spin.ship === 'xwing' ? '#ff6b5a' : '#5aff7a'
    return (
      <Box flexDirection="column">
        <Raster key="sky" columns={columns} rows={ROWS} cells={cells} />
        <Text>
          <Text color={color}>{hyper(t) > 0.3 ? '✦ ' : '✧ '}{text}{e.props.suffix}</Text>
          <Text dimColor> ({elapsed(t)})</Text>
        </Text>
      </Box>
    )
  })
}
