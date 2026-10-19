import type { EngineInterface, Register } from 'claude-code'

import { CAMS, encode, frame, hyper, jumpTime, killsAt, ROWS, SHIPS, type CamMode, type Ev, type Res, type Ship } from './frame'

const FRAME_MS = 66 // тик таймера; в обычном полёте рисуем через раз (~10 к/с), в прыжке каждый (~15 к/с)
const EDGE = 4 // столбцы, оставленные пустыми у правого края
const MAX_COLS = 220 // сцена во всю ширину терминала, но не шире этого

// фразы, пока модель думает (mode === 'thinking')
const THINKING = [
  'Варю мысль на медленном огне', 'Спорю сам с собой и проигрываю', 'Гоняю гипотезы по кругу',
  'Делаю вид, что знал это всегда', 'Собираю мозг из запчастей', 'Ищу подвох в собственном ответе',
  'Сверяю с картой реальности', 'Прокачиваю стат «интеллект»', 'Локнулся, не мешай',
  'Думаю дороже, чем стою', 'Чувствую возмущение в Силе', 'Рассчитываю прыжок через гиперпространство',
]

// что говорит /ship и каким цветом строка под сценой
const SHIP_LINE: Record<Ship, string> = {
  xwing: 'X-wing на взлёте. Red Five, standing by',
  tie: 'TIE в строю. Империя одобряет',
  falcon: 'Сокол на ходу. Kessel Run меньше чем за 12 парсеков',
  ywing: 'Y-wing в строю. Gold Leader, заходим на траншею',
  awing: 'A-wing на форсаже. Быстрее только слухи',
  interceptor: 'TIE-перехватчик. Кинжалы наточены',
}
const SHIP_COLOR: Record<Ship, string> = {
  xwing: '#ff6b5a', tie: '#5aff7a', falcon: '#7fd0ff', ywing: '#ffc94a', awing: '#ff7a6a', interceptor: '#5aff7a',
}
// что говорит /cam
const CAM_LINE: Record<CamMode, string> = {
  auto: 'Камера: монтаж, план раз в 6.5 с', side: 'Камера: сбоку', rear: 'Камера: из-за хвоста',
  low: 'Камера: снизу, героический ракурс', front: 'Камера: спереди, летит на нас', top: 'Камера: сверху',
  cockpit: 'Камера: из кабины, прицел на враге',
}
const RES_LINE: Record<Res, string> = {
  quad: 'Разрешение: четвертьблоки 2×2 — работают везде',
  sext: 'Секстанты недоступны: Raster в Claude Code не пускает символы вне BMP. Остаёмся на четвертьблоках',
}
// инструменты, правка которыми — торпеда; остальные — залп лазеров
const TORPEDO_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/

// сегодняшняя дата для счётчика сбитых
const today = () => new Date().toISOString().slice(0, 10)

// случайный элемент массива
const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)]!

// состояние спиннера на ход; переменные модуля — перезагрузка начнёт заново, это ок
const spin = {
  turnAt: 0, working: false, last: '', blit: true, ship: 'xwing' as Ship, cam: 'auto' as CamMode,
  res: 'quad' as Res, seed: 0, events: [] as Ev[], killsToday: 0,
  thought: pick(THINKING), lastMode: '',
  mount: null as { requestId: string; columns: number } | null,
  timer: null as { cancel: () => void } | null, busy: false, tick: 0,
}

// параметры кадра из состояния: сценарий хода, события, разрешение
// секстанты (U+1FB00) Raster не пускает: вне BMP — движок отказывает каждый кадр. Пока только четвертьблоки
const opts = () => ({ seed: spin.seed, events: spin.events, res: 'quad' as Res })

// новый ход: свой сценарий боя и пустой журнал событий
function newTurn(now: number) {
  [spin.working, spin.turnAt] = [true, now]
  spin.seed = Math.floor(Math.random() * 1_000)
  spin.events = []
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
  spin.tick++
  if (jumpTime(now - spin.turnAt) < 0 && spin.tick % 2) return // в покое хватит половины кадров
  const cells = encode(frame(now - spin.turnAt, m.columns, spin.ship, spin.cam, opts()))
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
      if (SHIPS.includes(s as Ship)) spin.ship = s as Ship
      const c = await $.store.get('cam')
      if (CAMS.includes(c as CamMode)) spin.cam = c as CamMode
      const r = await $.store.get('res')
      if (r === 'quad' || r === 'sext') spin.res = r
      const k = await $.store.get(`kills:${today()}`)
      if (typeof k === 'number') spin.killsToday = k
    } catch {
      // нет хранилища — летим на дефолтном
    }
    await $.command.register({ name: 'ship', description: 'Сменить корабль: xwing / ywing / awing / falcon / tie / interceptor' })
    await $.command.register({ name: 'cam', description: 'Камера сцены: auto / side / rear / low / front / top / cockpit' })
    await $.command.register({ name: 'res', description: 'Разрешение сцены: quad (2×2, везде) / sext (2×3, чётче)' })
    return next(e)
  })

  // /ship — следующий корабль по кругу, /ship tie|xwing|falcon — выбрать; выбор помнится между сессиями
  on('command.run', { command: 'ship' }, async ($, e) => {
    const arg = String((e as { args?: string }).args ?? '').trim().toLowerCase()
    spin.ship = SHIPS.includes(arg as Ship) ? (arg as Ship) : SHIPS[(SHIPS.indexOf(spin.ship) + 1) % SHIPS.length]!
    try {
      await $.store.set('ship', spin.ship)
    } catch {
      // запомнится только на эту сессию
    }
    spin.last = ''
    return { text: SHIP_LINE[spin.ship] }
  })

  // /cam — следующий план по кругу, /cam rear — выбрать; auto — монтаж сам режет планы
  on('command.run', { command: 'cam' }, async ($, e) => {
    const arg = String((e as { args?: string }).args ?? '').trim().toLowerCase()
    spin.cam = CAMS.includes(arg as CamMode) ? (arg as CamMode) : CAMS[(CAMS.indexOf(spin.cam) + 1) % CAMS.length]!
    try {
      await $.store.set('cam', spin.cam)
    } catch {
      // запомнится только на эту сессию
    }
    spin.last = ''
    return { text: CAM_LINE[spin.cam] }
  })

  // /res — переключить разрешение; секстанты чётче, но нужен терминал, который их рисует
  on('command.run', { command: 'res' }, async ($, e) => {
    const arg = String((e as { args?: string }).args ?? '').trim().toLowerCase()
    spin.res = 'quad' // sext недоступен: Raster принимает только символы BMP
    try {
      await $.store.set('res', spin.res)
    } catch {
      // запомнится только на эту сессию
    }
    spin.last = ''
    return { text: arg === 'sext' ? RES_LINE.sext : RES_LINE.quad }
  })

  // работа Claude в сцене: инструмент — залп, правка файла — торпеда, ошибка инструмента — попадание по нам
  on('tool.call', async ($, e, next) => {
    if (spin.working) {
      const at = (await $.clock.now()) - spin.turnAt
      spin.events.push({ t: at, kind: TORPEDO_TOOLS.test(e.tool) ? 'torpedo' : 'shot' })
    }
    const r = await next(e)
    if (spin.working && r && typeof r === 'object' && 'isError' in r && r.isError) {
      spin.events.push({ t: (await $.clock.now()) - spin.turnAt, kind: 'hit' })
    }
    if (spin.events.length > 40) spin.events = spin.events.slice(-40) // старые давно отыграли
    return r
  })

  // начало хода: засекаем время (субагент не сбрасывает часы главного хода)
  on('turn.start', async ($, e, next) => {
    if (!spin.working) newTurn(await $.clock.now())
    startTimer($)
    return next(e)
  })

  // конец главного хода: анимация стоп
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) {
      // засчитать сбитых за ход в дневной счёт
      if (spin.working) {
        spin.killsToday += killsAt((await $.clock.now()) - spin.turnAt)
        try {
          await $.store.set(`kills:${today()}`, spin.killsToday)
        } catch {
          // без хранилища счёт живёт до конца сессии
        }
      }
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
    if (!spin.working) newTurn(now) // перезагрузка посреди хода
    startTimer($)
    if (spin.mount?.requestId !== e.requestId) spin.blit = true
    spin.mount = { requestId: e.requestId, columns }
    const t = now - spin.turnAt
    const cells = encode(frame(t, columns, spin.ship, spin.cam, opts()))
    spin.last = cells
    const color = SHIP_COLOR[spin.ship]
    return (
      <Box flexDirection="column">
        <Raster key="sky" columns={columns} rows={ROWS} cells={cells} />
        <Text>
          <Text color={color}>{hyper(t) > 0.3 ? '✦ ' : '✧ '}{text}{e.props.suffix}</Text>
          <Text dimColor> ({elapsed(t)} · сбито {killsAt(t)} · сегодня {spin.killsToday + killsAt(t)})</Text>
        </Text>
      </Box>
    )
  })
}
