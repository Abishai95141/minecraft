# SowmiCraft — module contracts

Browser Minecraft clone. **Vanilla JS ES modules, no build step, no dependencies,
no binary assets.** Open `index.html` from a static server and it runs.

Everything is painted/synthesised at runtime: textures (`render/textures.js`),
font (`ui/font.js`), logo (`ui/logo.js`), sounds (`audio/`).

## Conventions

- **Coordinates**: right-handed. +Y up. Yaw 0 looks toward +Z, increasing yaw
  turns toward −X (vanilla). Pitch positive looks down.
- **Faces** are indexed `0..5` = `+X, −X, +Y, −Y, +Z, −Z` (`FACE` in `world/blocks.js`).
- **Units**: blocks and *ticks* (20/s) in simulation code; seconds only at the
  render/interpolation boundary.
- **Determinism**: anything world-shaped goes through a seeded `Random`
  (`core/rng.js`). Never call `Math.random()` for world state — only for cosmetics.
- **Style**: match the surrounding code. Comments explain *why*, not *what*.
  No `console.log` left in. Guard every optional subsystem (`this.audio?.play(...)`).
- **Never** import a module that imports you back. The layering below is strict.

## Layering (a module may only import from layers above it)

```
core/      math, rng, noise, constants, settings, storage, input
world/     blocks, chunk, world, lighting, worldgen, biomes, structures
item/      items, inventory, recipes, smelting
entity/    entity, player, mob, ai, mobs, itementity
render/    painter, textures, atlas, gl, shaders, mesher, worldrenderer,
           models, entityskins, entityrenderer, particles, icons
ui/        font, logo, widgets, screen, hud, screens/*
audio/     audio, sfx, music
story/     story, quests, dialogue, npc, village
game.js    owns everything, ticks the world, drives the screen stack
main.js    bootstrap
```

---

## ALREADY WRITTEN — read these, do not rewrite them

| file | key exports |
|---|---|
| `core/math.js` | `vec3`, `mat4`, `AABB`, `clamp`, `lerp`, `damp`, `extractFrustum`, `aabbInFrustum`, `mixHex`, `cssHex`, `hexToRgb` |
| `core/rng.js` | `Random` (`.next/.int/.below/.float/.pick/.bool/.shuffle/.weighted/.fork`), `hash2`, `hash3`, `hash2f`, `hash3f`, `fx` |
| `core/noise.js` | `simplex2`, `simplex3`, `fbm2`, `fbm3`, `ridged2`, `billow2`, `voronoi2`, `NoiseCache` |
| `core/constants.js` | `TPS`, `MOVE`, `PLAYER`, `DAMAGE`, `KNOCKBACK`, `HUNGER`, `WORLD`, `CAMERA`, `groundAccel`, `groundDrag`, `applyKnockback`, `fallDamage`, `tickHunger`, `eat`, `cooldownTicks`, `chargeMultiplier`, `LIGHT_TABLE`, `lightCurve` |
| `core/settings.js` | `settings` singleton (`.get/.set/.cycle/.format/.buttonLabel/.optionsIn/.bindings/.bind/.keyName`), `OPTION_DEFS`, `DEFAULT_BINDINGS`, `BINDING_CATEGORIES`, `keyName`, `OptionKind` |
| `core/storage.js` | `load`, `save`, `remove`, `keys`, `listWorlds`, `saveWorldMeta`, `loadWorldData`, `saveWorldData`, `deleteWorld`, `usageBytes` |
| `core/input.js` | `Input` (`.action(name)`, `.actionPressed`, `.isDown`, `.wasPressed`, `.takeLook()`, `.takeTyped()`, `.takeWheel()`, `.on(type,fn)`, `.requestLock()`, `.releaseLock()`, `.endFrame()`, `.locked`, `.mouseX/.mouseY`, `.textMode`) |
| `world/blocks.js` | `B` (id enum), `BLOCKS[id]`, `byName`, `RenderType`, `ToolType`, `Tier`, `SoundGroup`, `Tint`, `FACE`, `FACE_NORMALS`, `FACE_SHADE`, `FACE_VERTS`, `FACE_UVS`, `AO_OFFSETS`, `IS_OPAQUE`, `IS_SOLID`, `IS_FULL_CUBE`, `LIGHT_EMIT`, `LIGHT_OPACITY`, `IS_FLUID`, `IS_REPLACEABLE`, `RENDER_TYPE`, `TINT_TYPE`, `SLIPPERINESS`, `IS_CLIMBABLE`, `CONTACT_DAMAGE`, `occludes`, `needsSupport`, `getBlock`, `blockId` |
| `world/chunk.js` | `Chunk`, `ChunkSection`, `NeighbourView`, `CHUNK_SIZE`(16), `CHUNK_HEIGHT`(192), `MIN_Y`(−64), `MAX_Y`(127), `SECTION_COUNT`(12), `SECTION_HEIGHT`(16), `sectionIndex`, `columnIndex`, `chunkKey` |
| `world/world.js` | `World`, `FACE_OFFSETS`, `rayBox` — see below |
| `item/items.js` | `ITEMS`, `ITEM_LIST`, `getItem`, `itemById`, `itemForBlock`, `MATERIALS`, `ArmorSlot`, `isCorrectTool`, `canHarvest`, `breakTimeSeconds`, `attackDamage`, `attackSpeedOf`, `RARITY_COLOR` |
| `render/painter.js` | `Painter` (`.fill/.rect/.outline/.hline/.vline/.line/.circle/.noise/.speckle/.jitter/.multiply/.shade/.copyFrom/.overlay/.art/.outlineAlpha/.bevel/.grain/.pebbles/.bricks/.planks/.rings/.oreBlobs/.toCanvas`), `TEX_SIZE`(16), `scaleColor`, `ramp` |
| `render/textures.js` | `TEXTURES` (Map name→painterFn), `paint(name)`, `tex()` registration |
| `render/atlas.js` | `atlas` singleton — `.build(onProgress)`, `.buildSync()`, `.upload(gl)`, `.layerOf(name)`, `.canvasOf(name)`, `.averageColor(name)`, `.samplePixel(name,x,y)`, `.size`(16), `.layers`, `.texture` |
| `render/gl.js` | `createContext`, `Shader` (`.use/.int/.float/.vec2/.vec3/.vec4/.mat4/.loc/.attrib`), `DynamicBuffer`, `glInfo`, `resizeCanvas` |
| `render/shaders.js` | `CHUNK_VS/FS`, `SKY_VS/FS`, `CELESTIAL_VS/FS`, `CLOUD_VS/FS`, `ENTITY_VS/FS`, `PARTICLE_VS/FS`, `LINE_VS/FS`, `BREAK_VS/FS`, `POST_VS/FS` |
| `ui/font.js` | `drawText(ctx,str,x,y,{color,shadow,scale,align,})`, `measure`, `measureFormatted`, `wrapText`, `truncateFormatted`, `visibleLength`, `stripFormatting`, `parseFormatted`, `COLORS`, `shadowOf`, `tickObfuscation`, `FONT_HEIGHT`(8), `CAP_HEIGHT`(7), `LINE_HEIGHT`(9) |
| `ui/logo.js` | `drawWordmark(ctx,text,cx,y,targetWidth,opts)`, `buildWordmark`, `measureWordmark` |

### `World` API (already written — use it, don't change it)

```js
world.getBlock(x,y,z) -> id            world.setBlock(x,y,z,id,meta=0,opts?) -> bool
world.getMeta(x,y,z)                   world.setBlockFast(x,y,z,id,meta)   // gen only
world.getBlockDef(x,y,z) -> BlockDef   world.getChunk(cx,cz) / getOrCreateChunk / addChunk / unloadChunk
world.getSkyLight/getBlockLight/getLightLevel(x,y,z)
world.skyLightFactor() -> 0..1         world.isDay
world.getHeight(x,z)  world.getBiome(x,z)
world.getBlockEntity(x,y,z) / setBlockEntity(x,y,z,data)
world.getCollisionBoxes(aabb, out[]) -> AABB[]
world.blockCollisionBoxes(x,y,z,id?) -> AABB[]
world.anyBlockIn(aabb, (id,x,y,z)=>bool)  world.isFluidAt  world.slipperinessAt  world.isClimbable
world.canStandAt(x,y,z)  world.findSpawnY(x,z,startY?)
world.raycast(origin, dir, maxDist, {includeFluids,filter}) -> {x,y,z,face,blockId,hitPos,distance}|null
world.raycastEntities(origin,dir,maxDist,exclude) -> {entity,t}|null
world.addEntity(e) / removeEntity(e) / getEntity(id) / entitiesIn(box,f) / entitiesNear(x,y,z,r,f) / nearestEntity(...)
world.scheduleTick(x,y,z,delay)  world.updateNeighbours(x,y,z)  world.breakBlockNaturally(x,y,z)
world.randomTick(cx,cz,radius,(x,y,z,id)=>{})
world.on(fn)  world.emit(event,payload)
   events: 'blockChanged' {x,y,z,prev,id,meta} | 'blockBroken' {x,y,z,id,natural}
           'chunkUnload' chunk | 'entityAdded'/'entityRemoved' entity
           'scheduledTick' {x,y,z,at} | 'tick' totalTicks
world.tick(deltaTicks)  world.timeOfDay  world.totalTicks  world.entities  world.seed  world.difficulty
world.generator  world.lighting   // assigned by game.js
```

---

## TO BUILD

### 1. `world/biomes.js`

```js
export const Biome = { PLAINS:0, FOREST:1, BIRCH_FOREST:2, DESERT:3, SAVANNA:4,
                       TAIGA:5, SNOWY_PLAINS:6, SWAMP:7, BEACH:8, OCEAN:9,
                       RIVER:10, STONY_PEAKS:11, WITHERED:12 };
export const BIOMES = [ /* one entry per id, index === id */ ];
// each: { id, name, display, grassTint, foliageTint, waterTint, skyTint,
//         surface, filler, underwater, treeDensity, treeTypes:[{type,weight}],
//         grassDensity, flowerDensity, temperature, downfall, minY, maxY,
//         heightScale, heightOffset, mobs:{passive:[],hostile:[]} }
export function biomeAt(x, z, seed) -> id            // continuous, cached
export function biomeTint(biomeId, kind) -> 0xRRGGBB // kind: 'grass'|'foliage'|'water'
export function blendedTint(world, x, z, kind) -> 0xRRGGBB  // 3x3 column average
```
Vanilla tints: plains grass `0x91BD59`, forest `0x79C05A`, birch `0x88BB67`,
desert `0xBFB755`, savanna `0xBFB755`, taiga `0x86B783`, snowy `0x80B497`,
swamp `0x6A7039`, jungle-ish `0x59C93C`. Foliage: plains `0x77AB2F`,
forest `0x59AE30`, birch `0x80A755`, desert `0xAEA42A`, taiga `0x68A464`,
snowy `0x60A17B`, swamp `0x6A7039`. Water `0x3F76E4` (swamp `0x617B64`).

### 2. `world/worldgen.js`

```js
export class WorldGenerator {
  constructor(world, seed)
  generateChunk(chunk)   // terrain shape + biomes + heightmap. Sets chunk.generated
  populateChunk(chunk)   // trees, ores, plants, structures. Sets chunk.populated
  surfaceHeight(x, z) -> y      // cheap, cached; used for spawn + structures
  biomeAt(x, z) -> Biome id
}
```
- Sea level `WORLD.SEA_LEVEL` (62). Bedrock at `MIN_Y`, rough for 4 layers.
- Terrain from `fbm2` continentalness + `ridged2` mountains + erosion, then
  3D `fbm3` density for overhangs near peaks. Aim for gentle plains around
  y 64-70, hills 75-95, peaks 100-125, oceans down to ~40.
- Surface: biome `surface` block on top, `filler` for 3-4 below, stone under.
  Below y −8 use deepslate variants of stone/ores.
- Caves: `ridged2`-driven spaghetti tubes + `fbm3` cheese caves, flood below
  y 10 with lava, carve ravines rarely.
- Ores by Y band with vein sizes (coal 0-120 peak 45 size 8-17; iron −24-56
  peak 15 size 4-9; copper 0-70 size 6-12; gold −60-30 peak −16 size 4-8;
  redstone −60-15 peak −58 size 4-8; lapis −60-30 peak 0 size 3-6;
  diamond −60-14 peak −58 size 3-8; emerald peaks only).
- Trees per biome (oak/birch/spruce), `grassDensity` plants, cacti + dead bush
  in desert, sugar cane by water, lily pads in swamp, snow layer + ice in snowy.
- Deterministic: everything derives from `new Random(seed).fork('...')` +
  chunk coords. Regenerating a chunk must produce identical output.

### 3. `world/structures.js`

```js
export function generateVillage(world, cx, cz, rng) -> {center:[x,y,z], buildings:[], npcSpawns:[]}
export function generateRuinedTower(world, x, z, rng) -> {center, lootPos}
export function generateDungeon(world, x, y, z, rng) -> {center, spawnerPos, chests:[]}
export function placeStructure(world, x, y, z, template, rotation) 
export const TEMPLATES = { /* small hand-authored block layouts */ }
export function villageAt(x, z, seed) -> {x,z}|null      // deterministic grid + jitter
```
Village: 5-8 buildings on a dirt-path plaza around a well, plus farm plots
(farmland + wheat), fences, a blacksmith with a furnace + chest, torches on
posts. Buildings are oak-plank walls, cobble foundations, stairs roofs, a door,
glass panes, a bed, a crafting table. Flatten terrain under each footprint.

### 4. `world/lighting.js`

```js
export class LightEngine {
  constructor(world)
  initialLight(chunk)                    // full sky column flood + emitters
  onBlockChanged(x,y,z,prevId,newId)     // queues incremental updates
  process(budgetMs = 4) -> number        // drains queues; returns nodes processed
  get pending() -> number
}
```
BFS flood fill, separate sky and block queues, with removal passes
(the standard "if neighbour light came from me, clear and re-propagate" rule).
Sky light propagates down at full strength through `LIGHT_OPACITY === 0`
blocks, and decays by `max(1, opacity)` sideways. Block light decays by 1 per
step from `LIGHT_EMIT`. Must be incremental and time-boxed — never block a frame.

### 5. `render/mesher.js`

```js
export function meshSection(world, chunk, sectionIndex) -> MeshData|null
export const VERTEX_STRIDE_U16 = 7;   // pos3, uv2, layer, overlay
export const VERTEX_STRIDE_U8  = 8;   // sky, block, shade, flags, tintR,G,B, pad
// MeshData = { opaque:{u16,u8,quadCount}, cutout:{...}, translucent:{...}, empty:bool }
```
Vertex layout — **must match `render/shaders.js` exactly**:
- `u16` buffer per vertex: `x,y,z` in **1/32 block units, chunk-local**
  (`y` is absolute-world-y minus `MIN_Y`, times 32); `u,v` in **1/256 units**;
  `layer`; `overlay` (`65535` = none).
- `u8` buffer per vertex: `skyLight*17`, `blockLight*17`, `shade*255`
  (= `FACE_SHADE[face] * aoFactor`), `flags` (bit0 water anim, bit1 lava anim),
  `tintR,tintG,tintB` (255,255,255 when untinted), pad.

Three passes: opaque (full cubes), cutout (leaves/plants/glass, alpha-tested),
translucent (water, ice). Quads are emitted CCW-from-outside using `FACE_VERTS`
/ `FACE_UVS`. Index buffer is shared and static (`0,1,2, 0,2,3` per quad) —
just report `quadCount`.

Smooth lighting: per vertex, average the light of the 4 blocks touching that
corner (the face-adjacent block plus `AO_OFFSETS[face][vertex]` side1/side2/corner),
skipping opaque ones. AO factor = the classic voxel rule:
`side1 && side2 ? 0 : 3 - (side1+side2+corner)` mapped to `[0.5, 0.7, 0.85, 1.0]`.
Respect `settings.get('smoothLighting')` (0 = flat per-face light).

Handle every `RenderType`: CUBE, CROSS (2 diagonal quads, ±0.15 random offset
by position hash), LIQUID (top surface at 14/16, only exposed faces), TORCH
(4 thin side quads + top), SLAB, STAIRS, PANE, CROP, DOOR, FENCE, LADDER,
CARPET, SNOW_LAYER, BED. Cull with `occludes(neighbourId, id)`.
Tint from `TINT_TYPE[id]` via `blendedTint(world,x,z,kind)`.
`grass_block_side` uses base `dirt`-ish layer + `grass_block_side_overlay`
as the tinted overlay layer.

### 6. `render/worldrenderer.js`

```js
export class WorldRenderer {
  constructor(gl, atlas)
  setWorld(world)
  update(camera, dtSeconds)         // upload queued meshes, cull, sort
  render(camera, frameInfo)         // sky, terrain (3 passes), clouds, entities hook
  markSectionDirty(chunk, si)
  removeChunk(chunk)
  drawSelectionBox(camera, x,y,z, boxes)
  drawBreakOverlay(camera, x,y,z, stage /*0..9*/, boxes)
  get stats() -> {chunks, quads, drawCalls, meshTimeMs}
  destroy()
}
```
Camera object shape (produced by `game.js`, consumed everywhere):
```js
{ pos:[x,y,z], yaw, pitch, fov /*rad*/, aspect, near, far,
  view:mat4, proj:mat4, viewProj:mat4, frustum:Float32Array(24),
  forward:[x,y,z], right:[x,y,z], up:[x,y,z] }
```
`frameInfo`: `{ time /*s*/, timeOfDay, skyLight, fogColor:[r,g,b], fogStart,
fogEnd, fogDensity, underwater:bool, gamma, nightVision }`.
Mesh uploads are budgeted (≤ 4 per frame) so streaming never stutters.
Frustum-cull per section with `aabbInFrustum`. Sort translucent back-to-front.

### 7. `render/sky.js`

```js
export class SkyRenderer {
  constructor(gl, atlas)
  render(camera, frameInfo, world)   // gradient dome, sun, moon, stars, clouds
}
export function skyColors(timeOfDay, biomeSkyTint) -> {top,horizon,sunset,sunsetStrength,starAlpha,fog}
```
Sky `0x78A7FF` at noon, `0x000004`-ish at midnight, orange `0xFC9A45` sunset
band. Fog colour = horizon colour blended toward the sky. Clouds: a flat
`0xFFFFFF` voxel layer at y `WORLD.CLOUD_HEIGHT`, drifting on +X, 12 blocks
per cloud cell, generated from `hash2f`, alpha 0.8.

### 8. `render/particles.js`

```js
export class ParticleSystem {
  constructor(gl, atlas)
  spawn(type, x,y,z, opts)   // 'blockBreak'|'blockDust'|'splash'|'bubble'|'smoke'
                             // |'flame'|'crit'|'damage'|'heart'|'note'|'ember'|'portal'
  blockBreak(x,y,z, blockId)         // 4x4x4 grid burst, coloured from the texture
  blockHit(x,y,z, face, blockId)
  update(dt, world)
  render(camera, frameInfo)
  clear()
  get count()
}
```
Billboarded quads, gravity 0.04/tick, drag 0.98, collide with blocks (cheap
AABB vs `world.getBlock`). Colour sampled with `atlas.samplePixel`.
Respect the `particles` setting (all / decreased ×0.5 / minimal ×0.15).

### 9. `render/models.js` + `render/entityskins.js` + `render/entityrenderer.js`

```js
// models.js — boxy Minecraft-style models built from cuboids.
export const MODELS = { player, zombie, skeleton, creeper, spider, pig, cow,
                        sheep, chicken, villager, item, boss };
// model = { texW, texH, parts:[ {name, pivot:[x,y,z], boxes:[{from:[x,y,z],
//   size:[w,h,d], uv:[u,v], inflate?}], default:{rx,ry,rz} } ] }
// Units are 1/16 block, Minecraft model space (y up, origin at the feet).
export function buildModelMesh(gl, model) -> {vao, vertexCount, partCount}
export function animate(modelName, entity, partialTicks) -> Float32Array[16] // part matrices

// entityskins.js — 64x64 procedural skins, same box-UV convention as vanilla.
export class SkinAtlas { buildSync(); upload(gl); layerOf(name); }
export const skins = new SkinAtlas();

// entityrenderer.js
export class EntityRenderer {
  constructor(gl, skins)
  render(camera, frameInfo, entities, player)
  renderNameplates(ctx2d, camera, entities, guiScale)   // 2D pass, called by HUD
}
```
Max 16 parts per model (shader uniform array size). Include a damage-flash
overlay (`uOverlayColor` = red, strength 0.4 while `entity.hurtTime > 0`),
entity shadows (a dark ellipse quad on the ground) when the setting is on,
and a leash-free simple walk cycle: legs/arms swing
`cos(limbSwing * 0.6662) * 1.4 * limbSwingAmount`.

### 10. `item/inventory.js`

```js
export class ItemStack {
  constructor(itemName, count = 1, damage = 0)
  get item()  get isEmpty  get maxStack  get maxDamage
  clone()  equalsIgnoreCount(other)  canStackWith(other)
  split(n) -> ItemStack   grow(n)  shrink(n)
  damageBy(n) -> bool /* true when it breaks */
  static EMPTY
  toJSON() / static fromJSON(o)
}
export class Inventory {
  constructor(size)
  get(i) / set(i, stack) / size
  add(stack) -> ItemStack   // returns the remainder
  remove(i, count) -> ItemStack
  countOf(itemName) -> number
  hasItems(itemName, n) -> bool
  consume(itemName, n) -> bool
  firstEmpty() -> index|-1
  find(itemName) -> index|-1
  clear()
  toJSON() / fromJSON(o)
  onChange(fn)
}
export class PlayerInventory extends Inventory {
  // 0-8 hotbar, 9-35 main, 36-39 armor (helmet..boots), 40 offhand
  selected = 0
  get held() -> ItemStack
  get armor() -> ItemStack[4]
  armorPoints() -> number
  pickBlock(blockId)  // creative-ish: move to hotbar if held
  addToHotbarFirst(stack) -> remainder
}
```

### 11. `item/recipes.js` + `item/smelting.js`

```js
// recipes.js
export function shaped(output, count, pattern /*['XXX','X X',...]*/, key /*{X:'oak_planks'}*/)
export function shapeless(output, count, ingredients)
export const RECIPES = [...]
export function findRecipe(gridStacks /*3x3 or 2x2, row-major, may hold null*/, gridW)
   -> {output:ItemStack, consume:(grid)=>void} | null
export function recipesFor(itemName) -> Recipe[]     // used by the recipe book
// smelting.js
export const SMELTING = { 'iron_ore': {out:'iron_ingot', xp:0.7}, ... }
export const FUEL = { 'coal': 1600, 'oak_planks': 300, ... }  // burn ticks
export function smeltResult(itemName) -> {out, xp}|null
export function fuelTicks(itemName) -> number
export const SMELT_TICKS = 200;
```
Include the full vanilla-equivalent recipe set for everything in
`item/items.js`: planks (shapeless from each log ×4), sticks, torches,
crafting table, chest, furnace, all 5 tool types × 5 materials, ladder,
fence, slabs, stairs, doors, bed, bowl, bucket, shears, flint and steel, bow,
arrow, TNT, bookshelf, book, paper, bread, cookie, golden apple, all armour
pieces × 4 materials, storage blocks + reversals, glass pane, iron bars, hay bale.

### 12. `entity/entity.js`, `entity/mob.js`, `entity/ai.js`, `entity/mobs.js`, `entity/itementity.js`

```js
export class Entity {
  constructor(world, x, y, z)
  id world x y z  vx vy vz  yaw pitch  prevX/prevY/prevZ/prevYaw/prevPitch
  width height  onGround  inWater  inLava  dead  noHit
  age  hurtTime  fallDistance
  getBoundingBox() -> AABB
  tick()                     // calls updatePhysics() then updateAI()
  move(dx,dy,dz)             // full swept AABB collision + step-up
  updatePhysics()            // vanilla integration order: pos, gravity, drag
  interpolate(alpha) -> {x,y,z,yaw,pitch}
  distanceTo(e)  lookAt(x,y,z)
  damage(amount, source) -> bool
  kill()  remove()
  toJSON() / static fromJSON()
}
export class LivingEntity extends Entity {
  health maxHealth  attackDamage  moveSpeed  knockbackResistance
  limbSwing limbSwingAmount  deathTime
  heal(n)  isAlive
  onDeath()  dropLoot()
  knockback(fromX, fromZ, strength)
}
export class Mob extends LivingEntity { ai, target, ... }
```
Physics **must** follow `core/constants.js` exactly (see the worked table in
that file's header). `move()` resolves Y then X then Z against
`world.getCollisionBoxes`, with `MOVE.STEP_HEIGHT` auto-step and sneak ledge grip.

`mobs.js` registers: `zombie` (20hp, 3 dmg, 0.23 speed, burns in day),
`skeleton` (20hp, bow, 0.25), `creeper` (20hp, 1.5s fuse, 3 blast radius),
`spider` (16hp, 2 dmg, 0.3, climbs, neutral in light), `pig` (10hp),
`cow` (10hp), `sheep` (8hp), `chicken` (4hp), plus story mobs
`hollow_warden` (boss, 120hp) and `withered_husk` (16hp).
`ai.js`: prioritised goal list — `FloatGoal`, `PanicGoal`, `MeleeAttackGoal`,
`RangedAttackGoal`, `FollowTargetGoal`, `WanderGoal`, `LookAtPlayerGoal`,
`AvoidSunGoal`, `FollowOwnerGoal`. Simple greedy pathing with jump-if-blocked
is fine; do not write A*.

### 13. `ui/widgets.js` + `ui/screen.js`

The UI is drawn on a **separate 2D canvas** over the WebGL canvas, at a virtual
resolution scaled by `guiScale` (auto = `clamp(floor(min(w/320, h/240)), 1, 4)`).
All coordinates in screens are **GUI pixels**.

```js
export class Screen {
  constructor(game)
  title  parent  pausesGame = false  blursBackground = true  closeOnEscape = true
  init(w, h)          // w/h in GUI px; build widgets here
  layout(w, h)
  render(ctx, mouseX, mouseY, dt)
  tick()
  onKeyDown(code, e) -> bool   // return true to consume
  onChar(ch) -> bool
  onMouseDown(x, y, button) -> bool
  onMouseUp(x, y, button) -> bool
  onWheel(delta) -> bool
  onClose()
  add(widget)   // returns the widget
}
export class Widget { x y w h enabled visible focused; render(ctx,mx,my); mouseDown(x,y,b); ... }
export class Button extends Widget { constructor({x,y,w=200,h=20,text,onClick,tooltip}) }
export class Slider extends Widget { constructor({x,y,w,h,optionKey}) }  // reads settings
export class CycleButton extends Widget { constructor({x,y,w,h,optionKey}) }
export class ToggleButton, TextField, ScrollPanel, ListWidget, KeyBindButton
export function drawNinePatch(ctx, style, x, y, w, h)
export function drawPanel(ctx, x, y, w, h)          // vanilla GUI window frame
export function drawSlot(ctx, x, y)                  // 18x18 inventory slot
export function drawDirtBackground(ctx, w, h, scale) // tiled dark dirt
export function drawGradientOverlay(ctx, w, h)       // menu dim: 0xC0101010 -> 0xD0101010
export const BUTTON_H = 20, BUTTON_W = 200;
```
Vanilla button look: 200×20, nine-sliced with 2px borders — normal is a
grey-blue gradient (`#6B6B6B` top → `#565656` bottom) with `#000` outline and
a `#FFFFFF20` top highlight; hover brightens and the label turns `#FFFFA0`;
disabled is `#4A4A4A` with `#A0A0A0` text. Click plays the UI click sound.
Text is centred, drawn with `drawText(..., {shadow:true})`.

### 14. `ui/screens/*.js`

`loading.js` — dirt background, centred wordmark, progress bar, rotating hint
text. `mainmenu.js` — slow-panning 3D panorama (render a real world snapshot,
or a procedural gradient + parallax silhouettes), `drawWordmark('SOWMICRAFT')`,
a **yellow splash line** rotated −20° with a `sin` pulse
(`scale = 1 + |sin(t*2)| * 0.05`), buttons: `Story Mode`, `Singleplayer`,
`Options...`, `Quit Game`; version string bottom-left, copyright bottom-right.
Splash texts: write ~30 original ones in the vanilla voice.
`options.js` (+ `videosettings.js`, `controls.js`, `audiosettings.js`,
`accessibility.js`) driven by `settings.optionsIn(category)` — two columns of
150×20 buttons, `Done` at the bottom. `controls.js` lists every binding by
category with a `KeyBindButton`, shows conflicts in red, has `Reset Keys`.
`worldselect.js` — list of saved worlds with `Play`/`Delete`/`Create New`.
`pause.js` — "Game Menu", buttons `Back to Game`, `Advancements`, `Options...`,
`Save and Quit to Title`. `death.js` — `#7F0000A0` overlay, "You Died!" in
`0xFFFFFF` at scale 2, score line, `Respawn` / `Title Screen`.
`credits.js` — scrolling credits after the story ends.

### 15. `ui/hud.js` + `ui/icons.js` + container screens

```js
// icons.js — pre-rendered inventory icons.
export class IconRenderer {
  buildSync(atlas)                       // isometric 3D block sprites + flat item sprites
  draw(ctx, itemName, x, y, size = 16)
  drawStack(ctx, stack, x, y)            // icon + count + durability bar
}
export const icons = new IconRenderer();
// hud.js
export class Hud {
  render(ctx, game, w, h, dt)
  // crosshair (inverted-difference 9x9), hotbar (182x22 + 24x24 selector),
  // hearts (9x9, 2px gap, 10 per row, flash + wobble on damage),
  // hunger (mirrored from the right), armour row, air bubbles, XP bar + level,
  // held-item name fade (2.5s), status effects, hotbar item tooltips,
  // chat log, subtitles, boss bar, debug (F3) overlay, toasts, objective tracker
}
```
Isometric block icons: draw the top face as a rhombus (30° dimetric), left
face and right face as parallelograms, shading `1.0 / 0.8 / 0.6`. That is what
makes the inventory read as Minecraft.

`inventory.js` (176×166 panel, 3×9 main grid at 8,84; hotbar at 8,142;
2×2 craft grid at 98,18; result at 154,28; armour column at 8,8; player
model viewport at 26,8 to 75,78), `craftingtable.js` (176×166, 3×3 at 30,17,
result 124,35), `furnace.js` (176×166, input 56,17, fuel 56,53, output 116,31,
flame 56,36 14×14, arrow 79,35 24×17), `chest.js` (176×168 single).
Slot interaction: left-click pick/place/swap, right-click half/one,
shift-click quick-move, drag-distribute, `Q` drop.

### 16. `audio/audio.js` + `audio/sfx.js` + `audio/music.js`

```js
export class AudioEngine {
  init()                                   // must be called from a user gesture
  play(name, {volume, pitch, x, y, z} = {})
  playUI(name)
  setListener(pos, forward)
  startMusic(track) / stopMusic(fade)
  setCategoryVolume(cat, v)
  get ready
}
export const audio = new AudioEngine();
```
Synthesise everything with Web Audio (oscillators + noise buffers + biquads +
gain envelopes). No files. Sounds: `dig.stone/grass/wood/sand/gravel/glass/wool`,
`step.*`, `break.*`, `place.*`, `hurt`, `death`, `pop`, `xp`, `click`,
`door_open/close`, `chest_open/close`, `eat`, `bow`, `arrow_hit`, `explode`,
`fuse`, `fire`, `splash`, `swim`, `lava_pop`, `zombie_idle/hurt/death`,
`skeleton_idle/hurt`, `creeper_hiss`, `spider_hiss`, `pig`, `cow`, `sheep`,
`chicken`, `villager_hmm/yes/no`, `level_up`, `quest_complete`, `boss_roar`.
Vanilla randomises pitch ±10% on most sounds — do the same. Distance
attenuation: linear rolloff to silence at 16 blocks, panned by listener basis.
Music: **original** ambient pieces in the same spirit — slow, sparse, modal
piano/pad in F Lydian / A minor, 60-70 bpm, long reverb tails. Do not
reproduce any existing melody.

### 17. `story/*.js`

```js
// story.js
export class StoryMode {
  constructor(game)
  start()                       // build the village, spawn NPCs, open the intro cutscene
  tick()
  get currentQuest()  get objectives  get progressText
  advance(questId)  completeObjective(id)  failQuest(id)
  onEvent(type, payload)        // 'blockBroken','mobKilled','itemPicked','npcTalked','areaEntered'
  save() / load(data)
}
// quests.js — the 7-quest chain, ~10 minutes end to end.
export const QUESTS = [...]
// dialogue.js
export class DialogueBox {
  show(node)  // {speaker, portrait, lines:[], choices:[{text, next, action}]}
  render(ctx, w, h, dt)   // typewriter, portrait panel, name plate, choice list
  onKeyDown(code)  advance()  get active
}
export const DIALOGUE = { elder_sowmi: {...}, torvin: {...}, mira: {...}, pim: {...} }
// npc.js
export class Npc extends LivingEntity { name, dialogueId, questGiver, wander, facePlayer }
```
**The story** — "The Ember of Sowmi", 7 beats:
1. **Ashfall** — wake at dusk in Emberhold village; the beacon has gone dark.
   Cutscene + Elder Sowmi intro dialogue.
2. **Old Ways** — punch a tree (3 logs) → craft planks → crafting table →
   wooden pickaxe. Teaches the core loop, with a hint toast per step.
3. **Iron and Ash** — Torvin the blacksmith: mine 5 coal + 3 iron in the mine
   east of the village. Rewards a stone pickaxe, torches, `torvins_hammer`.
4. **The Long Night** — night falls on return; defend Emberhold, kill 6
   withered husks in 90s. Rewards an iron sword. Boss bar shows the timer.
5. **What Mira Knew** — waypoint to a ruined tower; retrieve `miras_journal`
   from a chest; reading it reveals the ritual and grants `hollow_key`.
6. **The Deep Hollow** — descend the sealed dungeon; fight `hollow_warden`
   (120hp, 3 phases, summons husks, ground-slam telegraph). Drops `ember_core`.
7. **Rekindle** — return, place `ember_core` on the `beacon_pedestal`; the
   lanterns relight, the withered ground heals in a spreading ring, ending
   cutscene → credits.
Each quest sets an objective tracker (top-right), a compass waypoint, and
fires toasts. Dialogue must have real character and at least 2 branching
choices per major NPC. Keep total playtime ≈ 10 minutes.

---

## Non-negotiables

1. **It must run.** No syntax errors, no imports of files that don't exist, no
   calls to APIs not listed here. If you need something from another module
   that isn't specified, add a small local helper instead of inventing an import.
2. Export exactly the names listed. `game.js` wires them together by name.
3. Guard optional collaborators (`game.audio?.play(...)`, `this.story?.onEvent(...)`).
4. No `Math.random()` for anything the world or a save depends on.
5. Every file starts with a 1-3 line comment saying what it owns.
