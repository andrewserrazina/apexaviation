## Apex Aviation Design System — conventions

**No provider or root wrapper required.** Every component is a plain,
self-contained React function — there is no ThemeProvider, context, or
setup step. Import and render any component directly:

```jsx
import { Button, Card, SectionHeader } from '@apex-aviation/design-system'

<Card featured eyebrow="Ready for the Complete Picture?" title="The Checkride Prep Pack">
  <p>256 DPE-style questions, model answers, and progress tracking.</p>
  <Button href="portal-login.html?view=signup">Create Your Free Account</Button>
</Card>
```

**Styling idiom: CSS custom properties, not utility classes.** This DS has
no Tailwind-style class vocabulary — every color, font, and radius is a
token on `:root`, consumed inside each component's own CSS. When you need
to style your OWN layout glue (page wrappers, grids, spacing between
components — not the components themselves), reach for these same
variables rather than hardcoding hex values, so your layout always stays
on-brand even if the palette shifts later:

| Token | Value | Use |
|---|---|---|
| `--navy` | `#0b1f3a` | Primary dark background |
| `--navy-2` | `#162c4f` | Card/panel background (slightly lighter) |
| `--gold` | `#f4b400` | Primary accent — CTAs, active states, highlights |
| `--gold-2` | `#d4920a` | Gold hover/pressed state |
| `--gold-light` | `#f9d04a` | Gold text on dark backgrounds (higher contrast) |
| `--text` | `rgba(255,255,255,0.85)` | Primary body text on dark backgrounds |
| `--gray` / `--gray-2` | `rgba(255,255,255,0.55)` / `0.38` | Secondary/tertiary text |
| `--border` | `rgba(255,255,255,0.09)` | Hairline borders on dark surfaces |
| `--font` | `'Montserrat', -apple-system, sans-serif` | Body/UI typeface |
| `--font-accent` | `'Playfair Display', Georgia, serif` | Italic accent typeface — headlines only, sparingly (see below) |
| `--radius` / `--radius-lg` | `12px` / `20px` | Standard corner radii |
| `--shadow` / `--shadow-lg` | — | Elevation shadows for cards/modals |

**This DS is dark-mode-only.** Every component is designed and only ever
verified against a dark navy background (`--navy`, `#0b1f3a`). Compose
layouts on that background — there is no light-mode variant.

**The accent typeface is a deliberate, sparing accent — not a general
heading font.** `--font-accent` (Playfair Display) appears **only** as an
italic word or two inside an otherwise `--font` (Montserrat) headline —
e.g. `SectionHeader`'s `accent` prop, which wraps just the emphasized
portion of a title in italic serif while the rest stays Montserrat. Never
set an entire heading or paragraph in `--font-accent` — that isn't how the
brand uses it anywhere in the source site.

**Where the truth lives.** Read `styles.css` (and its `@import` chain,
including `_ds_bundle.css`) before writing any new styles — it contains
every real class this DS ships. Each component's own `.prompt.md` in this
project documents its exact props and usage examples; the `.d.ts` file
alongside it is the authoritative prop-type contract.

**One idiomatic composition** — a locked/gated nav item plus its unlock
CTA, mirroring how the source portal actually uses these components
together:

```jsx
import { NavItem, Modal, Button } from '@apex-aviation/design-system'

<NavItem gated icon={<LockableIcon />}>Checkride Prep Pack</NavItem>

<Modal open={showUnlock} onClose={() => setShowUnlock(false)} title="Unlock the Complete Prep Pack">
  <p>256 DPE-style questions, model answers, and progress tracking — $29.</p>
  <Button onClick={handleUnlock}>Unlock Now</Button>
</Modal>
```
