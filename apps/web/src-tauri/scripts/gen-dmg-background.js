// Generates the DMG installer background PNGs for macOS.
// Zero external dependencies — writes raw PNG bytes (RGBA) so it works
// in any CI / Node environment, mirroring the layout of mainstream macOS
// DMG installers: light-grey canvas + a centered grey dashed right-arrow.
//
// Output:
//   dmg-background.png    (660 x 400  @1x)
//   dmg-background@2x.png (1320 x 800 @2x)
//
// Usage: node gen-dmg-background.js [outputDir]

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUT_DIR =
  process.argv[2] ||
  path.resolve(new URL(".", import.meta.url).pathname, "..", "icons");

// ---------- tiny PNG encoder (RGBA8) ----------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Add filter byte (0 = None) at the start of each row
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- drawing helpers ----------
function makeCanvas(w, h) {
  return {
    w,
    h,
    data: Buffer.alloc(w * h * 4),
  };
}

function setPixel(c, x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  // Simple alpha over (src over dst)
  const sa = a / 255;
  const da = c.data[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  c.data[i] = Math.round((r * sa + c.data[i] * da * (1 - sa)) / oa);
  c.data[i + 1] = Math.round((g * sa + c.data[i + 1] * da * (1 - sa)) / oa);
  c.data[i + 2] = Math.round((b * sa + c.data[i + 2] * da * (1 - sa)) / oa);
  c.data[i + 3] = Math.round(oa * 255);
}

function fillRect(c, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      setPixel(c, xx, yy, color);
    }
  }
}

// Filled disc via midpoint algorithm. (cx, cy) center, r radius (px).
// AA edge pixels are blended so small discs (r=1..2) read as round dots
// rather than the diamond/plus shape a naive x^2+y^2 test produces.
function fillCircle(c, cx, cy, r, color) {
  const ri = Math.max(1, Math.round(r));
  const [cr, cg, cb, ca] = color;
  for (let y = -ri; y <= ri; y++) {
    for (let x = -ri; x <= ri; x++) {
      // Distance from the disc edge: <=0 inside, 0..1 on the boundary.
      const d = Math.sqrt(x * x + y * y) - r;
      if (d <= 0) {
        setPixel(c, Math.round(cx) + x, Math.round(cy) + y, color);
      } else if (d < 1) {
        // Anti-alias the rim: blend edge coverage by how far past r we are.
        const edge = (1 - d) * (ca / 255);
        setPixel(c, Math.round(cx) + x, Math.round(cy) + y, [
          cr,
          cg,
          cb,
          Math.round(edge * 255),
        ]);
      }
    }
  }
}

// Dotted line: stamps solid filled dots along (x1,y1)->(x2,y2) at a fixed
// spacing, each dot a small circle of radius `r`. Produces the classic
// "dotted outline" look (not rectangular dashes).
function dottedLine(c, x1, y1, x2, y2, color, spacing, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    fillCircle(c, x1, y1, r, color);
    return;
  }
  const ux = dx / len;
  const uy = dy / len;
  // Stamp a dot every `spacing` px along the line.
  for (let d = 0; d <= len; d += spacing) {
    fillCircle(c, x1 + ux * d, y1 + uy * d, r, color);
  }
}

// ---------- render the background at a given scale ----------
// Base design (@1x = 660 x 400). All coordinates scale with `s`.
//
// The middle element is a HOLLOW right-arrow (rectangle body + triangular
// tip), whose OUTLINE is drawn as a dashed/dotted line and whose interior
// is transparent. This matches the classic macOS DMG installer arrow used
// by apps like Manus / Slack.
//
// Icon layout (set by beautify-dmg.js): two icons centered at
// (180,170) and (480,170), iconSize 128. The arrow sits in the gap
// between them (x ≈ 244..416), vertically centered on y=170.
function render(s) {
  const W = Math.round(660 * s);
  const H = Math.round(400 * s);
  const c = makeCanvas(W, H);

  // 1) Light-grey background (#f5f5f7, opaque)
  fillRect(c, 0, 0, W, H, [0xf5, 0xf5, 0xf7, 255]);

  // 2) Hollow right-arrow outline as a DOTTED line (solid round dots).
  //    SEVEN vertices traced clockwise. The body is a slim rectangle; the
  //    arrowhead's two roots FLARE OUTWARD past the body's top/bottom edges
  //    (not inward), so the triangular head is visibly wider than the body —
  //    a clear, open arrow silhouette (classic macOS DMG style).
  const color = [0x8e, 0x8e, 0x93, 255]; // light grey

  // Dots are tiny round points. Radius 1 + AA keeps them circular (a bare
  // r=1 without AA reads as a plus/cross). They scale with canvas s only.
  const dotRadius = 1 * s; // small solid round dot
  const spacing = Math.round(4.5 * s); // distance between dot centers

  // Arrow placement: center the arrow's OVERALL bounding box on the midpoint
  // between the two icons (left app icon at x=180, right Applications alias
  // at x=480 → midpoint 330). The arrow is asymmetric (body + right tip), so
  // its body center (ax) must sit LEFT of the icon midpoint by tip/2, else the
  // tip makes the arrow read as shifted toward the right folder.
  const iconMid = 330; // (180 + 480) / 2
  const hw = 22; // body half-width  @1x (full 44)
  const hh = 26; // body half-height @1x (full 52)
  const flare = 22; // tip roots flare OUTWARD beyond body top/bottom
  const tip = 46; // tip extension beyond body right edge
  // bbox spans [ax-hw, ax+hw+tip]; center it on iconMid:
  const ax = (iconMid - tip / 2) * s;
  const ay = 170 * s;

  // Seven-vertex polygon, clockwise from left-top. Vertices 2 and 4 are the
  // OUTWARD-flared tip roots (y past ay±hh), making the head wider than body.
  // hw/hh/flare/tip are @1x half-sizes; scale each by s here.
  const v = [
    [ax - hw * s, ay - hh * s], // 0 left-top
    [ax + hw * s, ay - hh * s], // 1 body right-top corner
    [ax + hw * s, ay - (hh + flare) * s], // 2 tip upper root (outward)
    [ax + (hw + tip) * s, ay], // 3 tip point
    [ax + hw * s, ay + (hh + flare) * s], // 4 tip lower root (outward)
    [ax + hw * s, ay + hh * s], // 5 body right-bottom corner
    [ax - hw * s, ay + hh * s], // 6 left-bottom
  ];

  // Trace each edge with dots, closing back to the first vertex.
  for (let i = 0; i < v.length; i++) {
    const [x1, y1] = v[i];
    const [x2, y2] = v[(i + 1) % v.length];
    dottedLine(c, x1, y1, x2, y2, color, spacing, dotRadius);
  }

  return encodePng(W, H, c.data);
}

// ---------- main ----------
mkdirSync(OUT_DIR, { recursive: true });
const png1 = render(1);
const png2 = render(2);
writeFileSync(path.join(OUT_DIR, "dmg-background.png"), png1);
writeFileSync(path.join(OUT_DIR, "dmg-background@2x.png"), png2);
console.log(`[gen-dmg-background] wrote:
  - ${path.join(OUT_DIR, "dmg-background.png")} (${660}x${400})
  - ${path.join(OUT_DIR, "dmg-background@2x.png")} (${1320}x${800})`);
