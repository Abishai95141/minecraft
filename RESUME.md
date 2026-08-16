# SowmiCraft — build state

**Status: foundation complete, engine modules not yet written. Nothing is half-finished.**
Every file on disk is complete and internally consistent. Two background workflows were
stopped cleanly; they left no partial files.

## What exists (20 source files, ~285 KB)

### Done and stable — do not rewrite
| file | what it owns |
|---|---|
| `index.html` | canvas stack (WebGL + 2D UI), pre-boot splash, fatal-error trap |
| `src/core/math.js` | vec3, mat4 (fpsView/perspective/ortho/invert), AABB, frustum extract + test, colour helpers |
| `src/core/rng.js` | `Random` (seeded, forkable), hash2/hash3, mulberry32 |
| `src/core/noise.js` | simplex2/3, fbm2/3, ridged, billow, voronoi, NoiseCache |
| `src/core/constants.js` | **vanilla-accurate physics.** Verified per-tick integration, MOVE/PLAYER/DAMAGE/KNOCKBACK/HUNGER/WORLD/CAMERA, `tickHunger`, `applyKnockback`, `fallDamage`, light curve |
| `src/core/settings.js` | all options + defaults + formatters (drive the Options screens directly), full Java key-bind table |
| `src/core/storage.js` | namespaced localStorage, world save/list/delete, quota-safe |
| `src/core/input.js` | keyboard/mouse/wheel/pointer-lock, action bindings, vanilla sensitivity curve |
| `src/world/blocks.js` | **150+ blocks** with vanilla hardness/tool/tier/drops/light/sound, fast typed-array lookup tables, face geometry + AO offset tables |
| `src/world/chunk.js` | sectioned chunk storage (16×192×16, 12 sections), packed light, block entities, RLE serialisation, NeighbourView |
| `src/world/world.js` | block access, collision boxes per render type, voxel raycast, entity registry, tick loop, day/night, save/load |
| `src/item/items.js` | full item registry: tools ×5 materials, armour ×4 sets, food with real hunger/saturation, story items, `breakTimeSeconds` |
| `src/render/painter.js` | 16×16 pixel-art painter DSL (noise, pebbles, planks, grain, rings, oreBlobs, string-art) |
| `src/render/textures.js` | **~200 procedural textures** — every block face and item icon, painted from scratch |
| `src/render/atlas.js` | builds the WebGL2 TEXTURE_2D_ARRAY + per-texture canvases for the UI |
| `src/render/gl.js` | context creation, Shader wrapper, DynamicBuffer, resize |
| `src/render/shaders.js` | chunk / sky / celestial / cloud / entity / particle / line / break / post GLSL |
| `src/ui/font.js` | **hand-authored bitmap font** (full ASCII, 7px caps, proportional), § formatting codes, shadow, wrap, typewriter truncation |
| `src/ui/logo.js` | blocky 3D SOWMICRAFT wordmark — extrusion, rock speckle, outline |
| `ARCHITECTURE.md` | **the contract.** Exact module APIs for everything still to build |

### Reference research — `docs/reference/*.json` (10 dossiers, 600 KB)
Hard numbers pulled from the Minecraft wiki: player physics (verified against published
speeds to 4 s.f.), block properties, mob stats, crafting/tool tiers, lighting model,
world generation, menus/loading screens, font metrics, sound design. The physics dossier
is already distilled into `src/core/constants.js`.

## What is NOT built yet

All specced in detail in `ARCHITECTURE.md` §1–17:

1. `world/biomes.js`, `world/worldgen.js` — terrain, biomes, caves, ores, trees
2. `world/structures.js` — village, ruined tower, boss dungeon
3. `world/lighting.js` — incremental sky/block light BFS
4. `render/mesher.js` — chunk meshing + smooth lighting/AO **(vertex layout is pinned in the spec)**
5. `render/worldrenderer.js`, `sky.js`, `particles.js`
6. `render/models.js`, `entityskins.js`, `entityrenderer.js` — mob models + 64×64 procedural skins
7. `entity/entity.js`, `mob.js`, `ai.js`, `mobs.js`, `itementity.js` — physics + mob AI
8. `item/inventory.js`, `recipes.js`, `smelting.js`
9. `ui/widgets.js`, `screen.js`, `screens/*` — menus, options, controls, world select
10. `ui/icons.js`, `hud.js`, container screens, tooltip, chat
11. `audio/*` — procedural SFX + original music
12. `story/*` — the 7-quest "Ember of Sowmi" chain, NPCs, dialogue
13. **`entity/player.js`, `game.js`, `main.js`** — I write these myself; they are the spine

## To resume

The build workflow script is already written and ready to relaunch:

```
C:\Users\abish\.claude\projects\C--Users-abish-Downloads-sowmicraft\4a818754-7c2a-42ef-8a00-665e4f1ac621\workflows\scripts\sowmicraft-build-wf_c9b5c211-150.js
```

It fans out 10 implementation agents (disjoint file sets, all briefed on
`ARCHITECTURE.md`) followed by 10 audit agents that re-read every produced file for
syntax and import errors — necessary because there is no Node and no linter here, so
the browser console is the only other check.

Relaunch with `Workflow({scriptPath: "<path above>"})`.

After it lands: I write `entity/player.js`, `game.js`, `main.js`, then serve with
`python -m http.server` and debug in the browser pane until it runs clean.

## Environment notes
- No Node. Python is available for a static server.
- WebGL2 required. Verification loop = load the page, read the console.
