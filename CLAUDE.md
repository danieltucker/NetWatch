# Watchtower Design Language — Agent Guide

You are building a **…Watch** product (NetWatch, LogWatch, and future siblings). Every
app in this family shares one design language so that *learning one app teaches you all
of them*. This file is the contract. Follow it for every screen you build.

**Source of truth:** `watchtower.css`. Never hardcode a color, font, radius, or shadow
that has a token. If you need a value, look it up here or in that file. If a token does
not exist for something, derive it in OKLCH from the closest existing token — never
invent a raw hex.

---

## 1. Setup (do this once per app)

1. Drop `watchtower.css` into the project and load it **before** any app-specific CSS.
2. Load the two family typefaces (Google Fonts):

   ```html
   <link rel="preconnect" href="https://fonts.googleapis.com">
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
   ```

3. Put the theme on the root element: `<html data-theme="light">` (or `"dark"`).
   Toggling that one attribute re-maps every token — **no markup or class changes.**
4. Base body styles:

   ```css
   body { font-family: var(--wt-font-sans); color: var(--wt-text); background: var(--wt-bg); -webkit-font-smoothing: antialiased; line-height: 1.5; }
   ```

> In React/Vue/etc., keep `watchtower.css` as a global stylesheet and use the `wt-*`
> classes directly, or map the tokens into your styling solution. The **tokens and the
> rules below are the system** — the `.wt-*` classes are a convenient reference
> implementation, not the only way to consume it.

---

## 2. The five principles (these override everything)

1. **Calm by default, loud on failure.** A healthy system feels quiet. Most of every
   screen is white and slate. Spend color and weight *only* where something needs a
   human. Green is the resting state; red is earned.
2. **Words in sans, data in mono.** Prose, labels, and headings use Hanken Grotesk.
   Every metric, ID, timestamp, serial, code, and status word uses JetBrains Mono with
   tabular figures so columns never jitter as values change.
3. **Familiar across the family.** Same status language, same eyebrow labels, same
   tiles, same chrome in every app. Only the *subject* changes.
4. **Status color is semantic, never decorative.** The three status families mean
   exactly one thing each. Never borrow them for emphasis, charts, or accents.
5. **Color encodes good-vs-bad, not up-vs-down.** A rising latency number is *red*; a
   rising uptime number is *green*. The arrow shows direction; the color shows whether
   to care.

---

## 3. Naming a new app

Pattern: **`<Domain>Watch`**

- Domain is a short, concrete **noun** for *what is being watched* — never an adjective.
- One word, CamelCase, the **W** always capital. Spoken as one word.
- ✓ Do: BayWatch · NetWatch · LogWatch · GateWatch · FleetWatch
- ✕ Don't: SmartWatch · ProWatch · MyWatch · Watchful (vague / adjectival / off-pattern)
- Avoid confusing collisions with existing products (e.g. no `CloudWatch`).

In the wordmark, the domain is in the app's **signature ink** and "Watch" is in
`--wt-text`: `Net<b style="color:var(--nw-ink)">Watch</b>` → render as `Net**Watch**`.

---

## 4. Color

Four roles. Keep them strictly separated.

| Role | Tokens | Use for |
|---|---|---|
| **Brand (azure)** | `--wt-brand-50 … 900` | Family identity: primary buttons, focus rings, active nav, links. **Never** for status. |
| **Neutrals (cool slate)** | `--wt-n-0 … 950` | The workhorse. Surfaces, borders, text, tracks. ~80% of every screen. |
| **Status (semantic)** | `up` / `warn` / `down` ramps | Meaning only. See the status vocabulary below. |
| **Data-viz ramp** | `--wt-viz-1 … 7` | Chart series & categorical tags. Harmonised so no line shouts. Starts at brand, avoids pure status hues for neutral series. |

**Semantic role tokens** (prefer these over raw scale steps — they flip in dark mode):
`--wt-bg`, `--wt-surface`, `--wt-surface-2/3`, `--wt-border`, `--wt-border-strong`,
`--wt-text`, `--wt-text-muted`, `--wt-text-subtle`, `--wt-text-faint`.

### Status vocabulary — four shared states

Every app has native words; they all map onto **four** states with one color each.
Build the mapping once per app. **Never invent a fifth color.**

| State | Token family | Meaning | Loudness |
|---|---|---|---|
| **Up / OK** | `--wt-up-*` (green) | Healthy, resting | Quietest — tint only when needed |
| **Warn / Degraded** | `--wt-warn-*` (amber) | Needs attention soon | Medium |
| **Down / Error** | `--wt-down-*` (red) | Failing now | **Loudest the UI ever gets**: tinted surface + colored border + solid pill |
| **Muted / Unknown** | `--wt-n-*` neutral | Paused, no data | Silent |

Example mappings: NetWatch → `Up / Degraded / Down / Paused`. LogWatch →
`info / warn / error / debug`. Map your app's words onto these, don't add states.

---

## 5. Typography

Two faces, one rule: **words in sans, data in mono.**

- `--wt-font-sans` — Hanken Grotesk. UI text, labels, headings, paragraphs.
- `--wt-font-mono` — JetBrains Mono. All numbers/IDs/timestamps/code. Add `.wt-mono`
  (sets tabular + slashed-zero) or `.wt-tnum` for tabular figures.

Type scale (use the tokens, don't type raw px):
`--wt-text-xs 12 · sm 13 · base 15 · md 17 · lg 20 · xl 24 · 2xl 30 · 3xl 40 · 4xl 54`.

Headings: weight 700, `letter-spacing: -0.02em`. Metrics: mono, weight 600,
`letter-spacing: -0.02em`, with a small muted `<small>`/`sup` unit at ~0.5em.

### The eyebrow — the family signature

The single most recognizable family tic. A tiny mono, uppercase, letter-spaced label
above sections, tiles, and groups. Use it liberally.

```html
<span class="wt-eyebrow">P95 · last 24h</span>
```

✓ Set metrics in mono so `211ms → 358ms` never shifts width.
✕ Don't set running data in sans, or headings in mono — the hierarchy weakens.

---

## 6. Spacing, radius, elevation, motion

- **Spacing** — 4px base. Tokens `--wt-1 (4px) … --wt-20 (80px)`. Prefer flex/grid
  with `gap`; never bare inline-block siblings.
- **Radius** — `--wt-r-sm 6 · md 9 · lg 14 · xl 18 · 2xl 24 · pill 999 · squircle 28%`.
  Cards/panels = `lg`. Buttons/inputs = `md`. Pills = `pill`. App icons = `squircle`.
- **Elevation** — restrained, **hairline-first**. Most separation is a 1px
  `--wt-border`, not a shadow. Shadows `--wt-shadow-xs/sm/md/lg`; cards rest at `sm`,
  lift to `md` on hover. Focus = `--wt-ring-brand`.
- **Motion** — fast and crisp. `--wt-dur` (160ms) with `--wt-ease`
  (`cubic-bezier(0.32,0.72,0,1)`). Animate color/shadow/transform, not layout. No
  infinite decorative loops (the one exception: a slow "live" pulse on a status dot).

---

## 7. Per-app signature hue (how each sibling stays distinct)

Shared chrome, **one** accent per app. Define three vars in the app's `:root`, derived
from the family palette, and use them for: the app-icon gradient, the avatar, active
nav state, focus rings, and small brand accents. Everything else stays family-neutral.

```css
/* NetWatch — azure → violet */
:root { --nw-from: var(--wt-brand-500); --nw-to: oklch(0.480 0.150 290); --nw-ink: oklch(0.480 0.150 290); }
[data-theme="dark"] { --nw-ink: oklch(0.760 0.130 292); }

/* LogWatch — teal → blue, with a violet AI accent */
:root { --lw-from: oklch(0.700 0.130 200); --lw-to: oklch(0.520 0.120 230); --lw-ink: oklch(0.520 0.120 225); }
[data-theme="dark"] { --lw-ink: oklch(0.770 0.110 210); }
```

Rules for a new app's hue: pick a `--xx-ink` that is distinct from siblings, readable on
white, and **not** one of the status hues. Always provide a lighter dark-mode `--xx-ink`
for contrast. Use `color-mix(in oklch, var(--xx-ink) 12%, transparent)` for tinted
active/selected backgrounds.

---

## 8. Component catalog

All components are token-driven and theme-adaptive. Use these class names; build new
components in the same spirit (hairline borders, mono numbers, eyebrow labels).

**App icon** — squircle gradient lockup. Size via `--ai-size`, color via `--ai-from/to`.
```html
<span class="wt-appicon" style="--ai-size:30px; --ai-from:var(--nw-from); --ai-to:var(--nw-to);"><svg>…</svg></span>
```

**Status pill** — `wt-pill` + `--up/--warn/--down/--info/--muted` (or `--solid-up/down`).
```html
<span class="wt-pill wt-pill--down"><span class="wt-pill__dot"></span>Down</span>
```

**Buttons** — `wt-btn` + `--primary/--secondary/--ghost/--danger`, optional `--sm`.
```html
<button class="wt-btn wt-btn--primary"><svg>…</svg>Add monitor</button>
```

**Metric tile** — `wt-tile` (+ `--up/--warn/--down/--teal` to tint the icon). Value in
mono via `.wt-tile__value`; movement via `.wt-trend--up/--down` (good = up-green only
when up is good — see principle 5).

**Card / Panel** — `wt-card` (`--pad` for padding) and `wt-panel` (with
`__head/__title/__src/__body`) for dashboard tiles.

**Segmented control** — `wt-seg` with `<button aria-selected="true">` for the active
range/filter (24h · 7d · 30d).

**Tag chip** — `wt-chip` (auto `#` prefix; `--plain` to drop it).

**Form controls** — `wt-field`/`wt-label`/`wt-hint` wrapping `wt-input`, `wt-select`,
`wt-textarea` (`--mono` variant for inputs that hold data). Toggle = `wt-switch`.

**Meter / temp bar** — `wt-meter` + `wt-meter__fill` (`--temp` for the teal→green→amber→red gradient).

**Status-history strip** — `wt-history` of `<span>`s; add `.is-down/.is-warn/.is-none`.

**Health ring** — `wt-ring` (set `--val` and `--ring`).

**Console block** — `wt-console` (dark terminal surface that stays dark in both themes)
with `__bar/__body/__row` and `.c-prompt/.c-muted/.c-accent/.c-up` token spans.

---

## 9. App shell layout

The family chrome: fixed topbar + left sidebar + scrolling main.

```css
.app  { display:grid; grid-template-columns:224px 1fr; grid-template-rows:56px 1fr; height:100vh; overflow:hidden; }
.top  { grid-column:1/-1; display:flex; align-items:center; gap:16px; padding:0 16px; background:var(--wt-surface); border-bottom:1px solid var(--wt-border); }
.side { background:var(--wt-surface); border-right:1px solid var(--wt-border); padding:14px 12px; overflow-y:auto; }
main  { overflow-y:auto; }
```

- **Topbar:** app-icon + wordmark + version chip, a search field, a live indicator,
  icon buttons, avatar (signature gradient). Section headers inside main are sticky with
  a blurred translucent `--wt-bg` background.
- **Sidebar:** mono uppercase `side__group` labels; nav items go muted → brand-tinted
  active. Counts in mono on the right.
- Tag every screen/slide-level container with `data-screen-label="…"` for context.
- Collapse multi-column grids to one column under ~1180px.

---

## 10. Dark theme

Set `data-theme="dark"` on the root — done. Every token re-maps: surfaces lift, status
tints darken, strong values brighten for contrast, shadows deepen. **Write components
once using role tokens** and they adapt with zero changes. Only supply dark overrides
for *app-specific* vars (like `--xx-ink`). The console block stays dark in both themes
by design.

---

## 11. Do / Don't checklist

✓ **Do**
- Use role tokens (`--wt-surface`, `--wt-text-muted`) over raw scale steps.
- Put every number in mono with tabular figures.
- Separate with a 1px border before reaching for a shadow.
- Keep healthy states quiet; reserve red for genuine failure.
- Give each new app exactly one signature ink, derived in OKLCH.
- Use eyebrow labels to title sections and tiles.

✕ **Don't**
- Hardcode hex/px when a token exists.
- Use brand blue or status colors for decoration.
- Introduce a fifth status state or a second accent per app.
- Set data in sans or headings in mono.
- Add gradients, glows, or rounded-pill "AI" cards that aren't in this system.
- Animate layout, or add infinite decorative motion.

---

## 12. Token quick reference

Look these up in `watchtower.css` for exact OKLCH values. Names you'll use most:

```
Brand     --wt-brand-{50,100,200,300,400,500,600,700,800,900}
Neutral   --wt-n-{0,50,100,150,200,300,400,500,600,700,800,900,950}
Status    --wt-up-{50,100,500,600,700}  --wt-warn-{…}  --wt-down-{…}
Accent    --wt-teal-{100,500,600}        Viz --wt-viz-{1..7}
Roles     --wt-bg --wt-surface(-2/-3) --wt-border(-strong)
          --wt-text(-muted/-subtle/-faint) --wt-text-on-brand
Console   --wt-console-{bg,bg-2,border,text,muted,prompt,accent}
Type      --wt-font-{sans,mono}  --wt-text-{xs..4xl}
Space     --wt-{1,2,3,4,5,6,8,10,12,16,20}
Radius    --wt-r-{sm,md,lg,xl,2xl,pill,squircle}
Shadow    --wt-shadow-{xs,sm,md,lg}  --wt-ring-brand
Motion    --wt-ease  --wt-dur
```
