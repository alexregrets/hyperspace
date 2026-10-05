# hyperspace

A Claude Code mod that replaces the spinner with a little space battle. While Claude works, an X-wing (or a TIE fighter) flies through a three-layer parallax starfield, fires laser volleys, and jumps to hyperspace every 24 seconds.

```
  ·        ∙            ─ ─       ·          ∙
 ▄▄▄▄▄▄▄▄▄▄▄▄▄▄       ━━━      ·        ─ ─
 ▀███████████████▀            ∙
 ▄███████▀▀▀█████▄      ━━━         ·
  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀  ·           ∙
✧ Calculating the jump to hyperspace… (12s)
```

## Install

```
/plugin marketplace add alexregrets/hyperspace
/plugin install hyperspace@hyperspace
```

Or try it for one session from a clone: `claude --plugin-dir ./hyperspace`.

## Use

- `/ship` toggles X-wing ↔ TIE. `/ship tie` or `/ship xwing` picks one. The choice persists across sessions.
- The spinner line takes the faction color: red for the Rebels, green for the Empire.
- While Claude is thinking, the spinner shows its own phrases. They are in Russian because that is who it was built for. Edit `THINKING` in `hooks/register.tsx` to make them yours.

## How it works

The scene is one `Raster` drawn in a `ui.render` hook on `Spinner`, repainted with `$.ui.blit` at 10 fps without a render pass. `hooks/frame.ts` is a pure function `frame(t, columns, ship)` that writes cells straight into a `Uint32Array`: stars come from a deterministic hash, so they stay put between frames, and the ship is a sprite of half-blocks (`▀ ▄ █`, two pixels per cell).

It stays cheap on purpose:

- the animation timer runs only during a turn and is cancelled at `turn.complete`;
- a frame is skipped if the previous blit is still in flight, so frames never queue up;
- the scene is capped at 72 columns;
- star positions are cached per width.

On surfaces other than the terminal, or in terminals narrower than 40 columns, you get the normal spinner with the custom phrase.

## Test

```
claude plugin test .
```

## License

MIT
