export const meta = {
  name: 'sowmicraft-build',
  description: 'Implement the SowmiCraft engine modules in parallel against the pinned architecture spec',
  phases: [
    { title: 'Implement', detail: 'one agent per module group, disjoint files' },
    { title: 'Audit', detail: 'cross-check imports/exports and JS syntax by reading every produced file' },
  ],
}

// ---------------------------------------------------------------------------
// SET THIS to the absolute path of the cloned repo before running, or pass the
// path as the Workflow `args` value:  Workflow({ scriptPath, args: "/path/to/repo" })
// Agents write files at absolute paths, so a wrong ROOT writes to the wrong place.
// ---------------------------------------------------------------------------
const ROOT = (typeof args === 'string' && args) || 'C:\\Users\\abish\\Downloads\\sowmicraft'

const PREAMBLE = `You are implementing part of SowmiCraft — a from-scratch browser Minecraft clone
in the repo at ${ROOT}.

FIRST, before writing anything:
1. Read ${ROOT}\\ARCHITECTURE.md IN FULL. It is the contract. Follow it exactly.
2. Read every already-written file your module imports from. Match their style,
   naming, and comment density. Do NOT rewrite or edit files outside your assignment.

HARD RULES (violating any of these breaks the build):
- Vanilla JavaScript ES modules. No TypeScript, no JSX, no build step, no npm packages,
  no CDN imports, no dynamic import of anything that does not exist.
- Every import path must resolve to a real file, with the correct relative path and a
  '.js' extension. Import ONLY names that are actually exported by that file.
- Export EXACTLY the names the spec lists for your files. game.js wires by name.
- There is NO linter and NO node in this environment. Your code will be loaded straight
  into a browser. A single syntax error is a black screen. Re-read what you wrote and
  check: balanced braces/parens/brackets, no trailing commas in function args, no
  stray 'const' redeclarations, every template literal closed, no reserved words as
  variable names, class methods separated correctly (no commas between them).
- No console.log left behind. console.warn for genuinely unexpected states is fine.
- No Math.random() for anything the world or a save depends on — use core/rng.js.
- Guard optional collaborators with ?. since subsystems initialise in stages.
- Write real, complete implementations. No TODO stubs, no 'not implemented' throws,
  no placeholder functions that return null where behaviour is specified.

Write your files with the Write tool. When done, reply with ONLY a JSON-ish summary
of what you created — your prose is not shown to anyone.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'exports', 'notes'],
  properties: {
    files: { type: 'array', items: { type: 'string' }, description: 'repo-relative paths written' },
    exports: {
      type: 'array',
      description: 'every top-level export, per file',
      items: {
        type: 'object', additionalProperties: false, required: ['file', 'names'],
        properties: { file: { type: 'string' }, names: { type: 'array', items: { type: 'string' } } },
      },
    },
    imports: {
      type: 'array',
      description: 'every import statement you wrote, so the auditor can verify them',
      items: {
        type: 'object', additionalProperties: false, required: ['file', 'from', 'names'],
        properties: { file: { type: 'string' }, from: { type: 'string' }, names: { type: 'array', items: { type: 'string' } } },
      },
    },
    notes: { type: 'string', description: 'anything game.js must know to wire this up, and any deviation from the spec' },
  },
}

const JOBS = [
  {
    key: 'biomes-worldgen',
    label: 'worldgen',
    prompt: `Implement SECTIONS 1 and 2 of the spec: \`src/world/biomes.js\` and \`src/world/worldgen.js\`.

This is the module that decides what the world LOOKS like, so it matters more than
almost anything else for the feel of the game. Aim for terrain a Minecraft player would
recognise: broad gentle plains, rolling forested hills, the occasional dramatic peak,
sandy beaches meeting flat blue oceans, rivers cutting through, and a proper cave system
underneath with ore you actually have to look for.

Read src/world/blocks.js (block ids + the B enum), src/world/chunk.js (Chunk API,
setBlockRaw, biomes, heightMap, MIN_Y/MAX_Y/CHUNK_SIZE), src/core/noise.js,
src/core/rng.js and src/core/constants.js (WORLD.SEA_LEVEL etc.) before starting.

Requirements beyond the spec text:
- generateChunk must be fast enough to run several per frame: no allocations in the
  inner loop, sample 2D noise per column not per voxel where possible.
- surfaceHeight(x,z) must agree with what generateChunk actually places, and must be
  cheap + cached (use NoiseCache) because structures and spawn logic call it a lot.
- Beaches only where land meets water near sea level. Rivers carve across biomes.
- Trees must not generate floating: check the ground block under the trunk.
- Leaves get a decay distance in meta if you want, but they must form a believable
  canopy: oak 4-6 tall with a 2-radius blob, birch taller and narrower, spruce conical.
- Populate must be idempotent-safe: guard on chunk.populated.
- Ores in deepslate depth must use the DEEPSLATE_* block variants.`,
  },
  {
    key: 'structures',
    label: 'structures',
    prompt: `Implement SECTION 3 of the spec: \`src/world/structures.js\`.

Read src/world/blocks.js, src/world/chunk.js, src/world/world.js and src/core/rng.js first.

The village is the emotional centre of the story mode — the player wakes up there and
returns to it twice. It must feel like a real place, not a box farm. Build:
- A central plaza with a cobblestone well and the beacon pedestal (B.BEACON_PEDESTAL)
  on a small stone-brick dais, with B.EMBER_LANTERN posts around it.
- 6-8 buildings of 3 varieties (small house, large house, blacksmith) laid out around
  the plaza on B.VILLAGE_PATH paths that actually connect to each doorway.
- Buildings: cobblestone foundation, oak plank walls, glass panes for windows, oak
  stairs roof with a spruce/oak log frame, an oak door, and an interior with a bed,
  a crafting table, and a torch. The blacksmith gets a furnace, a chest with loot, and
  a lava pit behind a fence.
- Farm plots: a 2-deep water channel with farmland and wheat at growth stage 7,
  fenced, with a hay bale stack.
- Terrain under every footprint must be flattened and the walls extended down to solid
  ground so nothing floats or has a gap under it.
- Return npcSpawns: named positions for elder / blacksmith / scholar / child so the
  story module can place them.

Also implement the ruined tower (a broken stone-brick spire, 12-16 tall, with a
staircase, cracked/mossy variants, cobwebs, and a chest at the top) and the dungeon
for the boss fight (a sealed 15x7x15 mossy-cobble chamber, deep, with pillars, a
monster spawner, lava-lit alcoves, an entrance staircase from the surface, and an
arena floor with room to fight). The dungeon must be REACHABLE — carve a lit stair
shaft from the surface entrance down to it.

villageAt(x,z,seed) uses a deterministic grid (spacing ~24 chunks) with jitter so a
given seed always puts the village in the same place.`,
  },
  {
    key: 'lighting-mesher',
    label: 'lighting+mesher',
    prompt: `Implement SECTIONS 4 and 5 of the spec: \`src/world/lighting.js\` and \`src/render/mesher.js\`.

These two are the highest-risk files in the project. Read them together with:
src/world/blocks.js (FACE_VERTS, FACE_UVS, FACE_SHADE, FACE_NORMALS, AO_OFFSETS,
occludes, RENDER_TYPE, LIGHT_OPACITY, LIGHT_EMIT, TINT_TYPE, Tint, RenderType),
src/world/chunk.js (Chunk, NeighbourView, sectionIndex, SECTION_*),
src/render/shaders.js (CHUNK_VS — the vertex layout MUST match it byte for byte),
src/render/atlas.js (atlas.layerOf), src/core/settings.js, src/world/world.js.

THE VERTEX LAYOUT IS THE CONTRACT. Two parallel arrays per pass:
  u16 per vertex (7): x, y, z (1/32 block, chunk-local, y = (worldY - MIN_Y) * 32),
                      u, v (1/256 units), layer, overlay (65535 = none)
  u8  per vertex (8): skyLight*17, blockLight*17, shade*255, flags,
                      tintR, tintG, tintB, 0
Quads are emitted in FACE_VERTS order (CCW seen from outside). The renderer supplies a
shared static index buffer of (0,1,2, 0,2,3) per quad, so you only report quadCount.

Smooth lighting is what makes a voxel world look good — get it right:
- For each of a face's 4 vertices, gather the 3 neighbours from AO_OFFSETS[face][vertex]
  (side1, side2, corner), each offset from the block IN FRONT of the face.
- AO: if side1 && side2 -> 0, else 3 - (side1 + side2 + corner), where each term is 1
  when that neighbour is a full opaque cube. Map 0..3 to [0.5, 0.7, 0.85, 1.0].
- Light: average the sky light and block light of the front block plus those 3
  neighbours, skipping any that are full opaque cubes; if all are opaque fall back to
  the front block's own value.
- shade byte = FACE_SHADE[face] * aoFactor, clamped, times 255.
- When settings smoothLighting is 0, use the front block's light for all 4 vertices and
  an AO factor of 1.
- Flip the quad's triangle split when AO is asymmetric (a0 + a2 > a1 + a3) or you get
  the classic diagonal-seam artifact.

Handle EVERY RenderType listed in the spec, not just CUBE. Cross plants get a
per-position hash offset so a grass field does not look like a grid.

For lighting.js: correct incremental BFS with removal passes. Sky light floods down a
column at full strength through opacity-0 blocks. Time-box process() with performance.now()
so it never stalls a frame, and make pending() honest so the loading screen can wait on it.`,
  },
  {
    key: 'worldrenderer',
    label: 'worldrenderer+sky+particles',
    prompt: `Implement SECTIONS 6, 7 and 8 of the spec: \`src/render/worldrenderer.js\`,
\`src/render/sky.js\` and \`src/render/particles.js\`.

Read src/render/shaders.js (every uniform name you must set), src/render/gl.js
(Shader class API), src/render/atlas.js, src/core/math.js (mat4, extractFrustum,
aabbInFrustum), src/world/chunk.js, src/world/world.js, src/core/settings.js,
src/core/constants.js. Assume src/render/mesher.js exports
\`meshSection(world, chunk, sectionIndex) -> MeshData|null\` with MeshData =
{ opaque:{u16,u8,quadCount}, cutout:{...}, translucent:{...}, empty:bool }.

WorldRenderer owns: the shared static index buffer (size it for 98304 quads, Uint32),
per-section VAOs, the mesh upload budget (<= 4 uploads/frame, prioritised by distance
to the camera), frustum culling per section, and the three render passes:
  opaque      — depth write on, no blend, alpha cutoff 0.5
  cutout      — depth write on, no blend, alpha cutoff 0.1
  translucent — depth write OFF, blend SRC_ALPHA/ONE_MINUS_SRC_ALPHA, sorted back-to-front
Set uAlphaCutoff and uOpacity per pass. Bind the atlas array texture to unit 0.

Sky: a real gradient dome (an icosphere or a lat/long sphere is fine), sun and moon
quads from the 'sun'/'moon' atlas layers moving on the correct arc for timeOfDay,
stars fading in at night, and a drifting cloud layer at WORLD.CLOUD_HEIGHT built from
hash2f cells with proper top/side faces. skyColors() must give a convincing dawn:
deep blue -> orange band on the sun's side -> pale blue day -> orange -> night.

Particles: instanced quads (use vertexAttribDivisor), billboarded from camera right/up,
gravity + drag + block collision, and a real blockBreak burst that samples the broken
block's own texture for its colours via atlas.samplePixel.

Also implement drawSelectionBox (the black 2px wireframe vanilla draws around the
targeted block, using LINE_VS/FS with depth test on and a slight outward inflation)
and drawBreakOverlay (the destroy_stage_N texture projected onto the block's faces).`,
  },
  {
    key: 'entities',
    label: 'entities+mobs+ai',
    prompt: `Implement SECTION 12 of the spec: \`src/entity/entity.js\`, \`src/entity/mob.js\`,
\`src/entity/ai.js\`, \`src/entity/mobs.js\`, \`src/entity/itementity.js\`.

Read src/core/constants.js VERY carefully — its header has the exact per-tick
integration and a verified speed table. The physics must reproduce those numbers.
Also read src/core/math.js (AABB), src/world/world.js (getCollisionBoxes,
blockCollisionBoxes, slipperinessAt, isClimbable, raycast), src/world/blocks.js,
src/item/items.js.

Entity.move(dx,dy,dz) must be a proper swept AABB resolve:
  1. collect boxes from world.getCollisionBoxes over the expanded movement box
  2. resolve Y first (clamping dy against each box), then X, then Z
  3. auto step-up: if the horizontal move was blocked and onGround, retry the move
     raised by MOVE.STEP_HEIGHT and keep it if it travels further
  4. sneak ledge grip: while sneaking and onGround, refuse any horizontal step that
     would leave no ground under the new box
  5. set onGround, accumulate fallDistance, and zero the blocked velocity components

updatePhysics order is: apply input accel -> move() -> apply drag, with
vy = (vy - GRAVITY) * VERTICAL_DRAG, and the |v| < MOVE.VELOCITY_CUTOFF snap.

itementity.js: dropped items bob and spin, have a 0.25 hitbox, a 10-tick pickup delay,
merge with nearby identical stacks, are attracted to a nearby player within 1.5 blocks,
and despawn after 5 minutes.

mobs.js must register every mob in the spec with real behaviour, not just stats:
zombies path toward and swing at the player and burn in daylight; skeletons keep
distance, strafe, and fire arrows on an interval; creepers approach, stop, hiss, and
explode on a 1.5s fuse (destroying blocks and damaging by distance falloff); spiders
climb walls and are only hostile in the dark; passive mobs wander, panic when hurt,
and follow their breeding item. Include hollow_warden (the 120hp boss: 3 phases,
summons withered_husk adds, a telegraphed ground slam with an AoE, and a rage phase
below 40hp) and withered_husk.

ai.js: a prioritised goal system. Each goal has canUse(), canContinue(), start(),
stop(), tick(). The mob runs the highest-priority usable goal. Keep pathing simple
and greedy (step toward target, jump when blocked and the block above is clear,
avoid walking off drops > 3 blocks) — do NOT write A*.`,
  },
  {
    key: 'models',
    label: 'models+skins+entityrenderer',
    prompt: `Implement SECTION 9 of the spec: \`src/render/models.js\`, \`src/render/entityskins.js\`,
\`src/render/entityrenderer.js\`.

Read src/render/shaders.js (ENTITY_VS/FS — uParts is a mat4[16], aPart is a float
attribute), src/render/gl.js, src/render/painter.js (you will paint skins with it),
src/core/math.js (mat4), src/core/constants.js.

This is what makes mobs read as Minecraft mobs. Build the models with the real vanilla
proportions in 1/16-block model units:
- player/zombie/villager: head 8x8x8 at y24, body 8x12x4, arms 4x12x4, legs 4x12x4
  (zombie arms stick straight out; villager gets a big nose and robed arms)
- creeper: head 8x8x8, body 4x12x8, four 4x6x4 legs, no arms
- skeleton: same skeleton as player but 2x12x2 limbs
- spider: 8x8x8 head, 6x9x6 body, 3x8x3 rear, eight 16x1x1 legs splayed out
- pig 10x16x8 body + 8x8x8 head + snout; cow/sheep bulkier with horns/wool;
  chicken small with a beak, wattle and wings
- boss (hollow_warden): a large humanoid, ~2.6 blocks tall, heavy shoulders, glowing eyes

entityskins.js paints a 64x64 skin per mob using the standard box UV unwrap
(for a box at uv (u,v) with size w,h,d the faces are laid out:
 top (u+d, v, w, d), bottom (u+d+w, v, w, d), right (u, v+d, d, h),
 front (u+d, v+d, w, h), left (u+d+w, v+d, d, h), back (u+d+w+d, v+d, w, h)).
Use Painter at size 64. Give each mob its recognisable colours: zombie green skin +
teal shirt + dark trousers, skeleton bone white with dark eye sockets, creeper the
mottled green with the black face, pig pink with a darker snout, cow black-and-white
patches, sheep white wool with a pale face, chicken white with a yellow beak and red
wattle, villager brown robe with the big nose, warden dark slate with orange cracks.

models.js animate() must produce a real walk cycle: legs and arms counter-swing by
cos(limbSwing * 0.6662) * 1.4 * limbSwingAmount, the head tracks the look direction
(clamped), idle bob on the body, creepers lean back before exploding, spiders' legs
articulate, chickens flap when falling, and a death spin/collapse as deathTime rises.

entityrenderer.js batches by model, sets uParts, uModel, uLayer and the damage-flash
uOverlayColor, and draws ground shadows as a dark quad scaled by distance to the
ground when the entityShadows setting is on.`,
  },
  {
    key: 'items',
    label: 'inventory+recipes',
    prompt: `Implement SECTIONS 10 and 11 of the spec: \`src/item/inventory.js\`,
\`src/item/recipes.js\`, \`src/item/smelting.js\`.

Read src/item/items.js in full first — it is the item registry and defines every item
name you may reference. Referencing an item name that is not registered there is a bug.
Also read src/world/blocks.js for block names.

The recipe set must be COMPLETE for everything craftable in items.js. Go through
ITEM_LIST and make sure every tool, every armour piece, every utility block and every
food that should be craftable has a recipe. Get the vanilla shapes right — players
know them by muscle memory:
  planks: shapeless 1 log -> 4 planks (per wood type)
  sticks: 2 planks vertical -> 4
  crafting_table: 2x2 planks
  chest: 8 planks ring
  furnace: 8 cobblestone ring
  torch: coal over stick -> 4
  pickaxe: 'XXX', ' # ', ' # '   axe: 'XX ', 'X# ', ' # '
  shovel: ' X ', ' # ', ' # '    sword: ' X ', ' X ', ' # '
  hoe: 'XX ', ' # ', ' # '
  helmet 'XXX','X X'   chestplate 'X X','XXX','XXX'
  leggings 'XXX','X X','X X'   boots 'X X','X X'
and so on. findRecipe must handle shaped recipes at any offset inside the grid and
must mirror-match (a pickaxe crafted on the left of a 3x3 still works), plus
shapeless matching by multiset.

ItemStack must handle durability properly: damageBy returns true when the item breaks,
and a broken tool becomes EMPTY. Inventory.add must fill partial stacks before empty
slots, in hotbar-first order for PlayerInventory.

smelting.js: the full ore/food/sand/clay/cobblestone/log smelting table with xp, and
the fuel table with vanilla burn times.`,
  },
  {
    key: 'ui-core',
    label: 'widgets+menus',
    prompt: `Implement SECTIONS 13 and 14 of the spec: \`src/ui/widgets.js\`, \`src/ui/screen.js\`,
and the screens in \`src/ui/screens/\`: loading.js, mainmenu.js, options.js,
videosettings.js, controls.js, audiosettings.js, accessibility.js, worldselect.js,
pause.js, death.js, credits.js.

Read src/ui/font.js (drawText/measure/wrapText — all text goes through it),
src/ui/logo.js (drawWordmark), src/core/settings.js (OPTION_DEFS drive the option
screens directly — do not hardcode option lists), src/core/storage.js (world list),
src/render/atlas.js (atlas.canvasOf('dirt') for the background).

Everything is drawn to a 2D canvas context in GUI pixels. The ctx is already scaled
by guiScale before your render() is called, so work in GUI px and never multiply by
the scale yourself.

THE LOOK IS THE POINT. Get these details right, because they are what people
recognise:
- Buttons are 200x20, nine-sliced, with a 1px black outline, a vertical grey-blue
  gradient, a subtle lighter top edge and darker bottom edge. Hovered buttons get a
  brighter face and #FFFFA0 text. Disabled is flat #4A4A4A with #A0A0A0 text.
- Menu backgrounds are the dirt texture tiled at 32 GUI px and darkened to ~25%
  brightness. In-game menus instead use the dim gradient over the paused world.
- The title screen: the SOWMICRAFT wordmark centred at about 15% down, a yellow
  (#FFFF00) splash line anchored to the wordmark's bottom-right, rotated -20 degrees,
  pulsing with scale = 1 + abs(sin(t*2)) * 0.05. Buttons stacked and centred,
  200 wide, 24 apart. Version string bottom-left, "A tribute, not a product" style
  copyright bottom-right. A slow-panning parallax background (procedural layered
  silhouettes of hills/trees against a sky gradient is fine and will look good).
- Write ~30 ORIGINAL splash texts in the vanilla voice — playful, self-aware,
  occasionally absurd. Do not copy Minecraft's actual splash texts.
- The loading screen: dirt background, wordmark, a progress bar (a 2px-bordered
  outline with a filled interior), the current stage name, and rotating tips.

worldselect.js lists saved worlds from storage.listWorlds() with name, seed, last
played and size, with Play / Delete (with a confirm) / Create New (a name + seed
text field). controls.js groups bindings by BINDING_CATEGORIES, shows conflicts in
red with a warning icon, and rebinds on click (next key press captures).

Screens must be keyboard-navigable and must not throw when the game has no world yet
(the title screen renders before any world exists).`,
  },
  {
    key: 'ui-game',
    label: 'hud+containers',
    prompt: `Implement SECTION 15 of the spec: \`src/ui/icons.js\`, \`src/ui/hud.js\`, and the
container screens \`src/ui/screens/inventory.js\`, \`craftingtable.js\`, \`furnace.js\`,
\`chest.js\`, plus \`src/ui/tooltip.js\` and \`src/ui/chat.js\`.

Read src/ui/font.js, src/ui/widgets.js is being written in parallel — assume it
exports Screen, Widget, Button, drawPanel, drawSlot, drawNinePatch,
drawGradientOverlay, BUTTON_W, BUTTON_H exactly as the spec lists, and import from
'../widgets.js' / '../screen.js'. Read src/item/items.js, src/render/atlas.js,
src/world/blocks.js, src/core/settings.js.
Assume src/item/inventory.js exports ItemStack / Inventory / PlayerInventory with the
spec's API.

icons.js is the single most visually important file here. Inventory icons must be
isometric 3D blocks, not flat squares. For a block: draw the top face as a rhombus and
the two visible side faces as parallelograms, sampling the block's atlas canvases
(atlas.canvasOf(name)) and shading top 1.0, left 0.8, right 0.6. Do this once into a
cached offscreen canvas per item at 32px and blit from then on — never per frame.
Flat items (tools, food, ingots) just blit their atlas canvas.

hud.js draws, in order: crosshair (a 9x9 cross using 'difference' composite so it
inverts against the background), the hotbar (a 182x22 bar with 20x20 slots and a
24x24 selection frame overhanging by 1px), hearts (9x9 icons, 10 across, a dark
container plus a red heart, half hearts, with the damage flash and the wobble offset
vanilla applies when health is low), hunger drumsticks mirrored from the right, the
armour row above hearts, air bubbles above hunger when underwater, the XP bar and
centred level number, the held-item name fading over 2.5s, the chat log, the boss
health bar, the F3 debug overlay (fps, xyz, chunk, facing, biome, light, memory,
entity count, GPU string), toast popups sliding in from the right, and the story
objective tracker in the top right.

Container screens: get the vanilla geometry exactly right (the spec lists every
slot origin). Implement full slot interaction — left click pick up / place / swap,
right click take half / place one, shift-click quick-move between the container and
the player inventory, click-drag to distribute a stack across slots, Q to drop,
and the hover tooltip (item name in its rarity colour, a description line in grey,
durability when damaged, drawn in the vanilla dark-purple-bordered box that flips
side when it would run off screen).

The furnace screen must animate its flame from the burn fraction and its arrow from
the cook progress.`,
  },
  {
    key: 'audio',
    label: 'audio',
    prompt: `Implement SECTION 16 of the spec: \`src/audio/audio.js\`, \`src/audio/sfx.js\`,
\`src/audio/music.js\`.

Read src/core/settings.js (the volume options and their category names) and
src/world/blocks.js (SoundGroup — every block declares which sound family it uses).

EVERYTHING is synthesised with the Web Audio API. No files, no fetch, no base64 audio.
Build a small synthesis toolkit (noise buffer generator, ADSR gain envelope, filtered
noise burst, pitched oscillator stack, simple convolution-free reverb via delay taps)
and define each sound as a short function using it.

The block sounds carry the whole game feel, so make them distinct:
- stone: a short filtered noise burst with a hard attack and a low-mid thump
- grass/plant: soft brief high-passed noise, almost a rustle
- wood: a resonant knock — a bandpass around 400-800 Hz with a fast decay
- sand: dry, dull, low-passed noise
- gravel: grittier, slightly longer, with a couple of scattered transients
- glass: bright, high, shattering — noise plus a few high sine partials
- wool: very soft, muffled, hardly any high end
- metal: a ringing bandpass with slight inharmonic partials
Footsteps are the same families at lower volume and shorter length. Digging is a
looped, quieter version. Randomise pitch +/-10% on every play, as vanilla does.

Also: the UI click (a short 1000 Hz-ish blip with a fast decay), the item pickup 'pop'
(a rising pitch blip), XP (a bright bell), the hurt sound (a filtered noise + falling
tone), the explosion (a big low noise burst with a long decay and a rumble tail),
the creeper fuse (a rising hiss), mob vocalisations (zombie: low growl with formant
filtering; skeleton: rattling clicks; spider: high hiss; pig/cow/sheep/chicken:
pitched noise bursts with vowel-ish formants; villager: a two-tone 'hmm'), and
level_up / quest_complete / boss_roar stingers.

3D positioning: use a PannerNode or manual stereo pan + gain from the listener basis,
with linear rolloff to silence at 16 blocks.

music.js composes ORIGINAL ambient pieces with scheduled oscillator voices — slow,
sparse, modal, soft-attack piano-ish tones with long decay over a quiet pad, 60-70bpm,
in A minor / F Lydian, with generous space between phrases. Write at least three
distinct pieces: a menu theme, a calm overworld theme, and a tense one for the boss.
They must be original compositions, not transcriptions of anything that exists.
Music must fade in/out smoothly and never click.

AudioEngine.init() must be safe to call repeatedly and must resume a suspended context.`,
  },
  {
    key: 'story',
    label: 'story',
    prompt: `Implement SECTION 17 of the spec: \`src/story/story.js\`, \`src/story/quests.js\`,
\`src/story/dialogue.js\`, \`src/story/npc.js\`.

Read ARCHITECTURE.md's story section for the 7 quest beats, then read
src/world/world.js, src/world/blocks.js, src/item/items.js (the story items are
already registered: ember_shard, ember_core, miras_journal, hollow_key,
torvins_hammer, wardens_bane, village_bread), src/ui/font.js (drawText, wrapText,
truncateFormatted — the typewriter uses it), src/core/settings.js (textSpeed,
autoDialogue). Assume src/entity/entity.js exports Entity and LivingEntity with the
spec's API, and src/world/structures.js exports generateVillage/generateRuinedTower/
generateDungeon.

THE WRITING MATTERS. This is a 10-minute adventure and the dialogue is most of what
the player will remember. Give the four NPCs genuinely distinct voices:
- Elder Sowmi: old, tired, precise. Speaks in short declaratives. Has been holding
  this village together alone for too long and is not going to say so.
- Torvin the blacksmith: blunt, warm underneath, deflects worry into work. Swears
  by his tools. Gives you his hammer and pretends it is nothing.
- Mira the scholar: absent, excitable, talks too fast, keeps interrupting herself
  with parentheticals. Is the only one who actually understands what the Ember is.
- Pim: a kid. Frightened, asks the questions the player is thinking, gives you bread.
Each major NPC needs at least two branching dialogue choices that change the reply
(not the outcome — keep the quest chain linear so the pacing holds).

The quest engine must drive: an objective tracker string, a compass waypoint target,
toast notifications on quest start/complete, and the event hooks
('blockBroken','mobKilled','itemPicked','npcTalked','areaEntered','blockPlaced').

DialogueBox: a vanilla-styled panel across the bottom third — a dark panel with the
GUI border, a portrait box on the left (draw a simple procedural face for each NPC),
the speaker name above it in their accent colour, typewriter text at the settings'
textSpeed, a blinking continue arrow, and a choice list that highlights on hover /
arrow keys. Space or click advances; a click while typing completes the line instantly.

quests.js defines the chain declaratively: each quest has id, title, description,
objectives (with type, target, count, and a live progress getter), onStart, onComplete,
rewards, waypoint, and the dialogue node it opens. Keep the total to about 10 minutes
of play: quest 2 is ~90s, quest 3 ~2min, quest 4 is a 90s timed defence, quest 5
~2min of travel, quest 6 the ~2.5min boss, quest 7 the ending.

npc.js: NPCs stand near their post, turn to face a nearby player, bob idly, show a
floating indicator when they have dialogue available, and are interacted with via the
use key within 3 blocks. They must never wander far from their spawn or block doorways.`,
  },
]

phase('Implement')
const built = await parallel(
  JOBS.map((j) => () =>
    agent(`${PREAMBLE}\n\n=== YOUR ASSIGNMENT ===\n${j.prompt}`, {
      label: j.label, phase: 'Implement', schema: SCHEMA,
    }).then((r) => (r ? { key: j.key, ...r } : { key: j.key, files: [], exports: [], imports: [], notes: 'AGENT FAILED' }))
  )
)

log(`implemented ${built.filter((b) => b.files.length).length}/${JOBS.length} module groups`)

// Build a global symbol table so the auditor can check cross-module imports.
const symbolTable = {}
for (const b of built) for (const e of b.exports || []) symbolTable[e.file] = e.names

phase('Audit')
const audits = await parallel(
  built.filter((b) => b.files.length).map((b) => () =>
    agent(
      `You are auditing freshly written JavaScript for a browser game at ${ROOT}.
There is no linter and no node available, so YOU are the only check before this code
hits a browser. A single mistake is a black screen.

READ EVERY ONE OF THESE FILES IN FULL with the Read tool:
${b.files.map((f) => '  - ' + f).join('\n')}

Check, and FIX with Edit/Write as you go:
1. SYNTAX. Balanced braces, parens and brackets. No commas between class methods.
   No trailing comma in a function parameter list. Every template literal and every
   string closed. No duplicate const/let in the same scope. No use of a reserved word
   as an identifier. No 'return' outside a function. Correct arrow-function bodies.
2. IMPORTS. Every import path must resolve to a real file on disk (check with Read or
   Glob) and every imported name must actually be exported by that file. Relative paths
   must be correct for the importing file's directory. All must end in '.js'.
   Here is what the other agents exported this run:
${JSON.stringify(symbolTable, null, 1)}
   And ARCHITECTURE.md lists everything that already existed — read it.
3. EXPORTS. Every name ARCHITECTURE.md says this module must export is actually
   exported, spelled exactly right.
4. RUNTIME LANDMINES. Reading a property off something that can be null/undefined
   at init time; calling a method on an optional subsystem without ?.; array index
   off-by-one; using a variable before its declaration in the same scope (TDZ);
   infinite while loops with no guaranteed exit; recursion with no base case.
5. STUBS. Any function that is empty, returns null where behaviour was specified,
   or contains TODO / 'not implemented' — implement it properly.

Fix everything you find. Do not refactor working code, do not rename exports, and do
not touch files outside the list above.`,
      { label: `audit:${b.key}`, phase: 'Audit', schema: {
        type: 'object', additionalProperties: false, required: ['fixed', 'remaining'],
        properties: {
          fixed: { type: 'array', items: { type: 'string' }, description: 'issues found and fixed' },
          remaining: { type: 'array', items: { type: 'string' }, description: 'issues you could NOT fix, and why' },
        },
      } }
    ).then((r) => ({ key: b.key, ...(r || { fixed: [], remaining: ['audit agent failed'] }) }))
  )
)

return { built, audits }
