# Design System — Ink & Circuit

The openloomi-loop web UI is built on the **Ink & Circuit** visual language. The reference HTML at `references/index.html` is a pure static style showcase — no JavaScript, no canvas, no real data — that demonstrates every token, component, and animation pattern in one page. This document is the source of truth for tokens, typography, layout, and component patterns. Update it first when extending the visual language.

This document is the source of truth for tokens, typography, layout, and component patterns. Update it first when extending the visual language.

---

## Design philosophy

- **Ink** — heavy contrast, dark canvas, monospace for data, monospace UI hints
- **Circuit** — amber trace lines, corner decoration, hex node markers, sonar/particle motion
- **Crosshair cursor** — every interactive surface
- **Diagonal hatch background** — subtle repeating-linear-gradient in amber, both 45° and -45°

---

## Color tokens (CSS variables)

```css
:root{
  /* canvas */
  --bg:   #111008;   /* deepest */
  --bg2:  #1a1610;
  --bg3:  #201e14;

  /* amber — primary accent (text, borders, lines, "you are here") */
  --amber:   #e8a020;
  --amber2:  #c8880e;
  --amber3:  #f0b840;

  /* text */
  --text:   #f0ead8;   /* body */
  --text2:  #a09880;   /* secondary */
  --text3:  #706850;   /* hints, dividers */

  /* semantic */
  --green:  #4a7c59;   /* "live" indicator, success */

  /* category (knowledge graph original palette) */
  --person:      #f0c070;
  --institution: #5ba8d4;
  --venture:     #7ed488;
  --discourse:   #c87de8;
  --chronicle:   #e87070;

  /* decision types (openloomi-loop adaptation) */
  --rsvp:        #f0b840;   /* calendar RSVP         — amber3 */
  --draft_reply: #7ed488;   /* email reply           — green  */
  --review_pr:   #5ba8d4;   /* github PR review      — blue   */
  --slack_reply: #c87de8;   /* slack                 — purple */
  --todo:        #e87070;   /* task                  — red    */

  /* layout */
  --panel-w: 340px;  /* reference; web UI uses 360px */
}
```

Background hatch:
```css
body::before{
  content:''; position:fixed; inset:0; pointer-events:none; z-index:0;
  background-image:
    repeating-linear-gradient(45deg, rgba(200,160,80,.06) 0, rgba(200,160,80,.06) 1px, transparent 1px, transparent 40px),
    repeating-linear-gradient(-45deg, rgba(200,160,80,.06) 0, rgba(200,160,80,.06) 1px, transparent 1px, transparent 40px);
}
```

---

## Typography

```html
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Space+Grotesk:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

| Family | Use | Weights | Style |
|---|---|---|---|
| **Syne** | Display titles, view tabs, column headers | 700, 800 | `font-weight:800; font-size:16px; letter-spacing:.12em; text-transform:uppercase` |
| **Space Grotesk** | Body, descriptions, names | 300–600 | default body font |
| **JetBrains Mono** | Mono data, metadata, hints, code | 400, 500 | `font-size:9–10px; letter-spacing:.08–.12em; text-transform:uppercase` for chips/badges |

Type scale (effective):
- Title: 16px Syne 800, letter-spacing .12em, UPPER
- Section header: 10–11px Syne 700, letter-spacing .14em, UPPER
- Body: 11–12px Space Grotesk
- Mono / hint: 9–10px JetBrains Mono
- Code / JSON: 10px JetBrains Mono on `rgba(0,0,0,.4)` background

---

## Layout patterns

### Header bar
```css
header {
  display:flex; align-items:center; gap:12px;
  padding:10px 16px 8px;
  border-bottom:1px solid rgba(232,160,32,.2);
}
.hd-title {
  font-family:'Syne',sans-serif; font-weight:800; font-size:16px;
  letter-spacing:.12em; color:var(--amber); text-transform:uppercase;
  position:relative; white-space:nowrap;
}
.hd-title::after { /* pulsing underline */
  content:''; position:absolute; bottom:-2px; left:0; width:100%; height:1px;
  background:var(--amber); animation:pulse-line 2.4s ease-in-out infinite;
}
@keyframes pulse-line{ 0%,100%{opacity:1; box-shadow:0 0 6px var(--amber)} 50%{opacity:.3; box-shadow:none} }
```

### View tabs
```css
.vtab {
  font-family:'Syne',sans-serif; font-weight:700; font-size:10px;
  letter-spacing:.1em; padding:4px 10px;
  border:1px solid rgba(232,160,32,.25);
  background:transparent; color:var(--text3); cursor:pointer;
}
.vtab:hover { color:var(--amber); border-color:var(--amber); }
.vtab.on    { background:rgba(232,160,32,.15); color:var(--amber); border-color:var(--amber); }
```

### Filter chips (type / category)
```css
.chip {
  font-family:'JetBrains Mono',monospace; font-size:9px;
  padding:3px 7px; border:1px solid rgba(255,255,255,.12);
  opacity:.5; cursor:pointer;
}
.chip .dot { /* hex marker */
  width:7px; height:7px;
  clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
}
.chip.on { opacity:1; }
```

### Kanban column header
```css
.kch { /* column header */
  font-family:'Syne',sans-serif; font-weight:700; font-size:10px;
  letter-spacing:.12em; text-transform:uppercase;
  padding:7px 8px; border-bottom:2px solid; margin-bottom:6px;
}
```

### Card (kanban)
```css
.kcard {
  background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.07);
  border-left:3px solid; /* category color */
  padding:7px 9px; cursor:pointer;
}
.kcard:hover { background:rgba(255,255,255,.08); }
```

### Detail panel (right slide-in)
```css
#dp {
  position:fixed; top:0; right:0; width:var(--panel-w); height:100vh;
  background:rgba(18,16,9,.97);
  border-left:1px solid rgba(232,160,32,.18);
  transform:translateX(100%);
  transition:transform .3s cubic-bezier(.4,0,.2,1);
  z-index:100; backdrop-filter:blur(8px);
  overflow-y:auto;
}
#dp.on { transform:translateX(0); }
```

### Section label (inside detail)
```css
.dp-sl {
  font-family:'JetBrains Mono',monospace; font-size:8px;
  letter-spacing:.12em; text-transform:uppercase; color:var(--amber);
  display:flex; align-items:center; gap:6px;
}
.dp-sl::before { content:''; width:8px; height:1px; background:var(--amber); }
```

### Search overlay
```css
#so {
  display:none; position:fixed; inset:0; z-index:200;
  background:rgba(0,0,0,.72); backdrop-filter:blur(4px);
  align-items:flex-start; justify-content:center; padding-top:70px;
}
#so.on { display:flex; }
.sbox { width:540px; max-height:65vh; background:#191710; border:1px solid rgba(232,160,32,.4); }
```

### Hex marker (universal)
```css
clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
```

### Circuit corner decoration
```html
<svg class="cc tl" width="72" height="72" viewBox="0 0 72 72">
  <path d="M2,62 L2,18 Q2,2 18,2 L62,2" stroke="#e8a020" stroke-width="1.2" fill="none"/>
  <circle cx="2" cy="62" r="3" fill="#e8a020"/>
  <circle cx="62" cy="2" r="3" fill="#e8a020"/>
  <path d="M12,52 L12,28 L28,12" stroke="#4a7c59" stroke-width=".7" fill="none"/>
  <circle cx="12" cy="52" r="2" fill="#4a7c59"/>
  <circle cx="28" cy="12" r="2" fill="#4a7c59"/>
  <rect x="0" y="28" width="4" height="4" fill="none" stroke="#e8a020" stroke-width=".8"/>
</svg>
```
Four corners (`.tl` `.tr` `.bl` `.br`); mirror with `transform: scaleX(-1)` / `scaleY(-1)` / `scale(-1)`.

---

## Animation patterns

| Name | Use | Pattern |
|---|---|---|
| `pulse-line` | Header title underline | `2.4s ease-in-out infinite`, opacity 1↔.3 + box-shadow 0↔6px |
| `blink` | LIVE indicator dot | `1.6s ease-in-out infinite`, opacity 1↔.3 |
| Edge particles | Graph edges | Push amber dot, fade `0.85 - t*0.5` |
| Sonar rings | On node select/click | radius `+=1.6` per frame, alpha `*=.955` |
| Panel slide-in | Detail panel | `transform: translateX(100%)` → `0` over `.3s cubic-bezier(.4,0,.2,1)` |

---

## Component inventory

| Component | Files | Purpose |
|---|---|---|
| `header` | every page | brand + meta + view tabs + search |
| `chips` | header | filter pills, 1=type, 2=source, etc. |
| `kanban` | Queue view | 3-column boards, scrollable cards |
| `card` | inside kanban / activity | type badge + title + context + person + memory + action |
| `timeline` | Timeline view | canvas + sim physics + hex nodes |
| `split` | Activity view | live feed + recent list |
| `detail-panel` | everywhere | slide-in right panel with full context |
| `search` | global | `/` or Cmd-R opens overlay |
| `toast` | global | bottom-center, fades 2.2s |

---

## Keyboard

| Key | Action |
|---|---|
| `Q` / `T` / `A` | Queue / Timeline / Activity |
| `/` | Search |
| `↑` `↓` | Navigate search |
| `Enter` | Run selected (in detail) / open in search |
| `Esc` | Close panel / overlay |
| `R` (alt) | Open search (in some views) |
| `H` | Reset view (in original graph) |
| `+` / `-` | Zoom (graph views) |

---

## Adapting to a new domain

1. Define `TC` (color) + `TL` (label) + `TORD` (order) for your node types in JS
2. Update CSS variables for the new colors
3. Add `.t-<type>` class on cards for left-border + badge color
4. Add chip filter row in header
5. Update search predicate if you want to search new fields
6. Update detail panel's context formatter to render new payload shape

The web UI in `web/index.html` is the canonical reference implementation. Copy it as the starting point for any new Ink & Circuit surface.

---

## Files in this reference

- `references/index.html` — **static style showcase**. Open in a browser to see all tokens, typography, components, and animations in one page. No JS, no canvas, all placeholder text.
- `references/DESIGN.md` — this document
- `web/index.html` — openloomi-loop web UI (live implementation of the design system, wired to real signals/decisions)
