# Quorum logo proposal — Common Ground

Recommended direction: **seven identical, evenly spaced rounded arcs forming a
circle, with an eighth diagonal segment overlaid equally on both neighboring
arcs at the bottom right to form a Q**. The circle retains its original
seven-part geometry. Half of the diagonal segment lies inside the circle and
half outside it. The tail is centered across the gap between its two neighbors,
overlapping both equally.
The arcs represent independent participants; their equal weight expresses a
collaboration between peers. The open center is their common ground, and the
complete circular arrangement expresses a shared accord. The eighth part gives
the mark its Q tail, with rounded ends and a midpoint on the circle's centerline.

This suits Quorum's purpose: independent operators contributing observations
and reaching agreement on a shared result. The segment count is a visual motif,
not a statement about the protocol's operator count or voting threshold.

Suggested tagline: **Many voices. One accord.**

Starting at the top and moving clockwise, the seven circle segments repeat
**violet → blue → green → violet → blue → green → violet**. The eighth segment,
the overlaid Q tail, continues the sequence in **blue**.

## Files

- [quorum-mark.svg](quorum-mark.svg) — violet, blue, green mark, transparent background.
- [quorum-mark-mono.svg](quorum-mark-mono.svg) — one-color mark using `currentColor`.
- [concept.svg](concept.svg) — editable presentation of the proposed identity.
- [concept.png](concept.png) — rendered preview for quick review and sharing.

## Color and typography

| Use | Color |
| --- | --- |
| Violet | `#7C3AED` |
| Blue | `#2563EB` |
| Green | `#16A34A` |
| Ink | `#202727` |
| Warm paper | `#F7F7F2` |
| Dark surface | `#182B39` |

The mark repeats violet, blue, and green. Ink and paper come from the frontend.
For a final wordmark, pair the mark with the project's existing
**Space Grotesk Medium** typeface. The presentation uses DejaVu Sans for portable
rendering; its lettering is a layout suggestion, not a finalized wordmark.

## Usage

The standalone marks are scalable SVGs with no fonts or external dependencies.
Keep clear space around the visible mark of at least one stroke width (26 units
in the 256-unit viewBox). The color mark is shown on light and dark backgrounds;
the monochrome version supports single-color use. Prefer at least 32 px to keep the
gaps between the circle segments clear. The eighth segment overlaps the circle
and is drawn last, above the seven arcs.

When the monochrome SVG is embedded inline, set CSS `color` to change its ink.
When loaded through an `<img>`, its default is black; set a fixed stroke color in
the file to export another color.

These files are a proposal for review. The website and its current favicon have
not been changed.
