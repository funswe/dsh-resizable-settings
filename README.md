# dsh-resizable-settings

English | [中文](README.zh.md)

Makes the Settings dialog that opens from the settings button **resizable by dragging its edges and corners**, and **movable by dragging its top strip**.

## Interaction

| Action | Where |
|---|---|
| Change the width | Left/right edge (a 6px band just inside the panel) |
| Change the height | Top/bottom edge |
| Change both | The four corners (16×16) |
| Move it elsewhere | The panel's **top 20px strip** (the empty space above the header) |
| Restore the default size and position | **Press twice** on any band |

Hovering an edge turns the pointer into the matching resize cursor and lights up a thin line, so the handles are easy to find.

The draggable area stops at the **bottom of DSH's top bar**: the panel's top edge can go no higher than the caption's lower edge, so it can never be dragged into the top bar and get stuck there.

Size and position are remembered — across the next open, and across an app restart.

## How it works

The dialog is rendered by `ui-settings-general` as a modal panel with `role="dialog" aria-modal="true"`, inside a fixed, flex-centred overlay; the panel itself is hard-coded to `width:800px` and has no resize affordance.

A few things have to be exactly right:

- **The handles must be drawn inside the panel.** The panel is `overflow:hidden`, so handles drawn outside its box are clipped — invisible and unclickable.
- **Freeze the panel before dragging.** Flex centring means growing it expands both sides at once, so the first press converts the panel to `position:absolute` with explicit `left/top/width/height` taken from its current `getBoundingClientRect()`. After that **the grabbed edge follows the pointer while the opposite edge stays put**.
- **The ceiling is the viewport, not a constant.** Dragging east grows until "the right edge reaches the viewport margin"; the ceiling depends on where the left edge is. That way a drag can never push the panel off screen, and hitting the ceiling never makes the anchored edge jump.
- **The top boundary is the lower edge of DSH's top bar, not the top of the viewport.** On Windows the caption is a 40px `-webkit-app-region: drag` strip, and the caption menubar host sits at `z-index:1100`, **above this modal's `1000`** — a pointer landing on that strip is consumed by window dragging or the menubar and never reaches the panel. So once the panel parks there, its top move grip never receives a `pointerdown` again (the cursor does not change either): the panel is effectively pinned and cannot be dragged back out. The floor comes from DSH's own `--dsh-frame-chrome-top` (the caption height, zeroed in native fullscreen); macOS has no such strip and uses `--dsh-frame-top-clearance` instead. A plain browser document publishes neither, so it falls back to the 12px margin.
- **The right handle is inset 6px.** The settings scroller owns the outermost 5px (`--dsh-scrollbar-width`); covering it would turn "drag the scrollbar" into "resize".
- **The corner handles must not cover the close button.** The header is `height:54px; padding:20px 14px 8px 10px` and the 28×28 close button starts at `y=20px` — the 0–16px ring along the top is empty, so a corner handle placed on the true corner still misses it.
- **Double-press reset cannot use `dblclick`.** A drag has to `preventDefault()` on `pointerdown`, which also suppresses the compatibility mouse events that `dblclick` is derived from; so the plugin counts two presses within 400ms itself.

The panel is a React portal that is re-mounted on every open and close, so the handles are attached by a `MutationObserver` (scans are coalesced per frame so they do not follow every change the whole app makes); when the panel is removed, the handles go with it.

## Install

```powershell
git clone https://github.com/funswe/dsh-resizable-settings
& "<DSH install dir>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "<the cloned directory>"
```

Then restart DSH Desktop.

## Tests

```powershell
node test/resize.test.mjs
```

The harness implements just enough of `getBoundingClientRect`, `style` and `pointerdown/move/up`, runs the real bundle, and asserts the **resize arithmetic** line by line: each of the four edges only affects its own axis, a south-east drag leaves the origin alone, a north-west drag moves the origin and shrinks, the minimum-size floor, the ceiling following the viewport and the anchored edge, the anchored edge holding still when a drag hits the floor, moves clamped by the viewport, double-press reset, restore on reopen, and teardown.

The top-bar floor has its own cases: with no top bar the move grip still reaches the 12px margin, with a 40px top bar it stops at 40px, a north drag cannot push the panel back into the top bar, and a box stored inside the top bar is pulled back below it on the next open.

## Package layout

| Path | Purpose |
|---|---|
| `lib/client.js` | The browser half: all the logic lives here, hand-written rather than built |
| `lib/index.js` | The host half: an empty implementation that exists only so the plugin owns a Loader row |
| `cordis.patch.yml` | The bundle patch, pointed at by `dsh.bundle.patch` in `package.json` |
| `locale/*.json` | The title and description shown in the plugin list (`meta.title` / `meta.description`) |
| `test/resize.test.mjs` | The offline harness |

`locale/` has two easy-to-miss constraints. DSH treats `locale/en.json` as the **anchor**: if it cannot be read, no language file in that directory is read at all (so the English one must exist). File names must be language ids (`en`, `zh`, `zh-CN`). And the files are fetched through Node's ESM resolver, so they must be allowed in `package.json`'s `exports` (`"./locale/*.json"`) and listed in `files` to reach the published package — missing either does not raise an error, it just falls back to the English description in the list.

## Limits

- It only touches the Settings modal (`[role="dialog"][aria-modal="true"]` whose class contains `_panel`). Other dialogs are unaffected.
- The panel's own layout, behaviour and shortcuts are unchanged; it only gains draggable edges and a top strip.
- The size is stored in the browser's `localStorage` (key `dsh-resizable-settings.v1`), independently per machine and browser.
- If a DSH upgrade changes the settings panel's structure (no longer `role="dialog"` plus an inline `_panel` class), the handles will not find the panel and the plugin silently does nothing — it raises no error and does not break the settings page.
