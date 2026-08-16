# SowmiCraft — build state

**Status: engine build in progress. The foundation is complete; the engine on top
of it is being written and verified module by module.**

Update this file whenever the state changes. It is the handover document.

---

## The big change since the last session: there is a verification gate now

The previous session had no Node, so a syntax error was a black screen and the only
check was reading the code. This machine has Node 22, so the repo now carries two
harnesses that run without a GPU:

```bash
node tools/check.mjs      # syntax + import resolution + real module load, under a browser shim
node tools/smoke.mjs      # functional tests: physics, worldgen, lighting, mesher, recipes, gameplay
```

- `tools/env.mjs` — a browser-shaped environment for Node (window, document, a real
  2D canvas context, localStorage, Web Audio). `getContext('webgl2')` returns **null**,
  so anything that grabs a GL context at import time fails the gate by design.
- `tools/check.mjs` — three passes: parse each file as an ES module, resolve every
  import path and imported name, then actually load the graph.
- `tools/smoke.mjs` — behaviour, not just loading. It asserts the vanilla speed table,
  the mesher's vertex layout, light propagation and removal, the recipe set, mining
  times, structure contents, and an end-to-end mine/collect/place loop.

`package.json` exists **only** so Node parses `src/*.js` as ES modules. There are no
dependencies, no build step, and nothing to install. The game is still just a folder
of ES modules served statically.

`docs/BUILD-NOTES.md` is the addendum to `ARCHITECTURE.md`: the `game` object contract,
the cross-module signatures, the texture/block/item name rules, and the physics
ordering subtlety that catches everyone.

---

## Written and passing its tests

| area | files | gate |
|---|---|---|
| core | `math` `rng` `noise` `constants` `settings` `storage` `input` | pre-existing |
| world | `blocks` `chunk` `world` | pre-existing |
| world | `biomes` `lighting` `structures` | check + smoke |
| render | `painter` `textures` `atlas` `gl` `shaders` | pre-existing |
| render | `mesher` `sky` | check + smoke (mesher 15/15) |
| item | `items` | pre-existing |
| item | `inventory` `recipes` `smelting` | check + smoke |
| entity | `entity` `ai` `itementity` | check + smoke |
| ui | `font` `logo` | pre-existing |
| ui | `widgets` `screen` `screens/loading` | check |
| audio | `sfx` | check |
| spine | `entity/player.js` `game.js` `main.js` | hand-written, syntax clean |

## Still being written

- `world/worldgen.js`
- `entity/mob.js`, `entity/mobs.js`
- `render/worldrenderer.js`, `particles.js`, `models.js`, `entityskins.js`, `entityrenderer.js`
- `ui/icons.js`, `hud.js`, `tooltip.js`, `chat.js`, container screens
- `ui/screens/`: mainmenu, options, videosettings, controls, audiosettings,
  accessibility, worldselect, pause, death, credits
- `audio/audio.js`, `audio/music.js`
- `story/story.js`, `quests.js`, `dialogue.js`, `npc.js`

## Known open items

- `tools/smoke.mjs` "gameplay" section has 3 failing checks under investigation:
  walk distance over 20 ticks on generated terrain, placing a block while looking
  straight down (which correctly refuses to place inside the player — the test needs
  a better aim), and fall damage after a teleport.
- Nothing has been opened in a browser yet. WebGL, shader compilation and the UI
  layer are unverified until that happens.

## To resume

1. `node tools/check.mjs` — fix anything red. This is the fastest signal.
2. `node tools/smoke.mjs` — SKIP means the module is not written; FAIL means it is
   wrong.
3. Write whatever is missing from the "Still being written" list, against
   `ARCHITECTURE.md` §1–17 and `docs/BUILD-NOTES.md`.
4. Serve and open it:
   ```bash
   python3 -m http.server 8000
   ```
   then read the browser console. `window.sowmi` is the live game object.
5. Playtest: does mining feel right, does the story pace at about 10 minutes.

## Environment notes

- Node 22 is available (checker + tests only; the game itself never imports it).
- Python 3 is available for the static server.
- WebGL2 required.
