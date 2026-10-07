# Threadlane icon

`source.png` is the exact user-supplied **Elegant Black Flame Swoosh.png**, downloaded on October 7, 2026. It is a 1254×1254 RGB PNG with an opaque white background. SHA-256: `87e948d50248a3fa9dc482c3213ffdec1f8253dd33a4eb17f671d25ca9c8dbf0`.

The four packaged icons are direct square resizes of this source, preserving the supplied artwork and margins. Generate them on macOS with:

```sh
for icon_size in 16 32 48 128; do
  sips -z "$icon_size" "$icon_size" assets/icons/source.png --out "assets/icons/$icon_size.png"
done
```

`icon.svg` is a preview wrapper referencing the raster source, not a vector recreation. The build copies only `16.png`, `32.png`, `48.png`, and `128.png` into Chrome, Chrome beta, and Firefox packages. The source and this documentation stay outside release ZIPs.

Use `128.png` for the Chrome Store icon. The matching promotional SVG embeds that same PNG and is rendered separately to the required 440×280 opaque PNG. Store submission does not imply publication; see [the submission record](../../store/SUBMISSION_STATUS.md).
