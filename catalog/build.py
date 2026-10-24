#!/usr/bin/env python3
"""Builds the plugin catalog: catalog/src/<pack>/ -> catalog/packs/<id>-<version>.xcpack and
catalog/index.json (sha256 + size per pack). Python 3 standard library only.

LUT files named in a manifest but missing from the source folder are generated from looks.py,
so the repository keeps the recipes, not megabytes of numbers. The output is reproducible:
fixed zip timestamps and sorted entries give the same bytes (and checksums) on every run.
"""
import hashlib
import json
import pathlib
import sys
import zipfile

import looks

ROOT = pathlib.Path(__file__).resolve().parent
RAW = "https://raw.githubusercontent.com/sxmsoft/xenocut/main/catalog/"
STAMP = (2026, 1, 1, 0, 0, 0)


def pack_files(src: pathlib.Path, manifest: dict) -> dict:
    files = {}
    for path in sorted(src.rglob("*")):
        if path.is_file():
            files[path.relative_to(src).as_posix()] = path.read_bytes()
    for lut in manifest.get("luts", []):
        rel = lut["file"]
        if rel not in files:
            stem = pathlib.PurePosixPath(rel).stem
            if stem not in looks.LOOKS:
                sys.exit(f"{manifest['id']}: {rel} is missing and has no recipe in looks.py")
            files[rel] = looks.cube_text(lut["name"], looks.LOOKS[stem]).encode()
    return files


def main():
    out_dir = ROOT / "packs"
    out_dir.mkdir(exist_ok=True)
    entries = []
    for src in sorted(p for p in (ROOT / "src").iterdir() if p.is_dir()):
        manifest = json.loads((src / "manifest.json").read_text())
        files = pack_files(src, manifest)
        name = f"{manifest['id']}-{manifest['version']}.xcpack"
        target = out_dir / name
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for rel in sorted(files):
                info = zipfile.ZipInfo(rel, STAMP)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                z.writestr(info, files[rel])
        data = target.read_bytes()
        thumb = ROOT / "thumbs" / f"{manifest['id']}.jpg"
        entries.append(
            {
                "id": manifest["id"],
                "name": manifest["name"],
                "version": manifest["version"],
                "author": manifest["author"],
                "license": manifest["license"],
                "homepage": manifest.get("homepage"),
                "description": manifest["description"],
                "url": RAW + "packs/" + name,
                "sha256": hashlib.sha256(data).hexdigest(),
                "bytes": len(data),
                "thumbnail": RAW + "thumbs/" + thumb.name if thumb.exists() else None,
                "contents": {k: len(manifest[k]) for k in ("effects", "animations", "luts", "textPresets") if manifest.get(k)},
            }
        )
        print(f"{name}: {len(data) / 1024:.0f} KB")
    for stale in out_dir.glob("*.xcpack"):
        if stale.name not in {e["url"].rsplit("/", 1)[1] for e in entries}:
            stale.unlink()
    index = {"format": "xenocut-catalog/1", "packs": entries}
    (ROOT / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
