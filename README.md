# hyperspace

A Claude Code mod that replaces the spinner with a space battle. While Claude works, a real 3D scene plays under the prompt: your ship dodges and rolls, enemies make attack runs, lasers and proton torpedoes fly, and every 34 seconds it makes a cinematic jump to hyperspace.

<img src="assets/scene.webp" alt="An X-wing dogfight rendered in terminal quarter-blocks, ending in a jump to hyperspace" width="100%">

## Install

```
/plugin marketplace add alexregrets/hyperspace
/plugin install hyperspace@hyperspace
```

Or try it for one session from a clone: `claude --plugin-dir ./hyperspace`.

## Use

- `/ship` picks the ship: `xwing`, `ywing`, `awing`, `falcon`, `tie`, `interceptor`. The choice persists across sessions.
- `/cam` picks the camera: `auto` cuts between shots, or lock one of `side`, `rear`, `low`, `front`, `top`, `cockpit`.
- Claude's work shows up in the fight: a tool call fires a volley, a file edit launches a torpedo, an error is a hit on you. The line under the scene counts kills.
- While Claude is thinking, the spinner shows its own phrases. They are in Russian because that is who it was built for. Edit `THINKING` in `hooks/register.tsx` to make them yours.

## How it works

`hooks/three.ts` is a small software rasterizer: triangle meshes for six ships, a star destroyer and asteroids, a perspective camera, a shared z-buffer, Lambert and Blinn shading with rim light and point lights for explosions. `hooks/frame.ts` builds a frame as a pure function `frame(t, columns, ship, cam)`, so the same `t` always gives the same picture. The HDR buffer goes through bloom and an anamorphic flare, then tone mapping, then every 2×2 block of pixels becomes one terminal cell: a quarter-block glyph (`▘ ▝ ▖ ▗`) plus the two colors that fit it best.

The jump has four beats: stars stretch into rays from the vanishing point, the ship lurches forward and collapses into a point with a flash, a blue tunnel streams past with a white core, then the tunnel tears and the rays snap back into stars.

It stays cheap on purpose:

- the timer runs only during a turn and is cancelled at `turn.complete`;
- a frame is skipped if the previous blit is still in flight;
- about 10 fps in flight, 15 during the jump, 3 to 6 ms per frame at 200 columns (`node tools/bench_jump.mts`).

On surfaces other than the terminal, or in terminals narrower than 40 columns, you get the normal spinner with the custom phrase.

## Render a clip

```
HYPERSPACE_DIR=. node tools/render_scene.mts out.raw xwing auto 100 3000 23000 15
python tools/to_webp.py out.raw scene.webp 200 24 15
```

## Test

```
claude plugin test .
```

## License

MIT
