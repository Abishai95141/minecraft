# SowmiCraft

A Minecraft-style voxel game that runs in the browser, built from scratch — plus a
10-minute story campaign, *The Ember of Sowmi*.

**No dependencies. No build step. No binary assets.** Every texture, the font, the
logo, the mob skins and all the audio are generated in code at runtime. The whole game
is a folder of ES modules you can open with any static server.

> **Status: in progress.** The foundation is complete; the engine on top of it is not
> yet written, so it does not run today. See [`RESUME.md`](RESUME.md) for exactly
> what is done and what is left.

## Running it

```bash
python -m http.server 8000
```

Open <http://localhost:8000>. Requires a WebGL2-capable browser.

## What's here

```
src/core/     math, seeded RNG, noise, physics constants, settings, input, storage
src/world/    block registry, chunk storage, world (collision, raycast, ticking)
src/item/     item registry — tools, armour, food, story items
src/render/   pixel-art painter, ~200 procedural textures, texture array, GLSL
src/ui/       hand-authored bitmap font, blocky wordmark logo
docs/         10 research dossiers of Minecraft mechanics reference
```

### Accuracy

Movement is not eyeballed. `src/core/constants.js` encodes Minecraft Java Edition's
real per-tick integration, checked against published figures to four significant
figures:

| | accel | drag | result |
|---|---|---|---|
| walk | 0.1 × 0.98 | 0.546 | 4.317 blocks/s |
| sprint | 0.13 × 0.98 | 0.546 | 5.612 blocks/s |
| sneak | 0.1 × 0.98 × 0.3 | 0.546 | 1.295 blocks/s |
| jump | v₀ = 0.42 | ×0.98/tick | apex 1.2516 blocks |

Block hardness, tool tiers, mining-time formula, hunger exhaustion, knockback and the
attack-cooldown damage curve all follow the same approach.

### Everything is drawn in code

`src/render/painter.js` is a small pixel-art DSL — `noise`, `pebbles`, `planks`,
`grain`, `rings`, `oreBlobs`, string-art. `src/render/textures.js` uses it to paint
every block face and item icon at 16×16, seeded by name so they are deterministic.
`src/ui/font.js` is a bitmap font authored as string art with proportional widths and
`§` formatting codes.

## Documents

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — module contracts and exact APIs
- [`RESUME.md`](RESUME.md) — build state, what's next
- [`CLAUDE.md`](CLAUDE.md) — working notes and constraints

## Legal

An original tribute, not affiliated with or endorsed by Mojang or Microsoft. Contains
no Mojang code, textures, fonts, audio or trademarks — all assets are generated
procedurally by the code in this repository.
