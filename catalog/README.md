# XenoCut plugin catalog

The in-app **Plugins → Catalog** page reads `index.json` from this folder (raw GitHub) and
installs packs from `packs/` after checking their SHA-256. Every pack here is data only
(see [docs/plugins.md](../docs/plugins.md)) and released under **CC0 1.0**.

| Pack | Contents |
| --- | --- |
| Film Looks | 6 LUTs: Teal & Orange, Warm Film, Bleach Bypass, Silver Mono, Vintage 70s, Matte Fade |
| Creative Color | 6 LUTs: Cool Night, Cross Process, Golden Hour, Neon Night, Forest Green, Desert Dust |
| Social Looks | 10 effect stacks: Moody, Clean Pop, Retro Cam, Summer, Night Drive, Lo-fi, Comic, Ghost, Documentary, Epic |
| Motion Essentials | 14 clip animations (6 In, 4 Out, 4 Combo) |
| Title Styles | 8 text styles using the bundled fonts |

## Building

```sh
python3 catalog/build.py
```

`src/<pack>/manifest.json` is the source of each pack. LUT files listed in a manifest but not
present are generated from the recipes in `looks.py` (25³ `.cube`). The script writes
`packs/<id>-<version>.xcpack` and `index.json`; output is byte-for-byte reproducible.
`cargo test catalog_packs_install` installs every pack with the app's own validator.

Adding a third-party pack: it must use a permissive license (CC0, CC-BY, MIT, BSD, Apache),
name its author and license in the manifest, and pass the same test.

## Thumbnails

`thumbs/` shows LUT packs on a frame of *Big Buck Bunny* (© Blender Foundation,
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), peach.blender.org). The thumbnails
are not part of the packs.
