# Model library

A library of about 800 CC0 models (Quaternius packs) that can be used to build rooms, props and characters.

- **Catalog:** `assets/catalog/catalog.json` has one row per model, with:
  - `pack`, `id` and `source` (its path in the raw library)
  - triangle count, materials and texture sizes
  - bounding `size` in source units
  - `rig` (models with the same rig share animations) and `anims`
- **Thumbnails:** `assets/catalog/thumbs/<pack>/<id>.webp`.
- **Web-ready models:** all 812 live in [nikitapage10/models](https://github.com/nikitapage10/models) as meshopt GLBs (textures at most 1024 px WebP), at `<pack>/<id>.glb`.
  - `scripts/vendor-models.mjs` copies the ones the app uses into `apps/world/public/models/lib/`.
- **Raw files:** the original FBX/OBJ/Blender files and full-size textures are not in git. `scripts/fetch-assets.sh [dest]` downloads and unpacks them (about 1.5 GB zipped, 2.4 GB extracted) to `$CEO_ASSETS` or `~/.cache/ceo-assets`.

## Packs

| Pack | What | Rig / animations |
| --- | --- | --- |
| `men`, `women` | Ultimate Modular Men/Women: 21 casual, suit, worker, sci-fi, witch, king… characters, flat colours | shared 62-bone rig, 24 clips (Idle, Walk, Run, Interact, Wave, Death…) |
| `robots` | George, Leela, Mike, Stan: textured robots | own rigs, 20 clips (Dance, Hello, Yes/No, Walk_Holding, Pickup…) |
| `monsters` | Ultimate Monsters: 50 Big / Blob / Flying creatures | per-family rigs, 14 clips |
| `animals` | Ultimate Animated Animals: 12 farm and wild animals | own rigs, 13 clips |
| `bestiary`, `outfits`, `ual2` | Imp, Puglin; Fantasy outfits (peasant, ranger); Universal Animation Library 2 and a female mannequin | all on the Quaternius universal rig; UAL2's free tier has 43 extra clips but no basic idle, walk or run, which come from Universal Animation Library 1 |
| `fantasy-props` | 94 props: books, bookcases, candles, chests, potions, furniture | static (one rigged chest) |
| `scifi-essentials` | 37 props: desks, chairs, crates, shelves, lockers, drones | static, plus 3 animated drones |
| `scifi-modular` | 189 kit pieces: walls, platforms, stairs, rails, columns, decals, 3 aliens | static |
| `nature` | 68 trees, bushes, flowers, grass, rocks, paths | static |
| `medieval` | 176 village kit pieces: walls, roofs, doors, windows, stairs, fences | static |
| `downtown` | 153 city kit pieces: brick and metal facades, streets, decals, 3 whole buildings | static |

Two items in the raw library are not in the catalog:
- An alien pack that is FBX only (needs conversion).
- A folder of Tide concept-art PNGs.

All packs are CC0 by Quaternius ([quaternius.com](https://quaternius.com)).
