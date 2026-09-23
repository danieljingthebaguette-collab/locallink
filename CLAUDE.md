# LocalLink

## How to work on this project

- Never claim something is fixed or done without real proof: command
  output, git diff, curl response, query result. A description is not
  proof. This project has been burned by claimed fixes that weren't there.
- Read the current file before editing. Check git log before building —
  this project has rebuilt the same feature multiple times by not checking.
- Stay in scope. Report other problems you notice; don't fix them unasked.
- No schema changes without explicit approval.
- Never push to main without being told to. Commit locally, show the diff.
- Never test against the production database. Leave DB_PATH unset locally.
- Before saying "cleaned up" or "stopped," verify it — past sessions left
  servers running and files behind after claiming otherwise.
- Users are mostly minors. Nothing public by default. Opportunity
  responses go through the withTags allowlist. User responses use
  explicit SELECT column lists — never SELECT * on the users table, and
  add new user fields only to the specific endpoints that need them.
- Roles store createdAt in the `date` column because it can't be null.
  Never compare opportunity.date directly — always use hasEnded() and
  isRolePost() from categoryUtils.ts.
- Deferred on purpose, don't propose unasked: routes.ts as one file,
  sync SQLite, no pagination, no indexes, no test suite.

---

# Design rules

Rules for any visual or page-level change. Written from what the codebase
already does (counts below are real usage across `client/src`, excluding the
shadcn primitives in `components/ui/`), not from preference. When a rule and
the code disagree, the code is probably right and this file is stale — check,
then fix whichever is actually wrong.

`client/src/index.css` is the source of truth for tokens and carries its own
reasoning in comments. Read it before changing anything about colour, radius
or type.

---

## 1. Tokens, never raw values

Every colour comes from a token: `bg-card`, `text-foreground`,
`text-muted-foreground`, `border-border`, `bg-primary`, `bg-secondary`,
`bg-destructive`. No hex, no `gray-500`, no `slate-*` in component code.

Exceptions already in the codebase, and the only ones allowed to grow:
semantic status colours (`text-green-600`, `text-amber-600`, `text-red-500`,
`text-sky-600`) on admin actions and warnings. These are states, not brand.
Give them a `dark:` counterpart when they sit on a coloured background.

**The radius scale is deliberately tightened** (`md` 6px, `xl` 10px, `2xl`
12px, `3xl` 14px — not Tailwind's defaults). The comment in `index.css` says
why: large uniform radii on every surface is a generated-design tell. Do not
restore Tailwind defaults, and do not introduce arbitrary `rounded-[Npx]`.

| Use | Class | Usages |
|---|---|---|
| Buttons, chips, action controls | `rounded-md` | 157 |
| Inputs, selects, tag pills, inner tiles | `rounded-xl` | 109 |
| Section cards inside a page | `rounded-2xl` | 68 |
| Page-level panels, modals | `rounded-3xl` | 45 |
| Avatars, dots, icon circles | `rounded-full` | 48 |

`rounded-lg` is effectively unused (6). Don't add it — keep the steps discrete.

## 2. Surfaces

Two card recipes. Pick by nesting depth, not by taste.

```jsx
// Section card inside a page
<div className="rounded-2xl bg-card border border-border p-6">

// Page-level panel (auth pages, standalone forms, modals)
<div className="rounded-3xl bg-card border border-border shadow-sm p-8 md:p-10">
```

Write the order `bg-card border border-border` (48 usages vs 12 the other way).

Borders are 1px hairlines, never 2px outlines — the border token was tuned for
exactly that. `shadow-sm` for resting surfaces, `shadow-md` for things that
float (modals, popovers). Nothing above `shadow-md` exists in the codebase.

## 3. Controls

| Height | Use |
|---|---|
| `h-11` (44px) | Default for anything a finger touches — buttons, inputs on user-facing pages |
| `h-12` | Primary submit on a form that is the whole point of the page |
| `h-9` / `h-10` | Dense admin surfaces only, where a mouse is assumed |

Primary button: `rounded-md font-semibold` plus a height. Inputs:
`rounded-xl border border-border h-11`.

Destructive actions get `variant="destructive"` or `text-red-*`, and anything
irreversible goes through `AlertDialog` (7 call sites) or `ConfirmBubble` (3),
never a bare click. Never `window.confirm` or `window.prompt` — a past commit
replaced those because they are suppressed in embedded and cross-origin
frames, so the button silently does nothing.

## 4. Typography

`font-sans` (IBM Plex Sans) is the body face and the default on `body`.
`font-heading` (Instrument Sans) is for headings **only** — never body copy,
never labels. Plex over Inter was a deliberate call; don't swap either face.

| Role | Class |
|---|---|
| Hero | `text-4xl`/`text-5xl font-heading font-bold` |
| Page title | `text-2xl font-heading font-bold` |
| Modal title | `text-3xl md:text-4xl font-heading font-bold leading-tight` |
| Section heading in a card | `text-lg font-heading font-bold` |
| Body | `text-sm` (dense) / `text-base` (reading) |
| Secondary | `text-sm text-muted-foreground` |
| Micro-label above a value | `text-xs font-bold text-muted-foreground uppercase tracking-wide` |

Minimum for real reading text is `text-xs` (12px). Below that is for badges
and counters only — see §9.

## 5. Category colour carries meaning

The five category colours are the board's only legend. They are data, not
decoration. Always go through the helpers in `lib/categoryUtils.ts` —
`getCategoryTint`, `getCategoryBorder`, `getCategoryColor`,
`getModalGradient`, `getCategoryLabel` — never hand-write `bg-cat-*`.

Two rules that come from the `index.css` comment:

- Education (hue 160) and Environment (145) read as nearly the same green on a
  card border, more so with red-green colour blindness. **Never let the border
  alone be the only thing distinguishing two categories** — pair it with the
  label.
- Legacy categories (`volunteer`, `education`, `fitness`, `community`,
  `environment`) still exist on old posts and must keep rendering their
  original label and hue. Anything category-related routes through
  `getFilterCategory` / `getEditCategoryOptions` so a legacy post never
  vanishes from a filter or gets silently relabelled by a `<select>`.

Comparing a tag to anything goes through `normaliseTag` — stored tags from
older posts may carry a leading emoji that current `FIELD_TAGS` do not.

## 6. Motion

`<MotionConfig reducedMotion="user">` wraps the app in `App.tsx`, and
`index.css` has a `prefers-reduced-motion` block for CSS. Both are already
handled — don't add per-component reduced-motion checks, and don't bypass
either.

- Framer entrances: `duration` 0.18–0.32, with `EASE_OUT = [0.25, 0.1, 0.25, 1]`
  (defined in `home.tsx`). Stagger with a `delay` of 0.04–0.08 per item.
- CSS: `duration-200` is the default, `duration-150` for colour-only hovers,
  `duration-300` for layout shifts. Nothing else.
- Animate `transform` and `opacity`. Never animate `width`/`height`/`top`.
- Hover must not move layout. Colour, shadow, opacity — not `scale` on
  anything that sits in a grid.

## 7. Icons

Lucide only, and only what's already imported in that file's icon block. No
emoji as UI icons — a past commit specifically replaced them.

`w-4 h-4` inline with text (40 usages) · `w-3 h-3`/`w-3.5 h-3.5` inside small
buttons and badges · `w-5 h-5` nav and card headers · `w-8 h-8`/`w-10 h-10`
empty states.

Empty state pattern: centred icon at `opacity-30`, a `text-sm font-medium`
line saying what would be here, and a `text-xs text-muted-foreground` line
saying how it gets filled. Say what the panel is for, not just that it's empty.

## 8. Page shell

```jsx
<div className="min-h-screen bg-background pb-24 font-sans">
  <main className="container mx-auto px-4 py-12">
```

`pb-24` is not optional (22 usages) — the mobile bottom nav is fixed and will
sit on top of the last element without it. Use `py-8` for dense pages,
`py-12` standard, `py-16 text-center` for single-message pages. Cap reading
width with `max-w-2xl`/`max-w-3xl`.

Wide content (tables, tag grids) scrolls inside its own `overflow-x-auto`.
The page body never scrolls sideways.

## 9. Accessibility floor

Non-negotiable, and already true across the codebase:

- **44px minimum** for touch targets. `h-11`, or `min-h-[44px]` on a link or
  label that would otherwise be text-height. Add `-my-2 py-2` to absorb the
  extra height when it would disturb a tight row.
- **Every icon-only button gets an `aria-label`.** `title` alone is not enough
  — tooltips don't exist on touch.
- **`cursor-pointer` on every clickable non-`<button>`, and on `<button>` too.**
  Tailwind v4's preflight sets `cursor: default` on buttons, so without it
  nothing looks tappable.
- Contrast: `--muted-foreground` was deliberately darkened to clear 7:1. Don't
  lighten it, and don't put `text-muted-foreground` on a tinted background
  without rechecking.
- Both themes, every time. Never define a colour only inside `.dark`.
- Focus is handled globally by `:focus-visible` in `index.css` — don't remove
  outlines locally.

Overlays come in two kinds, and the difference is deliberate:

- **Dismissible** (post modal, questionnaire): `role="dialog"`,
  `aria-modal="true"`, scroll locked, focus moved in and restored on close.
  Escape, backdrop click and the X all route to the *same* handler, so an
  unsaved-edits guard applies to every exit equally.
- **Destructive confirms** (`AlertDialog`): Radix gives Escape and the focus
  trap for free, but backdrop click does **not** dismiss, and nothing
  overrides that. That is correct — a destructive choice should be explicit.
  Don't "fix" it.

## 10. Deliberate exceptions — do not "fix" these

Audited, flagged, and kept on purpose. Leaving them is the decision:

- Category pills and sort buttons on the board are **38px**, under the 44px
  floor (`px-4 py-2` + `text-sm`).
- Tag badges are **10px** (`text-[10px]`), under the 12px reading floor. They
  are labels, not reading text.

If a future change makes these targets *smaller*, that is a regression. Making
them bigger is a design decision that needs asking first.

## 11. Tailwind v4 gotchas that actually bite

- Config is CSS-first via `@theme` in `index.css`. There is no
  `tailwind.config.js` theme block.
- **JIT only sees literal class strings.** `` `bg-${color}-500` `` produces no
  CSS. Map to whole class names (see `CATEGORY_TINT_MAP`).
- Preflight kills the button cursor — see §9.
- `@custom-variant dark (&:is(.dark *))`: dark mode is a `.dark` class on the
  root, set by the toggle and `main.tsx` pre-render. Not a media query.

## 12. Before shipping a visual change

1. Both themes.
2. 390px and 360px wide — no horizontal scroll, nothing under the bottom nav.
3. Every new interactive element: 44px, `aria-label` if icon-only,
   `cursor-pointer`.
4. `npx tsc --noEmit` and `npm run build`.
5. Check it in the browser against real data, not an assumption about what the
   class does.
