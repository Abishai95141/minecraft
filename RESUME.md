# SowmiCraft — build state

**Status: playable.** Title screen → world generation → survival sandbox, and the
full seven-quest story from Ashfall to the ending, verified end to end in a browser.

## Running it

```bash
./serve.sh            # macOS / Linux
.\serve.ps1           # Windows (no Node or Python needed)
```

Open <http://localhost:8000>. Needs WebGL2.

## Verified

Everything below was checked by driving the real game in a browser, not by reading code.

| area | result |
|---|---|
| textures | 272 atlas layers, all with real content — no placeholders, no blank tiles |
| blocks | every block renders in-world; cubes, cross plants, fluids, slabs, stairs, panes, doors, torches, carpets |
| mining times | match vanilla exactly — stone by hand 7.5s, wooden pick 1.15s, diamond 0.3s, obsidian 9.4s |
| crafting | shaped, shapeless, offset and mirrored matching; negative cases reject |
| combat | damage, armour, i-frames, knockback |
| mobs | 10 types render with correct models and skins; AI, ranged attacks, daylight burning, loot drops |
| audio | 22 synthesised effects + music start/stop, no files |
| screens | all 9 menus render clean; inventory, crafting, furnace, chest |
| story | all 7 quests complete in sequence, including the timed siege, the boss, dying and respawning mid-fight, and the ending |

## Bugs found and fixed during that pass

- **Spawning in water on every seed.** Gradient noise is exactly zero at a lattice
  point, so the world origin classified as `river` regardless of seed. Fixed with a
  seed-derived domain offset, plus a real spawn search for dry, flat land.
- **Holes you could see the caves through.** Chunks in `startWorld`'s outer ring were
  never queued for population, so they were never lit or meshed. Population is now
  derived from world state each tick. Lighting and meshing also iterated chunks in
  insertion order against a budget, starving the chunk underfoot; all three stages now
  sort by distance. The mesh loop also dropped sections when its budget ran out.
- **Two story soft-locks.** `advance(questId)` restarted the quest already running,
  wiping its progress; and a mob could sit at 0 health without ever dying, so
  `mobKilled` never fired and a kill objective stalled forever.
- **HUD bleeding through menus** — chat and the objective tracker drew over the options
  screen, and the inventory rendered two hotbars.
- Fog started at 0.55 of view distance and washed out the world; clouds were scaled in
  cells so a "7" spanned 84 blocks and read as a ceiling; spawn dropped you on treetops.

## Known rough edges

- The Warden fight is tuned around ~25 sword hits; it has not been balance-tested
  against a player who is actually dodging.
- Story pacing is designed for ~10 minutes but has only been driven programmatically,
  not played at human speed.
- Performance is unmeasured on low-end GPUs; render distance 8 gives ~270k quads.

## Layout

```
src/core/     math, seeded RNG, noise, vanilla physics constants, settings, input, storage
src/world/    blocks, chunks, world, worldgen, biomes, lighting, structures
src/render/   painter, ~270 procedural textures, atlas, mesher, world renderer, sky,
              particles, models, entity skins + renderer
src/entity/   entity/physics, mobs, AI, items on the ground, player
src/item/     item registry, inventory, recipes, smelting
src/ui/       bitmap font, logo, widgets, HUD, icons, screens/
src/audio/    synthesised SFX and original music
src/story/    the seven-quest campaign, NPCs, dialogue
tools/        build-workflow.js, and the Node checker/smoke tests if Node is available
docs/         ARCHITECTURE.md contracts, BUILD-NOTES.md, 10 research dossiers
```

## Environment notes

- Cross-platform, no build step, no dependencies, no binary assets.
- `serve.ps1` also exposes `POST /__shot` which writes a base64 screenshot to `.shots/`
  — that is how the game was verified visually when the browser pane could not
  composite frames.
- `tools/check.mjs` and `tools/smoke.mjs` need Node 22; they are optional.
