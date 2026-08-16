# SowmiCraft — build state

**Status: engine roughly 80% written. It does not run in a browser yet — eleven
modules are still missing and the spine imports all of them, so `src/main.js`
cannot load until they exist.**

Last session ended deliberately (token budget), not because anything broke.
Everything on disk is committed and internally consistent.

---

## Start here: there is a verification gate now

The previous session had no Node, so the only check on generated code was reading
it. This machine has Node 22, so the repo gates itself. Two commands, no GPU needed:

```bash
node tools/check.mjs      # syntax + import resolution + real module load
node tools/smoke.mjs      # behaviour: physics, worldgen, lighting, mesher, recipes, gameplay
```

- `tools/env.mjs` — a browser-shaped environment for Node (window, document, a real
  2D canvas context, localStorage, Web Audio). `getContext('webgl2')` returns **null**
  on purpose, so any module that grabs a GL context at import time fails the gate.
- `tools/check.mjs` — three passes: parse each file as an ES module, resolve every
  import path and imported name, then actually load the graph. `--syntax` does the
  parse only, which is what you want while a dependency is still being written.
- `tools/smoke.mjs` — 18 sections, 130+ assertions. Pass a substring to filter:
  `node tools/smoke.mjs mesher`.

`package.json` exists **only** so Node parses `src/*.js` as ES modules. No
dependencies, no build step, nothing to install. The game is still a folder of ES
modules served statically.

`docs/BUILD-NOTES.md` is the addendum to `ARCHITECTURE.md`: the `game` object
contract every UI and story module codes against, the cross-module signatures, the
rule about texture/block/item names, and the physics ordering subtlety.

---

## Current test results

```
PASS physics: vanilla speeds (8)      PASS mobs and ai (24)
PASS physics: collision (4)           PASS items on the ground (2)
FAIL worldgen: terrain (3 of 12)      PASS structures (12)
PASS worldgen: caves and ore (3)      PASS audio (3)
PASS lighting (8)                     PASS ui screens render (8)
PASS mesher (15)                      PASS gameplay: mine, collect, place (11)
PASS inventory (13)                   PASS gameplay: survival rules (12)
PASS recipes and smelting (15)        SKIP story        (not written)
PASS mining times (6)                 SKIP hud renders  (not written)
```

## Still to write — the spine imports every one of these

| file | notes |
|---|---|
| `render/worldrenderer.js` | §6. Highest value left: nothing renders without it. `mesher.js` is done and tested, so its input is settled. |
| `render/entityskins.js` | §9. 64×64 procedural mob skins, own texture array. |
| `render/entityrenderer.js` | §9. `render/models.js` is already written. |
| `ui/icons.js` | §15. Isometric block sprites, cached per item. |
| `ui/hud.js` | §15. `tools/smoke.mjs` has a ready "hud renders" section waiting. |
| `ui/tooltip.js`, `ui/chat.js` | §15. |
| `ui/screens/inventory.js`, `craftingtable.js`, `furnace.js`, `chest.js` | §15. `game.openContainer` already constructs them: `new ChestScreen(game, pos)`. |
| `story/story.js`, `quests.js`, `dialogue.js`, `npc.js` | §17. All their dependencies exist. `tools/smoke.mjs` has a "story" section waiting. |

`src/game.js` already imports and calls all of these, so read its call sites first —
it is the specification for how they get used, and it is written and syntax-clean.

## Known issues to fix

1. **The spawn chunk is a river on every seed tested** (90210, 7, 2024 all put water
   at the origin, biome `river`). Worth checking whether the river noise in
   `world/worldgen.js` is centred on the origin or the biome blend is degenerate —
   otherwise the player spawns in water and the village generates in a riverbed.
2. **`tools/smoke.mjs` "worldgen: terrain" has 3 failing checks**, and they are
   partly the test's fault: it compares `generator.surfaceHeight()` (which returns
   the land/riverbed height) against `chunk.getHeight()` (which counts water as
   solid, so a river column reads 63). Fix the assertion to compare like with like,
   and pick a seed whose spawn is dry land, before treating the remainder as a real
   generator bug.
3. **Nothing has been opened in a browser yet.** WebGL, shader compilation, the
   texture array upload and the whole 2D UI layer are unverified. Expect the first
   run to surface real problems there; the Node gate cannot see any of it.

## To resume

1. `node tools/check.mjs` — the missing-module errors are the work list.
2. Write the modules above against `ARCHITECTURE.md` §6, §9, §15, §17 and
   `docs/BUILD-NOTES.md`, checking each against `src/game.js`'s call sites.
3. `node tools/smoke.mjs` — SKIP means not written, FAIL means wrong.
4. Serve and open it:
   ```bash
   python3 -m http.server 8000
   ```
   Read the browser console. `window.sowmi` is the live game object.
5. Then playtest: does mining feel right, does the story pace at about 10 minutes.

## What was written last session

- The whole verification harness (`tools/env.mjs`, `check.mjs`, `smoke.mjs`).
- `docs/BUILD-NOTES.md`, the cross-module contract.
- By hand: `src/entity/player.js` (movement, mining, placing, combat, hunger, XP,
  save/load), `src/game.js` (fixed-step loop, chunk streaming, screen stack, world
  lifecycle, natural mob spawning), `src/main.js`.
- Generated and verified: `world/biomes.js`, `worldgen.js`, `structures.js`,
  `lighting.js`, `render/mesher.js`, `sky.js`, `particles.js`, `models.js`,
  `item/inventory.js`, `recipes.js`, `smelting.js`, `entity/entity.js`, `mob.js`,
  `ai.js`, `mobs.js`, `itementity.js`, `ui/widgets.js`, `screen.js`, nine menu
  screens, `audio/audio.js`, `sfx.js`, `music.js`.

## Regenerating modules in bulk

`tools/build-workflow.js` fans out implementation agents against `ARCHITECTURE.md`,
then audit agents that re-read every produced file. Pass the repo path — agents write
to absolute paths and the script cannot detect it:

```
Workflow({ scriptPath: "<repo>/tools/build-workflow.js", args: "<repo>" })
```

Now that `tools/check.mjs` exists it is the better gate; use the workflow to produce
code and the checker to verify it, not the audit agents alone.

## Environment notes

- Node 22 for the checker and tests only; the game itself never imports it.
- Static server for the game: `./serve.sh` (finds python3/python/npx/ruby), or
  `python3 -m http.server 8000`. ES modules will not load over `file://`.
- WebGL2 required.
- **Cross-platform.** The game is pure browser code: no `process`, no OS paths, no
  backslashes in any import, no binary assets. macOS, Windows and Linux behave
  identically; `.gitattributes` pins every file to LF.
- Safari paths are guarded: pointer lock falls back when `unadjustedMovement` is
  unsupported, anisotropic filtering is behind an extension check.
