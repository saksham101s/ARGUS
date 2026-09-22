# Argus — Design Principles

## Visual Identity

Argus uses a dark, ink-based palette with warm amber as the single primary accent.
This is deliberately not a green/red traffic-light scheme:

- **Amber** signals "pay attention" — the watching eye, in-progress states
- **Sage** signals "clean" — resolved, passed states only
- **Brick** is reserved only for confirmed security findings — never decorative

## Typography

- **Space Grotesk** — headings and UI chrome (weights 400/500/600)
- **IBM Plex Mono** — data: code, diffs, file paths, stat numbers. Not for decorative labels.

## Layout Principles

1. **The product's proof is an annotated code diff.** When a hero or empty state
   needs a visual, show a real (or realistic) annotated diff block, not an
   abstract stat or gradient.

2. **Left-aligned, dense, terminal-adjacent rhythm.** Not a centered
   marketing-style hero. Content hugs the left edge; whitespace is earned.

3. **No uniform card grid.** The diff viewer, metrics panel, and repo list each
   get their own visual treatment — not identical rounded cards with the same
   shadow.

4. **Forbidden patterns:**
   - No all-caps eyebrow labels
   - No middle-dot-joined meta strings (e.g. `Author · 3 min · Draft`)
   - No arrow (→) appended to buttons
   - No decorative use of the brick/red color — it means "security finding"

## Color Tokens

| Token             | Hex       | Use                                         |
|--------------------|-----------|---------------------------------------------|
| `--bg-base`        | `#12141A` | Page background                             |
| `--bg-surface`     | `#1B1E27` | Cards, panels                               |
| `--bg-surface-2`   | `#242835` | Nested/hover surfaces                       |
| `--border`         | `#2E3341` | Hairline borders                            |
| `--text-primary`   | `#EDEDE6` | Primary text (warm off-white, not pure white)|
| `--text-secondary` | `#9A9CA8` | Secondary/muted text                        |
| `--accent-amber`   | `#D6A94A` | Primary accent — attention, in-progress     |
| `--accent-sage`    | `#5FA88B` | Clean / resolved / passed states only       |
| `--accent-brick`   | `#C15B4E` | Confirmed security findings only            |

## Type Scale

The type scale uses intentional steps, not uniform Tailwind defaults:

| Name     | Size    | Line Height | Weight | Font           | Use                          |
|----------|---------|-------------|--------|----------------|------------------------------|
| `display`| 2.25rem | 1.2         | 600    | Space Grotesk  | Page titles                  |
| `title`  | 1.5rem  | 1.3         | 500    | Space Grotesk  | Section headings             |
| `heading`| 1.125rem| 1.4         | 500    | Space Grotesk  | Card/panel headings          |
| `body`   | 0.9375rem| 1.6        | 400    | Space Grotesk  | Body text                    |
| `caption`| 0.8125rem| 1.5        | 400    | Space Grotesk  | Secondary info, labels       |
| `code`   | 0.8125rem| 1.6        | 400    | IBM Plex Mono  | Code, diffs, file paths      |
| `data`   | 1.125rem| 1.3         | 500    | IBM Plex Mono  | Stat numbers, metrics        |
