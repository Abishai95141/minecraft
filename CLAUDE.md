# SowmiCraft — working notes for Claude

A from-scratch browser Minecraft clone with a 10-minute story mode. **Read this file,
then `ARCHITECTURE.md`, before writing any code.**

This project was started in a previous session and handed over via this repo. The
foundation is finished; the engine on top of it is not. Nothing on disk is
half-written — every committed file is complete and internally consistent.

---

## Hard constraints (these are the whole design)

- **Vanilla JavaScript ES modules. No build step, no bundler, no npm, no TypeScript.**
- **No dependencies and no CDN imports.** A strict-CSP page must be able to run this.
- **No binary assets.** Textures, the font, the logo, mob skins and all audio are
  generated at runtime in code. There is not a single `.png`, `.ogg` or `.ttf` and
  there must never be one.
- **No Node available in the dev environment.** There is no linter and no test runner.
  A syntax error is a black screen. Re-read what you write.
- **WebGL2 required.** The verification loop is: serve the folder, open it in the
  browser pane, read the console.
- Simulation runs in **ticks (20/s)**; only interpolation works in seconds.
- Anything the world or a save depends on goes through the seeded RNG in
  `src/core/rng.js`. **Never `Math.random()`** for world state.

## Run it

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`. (Use the `preview_start` browser tool with that
URL, then `read_console_messages` to catch errors.)

---

## What is already built — do not rewrite these

| area | files |
|---|---|
| core | `math.js` `rng.js` `noise.js` `constants.js` `settings.js` `storage.js` `input.js` |
| world | `blocks.js` `chunk.js` `world.js` |
| items | `items.js` |
| render | `painter.js` `textures.js` `atlas.js` `gl.js` `shaders.js` |
| ui | `font.js` `logo.js` |
| shell | `index.html` |

Highlights worth knowing before you touch anything:

- **`src/core/constants.js`** encodes Minecraft's *actual* per-tick integration, not an
  approximation. Its header carries a verification table (walk 4.317 b/s, sprint 5.612,
  sneak 1.295, jump apex 1.2516 blocks). Movement code must reproduce those numbers.
  Steady-state speed is `accel / (1 - drag)`; order per tick is **position, then
  gravity, then drag**.
- **`src/world/blocks.js`** is the block registry *and* the geometry tables
  (`FACE_VERTS`, `FACE_UVS`, `FACE_SHADE`, `FACE_NORMALS`, `AO_OFFSETS`). The mesher
  must use these rather than inventing its own winding.
- **`src/render/shaders.js`** pins the chunk vertex layout. `ARCHITECTURE.md` §5
  restates it byte for byte. The mesher and the shader must agree exactly or the
  world renders as garbage.
- **`src/render/textures.js`** paints ~200 textures with the `Painter` DSL in
  `painter.js`. To add a block texture, register it there with `tex(name, p => {...})`.
- **`src/ui/font.js`** is a hand-authored bitmap font written as string art. All text
  goes through `drawText`. It supports `§` formatting codes, shadows and wrapping.

## What is NOT built

`ARCHITECTURE.md` §1–17 specify each of these with exact export lists:

1. `world/biomes.js`, `world/worldgen.js`
2. `world/structures.js` — village, ruined tower, boss dungeon
3. `world/lighting.js`
4. `render/mesher.js` ← highest risk, vertex layout is pinned
5. `render/worldrenderer.js`, `sky.js`, `particles.js`
6. `render/models.js`, `entityskins.js`, `entityrenderer.js`
7. `entity/entity.js`, `mob.js`, `ai.js`, `mobs.js`, `itementity.js`
8. `item/inventory.js`, `recipes.js`, `smelting.js`
9. `ui/widgets.js`, `screen.js`, `screens/*`
10. `ui/icons.js`, `hud.js`, container screens, `tooltip.js`, `chat.js`
11. `audio/*`
12. `story/*` — the 7-quest "Ember of Sowmi" chain
13. `entity/player.js`, `game.js`, `main.js` ← **the spine; write these yourself, last**

## Suggested order

1. Relaunch the parallel build (below) to produce §1–12.
2. Write `entity/player.js`, `game.js`, `main.js` by hand — they wire everything
   together and are where interface mismatches surface.
3. Serve, open, read console, fix. Repeat until clean.
4. Then playtest: does mining feel right, does the story pace at ~10 minutes.

## Relaunching the parallel build

`tools/build-workflow.js` is a ready-to-run Workflow script: 10 implementation agents
on disjoint file sets, then 10 audit agents that re-read every produced file for
syntax and import errors. That audit pass is not optional — with no Node and no
linter, it is the only check before the browser.

```
Workflow({ scriptPath: "<abs path to>/tools/build-workflow.js" })
```

Note it hardcodes `ROOT = C:\Users\abish\Downloads\sowmicraft`. **Update that constant
to wherever the repo is cloned** before running, or the agents will write to the wrong
place.

Workflow runs cost a lot of tokens. Confirm with the user before launching.

## Reference material

`docs/reference/*.json` — 10 research dossiers pulled from the Minecraft wiki: player
physics, block properties, mob stats, crafting and tool tiers, the lighting model,
world generation, menus and loading screens, font metrics, sound design. Consult these
instead of guessing at a constant. The physics one is already distilled into
`src/core/constants.js`.

## Style

Match the surrounding code. Comments explain *why*, not *what*. Guard optional
subsystems with `?.` because they initialise in stages. No `console.log` left behind.
No stubs that return `null` where behaviour was specified.

## Legal footing

This is a tribute built from scratch. No Mojang code, textures, fonts, audio or
trademarks are copied — everything visual and audible is generated procedurally in
this repo. Keep it that way: do not add ripped assets, and keep the music original
rather than a transcription.
