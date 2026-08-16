# Build notes — read this with `ARCHITECTURE.md`

`ARCHITECTURE.md` is the module contract. This file is the addendum: the things
that are only knowable once several modules are written in parallel, plus the
verification loop. **Read both before writing code.**

---

## 1. There IS a verification gate now. Use it.

Earlier sessions had no Node. This one does (v22). After writing your files:

```
node tools/check.mjs src/your/file.js src/your/other.js
```

It runs three passes and exits non-zero on any failure:

1. **syntax** — parses each file as an ES module (catches the black-screen class of bug)
2. **imports** — every import path resolves to a real file, ends in `.js`, and every
   imported name is actually exported by that file
3. **load** — imports the module graph under a browser shim (`tools/env.mjs`), which
   catches TDZ errors, bad top-level initialisation and circular imports

`node tools/check.mjs` with no arguments checks everything. `--syntax` does the
syntax pass only, which is what you want while your dependencies are still being
written by another agent.

**Do not report your work as finished until `node tools/check.mjs <your files>`
is clean.** Iterate on it yourself; that is what it is for.

The shim gives you `window`, `document`, `localStorage`, `AudioContext` and a 2D
canvas context. It returns **`null` from `canvas.getContext('webgl2')`**, so a
module that grabs a GL context at import time will fail the load pass — take the
context as a constructor argument instead, which the spec already requires.

---

## 2. The `game` object — the contract every UI, HUD and story module codes against

`game.js` is written by hand and owns everything. These are the properties and
methods it guarantees. Anything not on this list does not exist.

```js
// --- subsystems (any may be null before its stage initialises — use ?.) ---
game.canvas          // the WebGL canvas element
game.uiCanvas        // the 2D canvas element
game.gl              // WebGL2RenderingContext
game.ctx             // CanvasRenderingContext2D for the UI layer
game.input           // Input       (core/input.js)
game.settings        // settings singleton (core/settings.js)
game.atlas           // atlas singleton (render/atlas.js)
game.audio           // AudioEngine (audio/audio.js) — null until the first user gesture
game.world           // World       (world/world.js) — null on the title screen
game.player          // Player      (entity/player.js) — null on the title screen
game.renderer        // WorldRenderer
game.sky             // SkyRenderer
game.particles       // ParticleSystem
game.entityRenderer  // EntityRenderer
game.lighting        // LightEngine
game.generator       // WorldGenerator
game.hud             // Hud
game.icons           // IconRenderer singleton (ui/icons.js)
game.story           // StoryMode — null outside story mode
game.dialogue        // DialogueBox — always present once the UI is up

// --- frame state ---
game.width           // GUI pixels (already divided by guiScale)
game.height          // GUI pixels
game.guiScale        // 1..4
game.camera          // the camera object described in ARCHITECTURE.md §6
game.partialTicks    // 0..1 interpolation alpha for the current frame
game.fps
game.paused          // true while a pausing screen is open
game.inGame          // true when a world is loaded and being played

// --- screens ---
game.screen                  // the current Screen, or null when playing
game.openScreen(screen)      // push; pass null to close everything and resume play
game.closeScreen()           // pop one level (falls back to the parent screen)
game.openContainer(kind, pos) // 'inventory' | 'crafting' | 'furnace' | 'chest'

// --- feedback helpers ---
game.toast(title, subtitle)          // slide-in notification, top right
game.chat(text)                      // append a line to the chat log (supports § codes)
game.subtitle(text)                  // accessibility subtitle line
game.playSound(name, opts)           // safe wrapper: no-ops when audio is not ready

// --- lifecycle ---
game.startWorld({ name, seed, story, difficulty })
game.saveWorld()
game.quitToTitle()
game.respawn()
```

**Screens** are constructed as `new SomeScreen(game)` and reach everything through
`this.game`. `Screen.render(ctx, mouseX, mouseY, dt)` is called with `ctx` already
scaled by `guiScale`, so work in GUI pixels and never multiply by the scale.

---

## 3. Cross-module signatures you must match exactly

These are the seams between agents working in parallel. Assume these exist and
have exactly these shapes; do not invent variations.

```js
// world/biomes.js
biomeAt(x, z, seed) -> id
biomeTint(biomeId, kind) -> 0xRRGGBB          // kind: 'grass' | 'foliage' | 'water'
blendedTint(world, x, z, kind) -> 0xRRGGBB    // 3x3 column average, used by the mesher

// world/worldgen.js
new WorldGenerator(world, seed)
  .generateChunk(chunk) / .populateChunk(chunk) / .surfaceHeight(x,z) / .biomeAt(x,z)

// world/lighting.js
new LightEngine(world)
  .initialLight(chunk) / .onBlockChanged(x,y,z,prev,next) / .process(budgetMs) / .pending

// render/mesher.js
meshSection(world, chunk, sectionIndex) -> MeshData | null
// MeshData = { opaque:{u16,u8,quadCount}, cutout:{...}, translucent:{...}, empty:bool }
// u16 is a Uint16Array, u8 a Uint8Array, both already trimmed to length.

// item/inventory.js
new ItemStack(itemName, count, damage)   ItemStack.EMPTY
new Inventory(size)                      new PlayerInventory()   // 41 slots, see spec

// entity/entity.js
new Entity(world, x, y, z)               class LivingEntity extends Entity
// entity.tick() / .move(dx,dy,dz) / .damage(n, source) / .interpolate(alpha)

// entity/mobs.js
spawnMob(world, type, x, y, z) -> Mob | null      // registry-driven factory
MOB_TYPES                                          // { zombie: {...}, ... }

// render/entityrenderer.js
new EntityRenderer(gl, skins)
  .render(camera, frameInfo, entities, player)

// ui/icons.js
icons.buildSync(atlas)  icons.draw(ctx, itemName, x, y, size)  icons.drawStack(ctx, stack, x, y)
```

`game.js` calls the world pipeline in this order every frame, so keep these cheap
and interruptible: `generator.generateChunk` → `generator.populateChunk` →
`lighting.initialLight` → `lighting.process(budget)` → `meshSection` → upload.

---

## 4. Names you may use — and only these

Inventing a texture, block or item name that does not exist is the most common
way to produce a game that loads but renders wrong.

**Blocks**: the `B` enum in `src/world/blocks.js`. Read it. There are 150+.
**Items**: `ITEM_LIST` in `src/item/items.js`. Every non-technical block also has an
item of the same name.
**Textures**: the keys registered with `tex(...)` in `src/render/textures.js`. To
check quickly:

```
grep -oE "tex\(\`?'?[a-z0-9_\$\{\}]+" src/render/textures.js
```

There are 207, including `destroy_stage_0` … `destroy_stage_9`, `sun`, `moon`,
`grass_block_side_overlay`, and every ore, plank, plant and item icon. If you need
a texture that is not there, **add it to `textures.js` with `tex(name, p => {...})`**
using the `Painter` DSL — do not reference a name that does not exist, and do not
add a binary asset.

Mob skins are **not** in this atlas. They are painted separately at 64×64 in
`render/entityskins.js` and uploaded as their own texture array.

---

## 5. Physics is already solved — reproduce it, do not redesign it

`src/core/constants.js` encodes Minecraft's real per-tick integration, and its
header carries the verification table. Per tick, in this order:

1. apply input acceleration to `vx/vz`
2. `move(vx, vy, vz)` — swept AABB, resolve **Y, then X, then Z**
3. `vy = (vy - GRAVITY) * VERTICAL_DRAG`
4. horizontal drag: `vx *= slipperiness * AIR_DRAG` (`groundDrag(slipperiness)`)
5. snap any component with `|v| < MOVE.VELOCITY_CUTOFF` to 0

Steady-state speed is `accel / (1 - drag)`. Walk must come out at 4.317 blocks/s,
sprint 5.612, sneak 1.295, and a jump apex at 1.2516 blocks. `tools/smoke.mjs`
asserts these numbers, so a movement change that breaks them fails the build.

**The subtlety that catches everyone:** those published speeds describe the
*displacement* in a tick, which is `velocity + accel` — the value `move()` is
handed *before* step 4 multiplies the stored velocity down. The stored velocity
settles one drag-multiply lower (0.1179 for a walk, not 0.2159). Order the tick
as written above and it comes out right; apply drag before moving and the whole
game feels half speed.

---

## 6. House rules (from `CLAUDE.md`, restated because they are absolute)

- Vanilla JS ES modules. No TypeScript, no bundler, no npm packages, no CDN imports.
- No binary assets. Ever. Textures, font, logo, skins and audio are all generated.
- Never `Math.random()` for anything the world or a save depends on — use `core/rng.js`.
- Guard optional subsystems with `?.`; they initialise in stages.
- No `console.log` left behind. `console.warn` for genuinely unexpected states is fine.
- Every file opens with a 1–3 line comment saying what it owns.
- Comments explain *why*, not *what*. Match the density of the surrounding code.
- No stubs. No `TODO`. No function that returns `null` where behaviour was specified.
