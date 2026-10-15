window.__ModuleLoader__.load({
	id: "dsh-resizable-settings",
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/index.ts
		/**
		 * Make the Settings modal resizable from its edges and corners.
		 *
		 * The shell renders the panel as `role="dialog" aria-modal="true"` inside a
		 * fixed, flex-centred overlay, with a fixed `width: 800px` and no resize
		 * affordance. This plugin adds eight transparent grab bands just inside the
		 * panel's own edges — the panel clips its overflow, so handles outside the
		 * box would be invisible and dead.
		 *
		 * A flex-centred item grows on both sides, so the first drag freezes the
		 * panel where it sits (`position: absolute` inside the overlay) and every
		 * later drag moves the grabbed edge while the opposite one stays put.
		 */
		/** The panel's own markup anchors; its class names are hashed per build. */
		const SELECTOR = '[role="dialog"][aria-modal="true"][class*="_panel"]';
		/** Where a size the user chose survives the next open and the next launch. */
		const STORAGE_KEY = "dsh-resizable-settings.v1";
		/** Below this the panel's two-column layout stops making sense. */
		const MIN_WIDTH = 420;
		const MIN_HEIGHT = 320;
		/** Keep the panel clear of the viewport edge so its border stays visible. */
		const MARGIN = 12;
		/** Grab bands, drawn inside the panel because it clips its own overflow. */
		const DIRECTIONS = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];
		/**
		 * The right edge sits 6px in: the settings scroller owns the outermost 5px
		 * (`--dsh-scrollbar-width`), and covering it would trade a scrollbar drag for
		 * a resize. The corners stay at the true corner — the header's own padding
		 * keeps the 28px close button clear of the top-right one.
		 */
		const CSS = [
			".dsh-rs-handle{position:absolute;z-index:20;background:transparent;touch-action:none;transition:background-color .12s ease}",
			".dsh-rs-handle:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 40%,transparent)}",
			".dsh-rs-handle[data-dir='n']{top:0;left:16px;right:16px;height:6px;cursor:ns-resize}",
			".dsh-rs-handle[data-dir='s']{bottom:0;left:16px;right:16px;height:6px;cursor:ns-resize}",
			".dsh-rs-handle[data-dir='w']{left:0;top:16px;bottom:16px;width:6px;cursor:ew-resize}",
			".dsh-rs-handle[data-dir='e']{right:6px;top:16px;bottom:16px;width:6px;cursor:ew-resize}",
			".dsh-rs-handle[data-dir='nw']{top:0;left:0;width:16px;height:16px;cursor:nwse-resize}",
			".dsh-rs-handle[data-dir='ne']{top:0;right:0;width:16px;height:16px;cursor:nesw-resize}",
			".dsh-rs-handle[data-dir='sw']{bottom:0;left:0;width:16px;height:16px;cursor:nesw-resize}",
			".dsh-rs-handle[data-dir='se']{bottom:0;right:0;width:16px;height:16px;cursor:nwse-resize}",
			/**
			 * The move grip. The shell's header is 54px tall with 20px of top padding
			 * and its nav starts 22px down, so the panel's top 20px is empty across
			 * its whole width — exactly the strip the corner bands leave free.
			 */
			".dsh-rs-drag{position:absolute;top:0;left:16px;right:16px;height:20px;z-index:15;cursor:grab;touch-action:none}",
			".dsh-rs-drag[data-dragging]{cursor:grabbing}"
		].join("");
		/** The one enhanced panel, or null while Settings is closed. */
		let mounted = null;

		function clamp(value, min, max) {
			return Math.max(min, Math.min(max, value));
		}
		/**
		 * Height of the shell's own top chrome, in viewport pixels.
		 *
		 * On Windows the caption is a 40px strip above the whole app: the frame
		 * paints it as a `-webkit-app-region: drag` band and the caption menubar
		 * sits at `z-index: 1100`, above this modal's `1000`. A pointer over that
		 * strip drags the window or hits the menubar and never reaches the panel,
		 * so a panel parked under it can never be grabbed again — its move grip
		 * stops answering and the cursor never changes.
		 *
		 * The shell publishes the strip its own modal masks stay out of as
		 * `--dsh-frame-chrome-top` (the caption height, zeroed in native
		 * fullscreen). macOS has no such caption and publishes its reserved top as
		 * `--dsh-frame-top-clearance` instead. A plain browser document publishes
		 * neither, which leaves the plain margin as the floor.
		 */
		function chromeTop() {
			const root = document.documentElement;
			if (root === null || root === void 0 || typeof getComputedStyle !== "function") return 0;
			const style = getComputedStyle(root);
			const name = root.hasAttribute?.("data-windows-titlebar") ? "--dsh-frame-chrome-top" : "--dsh-frame-top-clearance";
			const value = Number.parseFloat(style.getPropertyValue(name));
			return Number.isFinite(value) && value > 0 ? value : 0;
		}
		/**
		 * The highest edge a panel may reach, in overlay coordinates. The overlay
		 * is the fixed, full-viewport layer the shell centres the panel in, so the
		 * caption's height is also its offset from the overlay's own top edge.
		 */
		function topFloor(origin) {
			return Math.max(MARGIN, chromeTop() - origin.top);
		}
		/** The persisted box, or undefined when the user never resized. */
		function stored() {
			try {
				const raw = window.localStorage.getItem(STORAGE_KEY);
				if (raw === null) return void 0;
				const value = JSON.parse(raw);
				return typeof value === "object" && value !== null ? value : void 0;
			} catch {
				return void 0;
			}
		}
		/** Persist the panel's current box; a cleared box forgets the choice. */
		function persist(panel, overlay) {
			try {
				const box = boxOf(panel, overlay);
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify(box));
			} catch {
				/* a browser that refuses storage simply forgets the size */
			}
		}
		/** The panel's box in overlay coordinates, which is what the styles carry. */
		function boxOf(panel, overlay) {
			const rect = panel.getBoundingClientRect();
			const origin = overlay.getBoundingClientRect();
			return {
				left: Math.round(rect.left - origin.left),
				top: Math.round(rect.top - origin.top),
				width: Math.round(rect.width),
				height: Math.round(rect.height)
			};
		}
		/**
		 * Detach the panel from the overlay's flex centring so it can be placed by
		 * its own box. Read the live rect first: centring is the only thing that
		 * decides where it currently sits.
		 */
		function detach(panel, overlay) {
			const box = boxOf(panel, overlay);
			panel.style.position = "absolute";
			panel.style.margin = "0";
			panel.style.maxWidth = "none";
			panel.style.minWidth = MIN_WIDTH + "px";
			panel.style.minHeight = MIN_HEIGHT + "px";
			applyBox(panel, box);
			return box;
		}
		function applyBox(panel, box) {
			panel.style.left = box.left + "px";
			panel.style.top = box.top + "px";
			panel.style.width = box.width + "px";
			panel.style.height = box.height + "px";
		}
		/** Fit a box into the current viewport without letting it collapse. */
		function fit(box, overlay) {
			const origin = overlay.getBoundingClientRect();
			const top = topFloor(origin);
			// A viewport narrower than the floor wins: overflowing it would be worse
			// than dropping below the two-column minimum.
			const maxWidth = Math.max(1, origin.width - MARGIN * 2);
			const maxHeight = Math.max(1, origin.height - top - MARGIN);
			const width = clamp(box.width, Math.min(MIN_WIDTH, maxWidth), maxWidth);
			const height = clamp(box.height, Math.min(MIN_HEIGHT, maxHeight), maxHeight);
			return {
				width,
				height,
				left: clamp(box.left, MARGIN, Math.max(MARGIN, origin.width - width - MARGIN)),
				top: clamp(box.top, top, Math.max(top, origin.height - height - MARGIN))
			};
		}
		/** Re-apply the size the user last chose, if it still fits this viewport. */
		function restore(panel, overlay) {
			const box = stored();
			if (box === void 0) return;
			const origin = overlay.getBoundingClientRect();
			panel.style.position = "absolute";
			panel.style.margin = "0";
			panel.style.maxWidth = "none";
			panel.style.minWidth = MIN_WIDTH + "px";
			panel.style.minHeight = MIN_HEIGHT + "px";
			applyBox(panel, fit({
				left: typeof box.left === "number" ? box.left : MARGIN,
				top: typeof box.top === "number" ? box.top : MARGIN,
				width: typeof box.width === "number" ? box.width : origin.width,
				height: typeof box.height === "number" ? box.height : origin.height
			}, overlay));
		}
		/** Drop the chosen size and hand the panel back to its own stylesheet. */
		function reset(panel) {
			for (const property of ["position", "margin", "max-width", "min-width", "min-height", "left", "top", "width", "height"]) {
				panel.style.removeProperty(property);
			}
			try {
				window.localStorage.removeItem(STORAGE_KEY);
			} catch {
				/* nothing to forget */
			}
		}
		/** One drag from pointerdown to pointerup on a single grab band. */
		function begin(event, direction, panel, overlay) {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			const origin = overlay.getBoundingClientRect();
			const floor = topFloor(origin);
			const start = detach(panel, overlay);
			const from = { x: event.clientX, y: event.clientY, box: start };
			const band = event.currentTarget;
			band.setPointerCapture(event.pointerId);
			const move = moveEvent => {
				const dx = moveEvent.clientX - from.x;
				const dy = moveEvent.clientY - from.y;
				const east = direction.includes("e");
				const west = direction.includes("w");
				const south = direction.includes("s");
				const north = direction.includes("n");
				// The edge opposite the grabbed one is the anchor: it never moves.
				// The grabbed edge may travel until it reaches the viewport margin
				// and no further, so a drag can never push the panel off screen —
				// and, unlike clamping the whole box afterwards, a limited drag
				// leaves the anchor exactly where the user last saw it.
				const right = from.box.left + from.box.width;
				const bottom = from.box.top + from.box.height;
				let left = from.box.left;
				let top = from.box.top;
				let width = from.box.width;
				let height = from.box.height;
				if (east) {
					const max = Math.max(MIN_WIDTH, origin.width - from.box.left - MARGIN);
					width = clamp(from.box.width + dx, Math.min(MIN_WIDTH, max), max);
				} else if (west) {
					const max = Math.max(MIN_WIDTH, right - MARGIN);
					width = clamp(from.box.width - dx, Math.min(MIN_WIDTH, max), max);
					left = right - width;
				}
				if (south) {
					const max = Math.max(MIN_HEIGHT, origin.height - from.box.top - MARGIN);
					height = clamp(from.box.height + dy, Math.min(MIN_HEIGHT, max), max);
				} else if (north) {
					// The top edge stops at the caption, not at the plain margin: the
					// caption swallows the pointer, so a panel that reached it could
					// never be dragged back out.
					const max = Math.max(MIN_HEIGHT, bottom - floor);
					height = clamp(from.box.height - dy, Math.min(MIN_HEIGHT, max), max);
					top = bottom - height;
				}
				applyBox(panel, { left, top, width, height });
			};
			const end = () => {
				band.removeEventListener("pointermove", move);
				band.removeEventListener("pointerup", end);
				band.removeEventListener("pointercancel", end);
				persist(panel, overlay);
			};
			band.addEventListener("pointermove", move);
			band.addEventListener("pointerup", end);
			band.addEventListener("pointercancel", end);
		}
		/**
		 * One move drag: the panel keeps its size and follows the pointer, held
		 * inside the same viewport margin the resize bands respect and below the
		 * shell's top chrome — a panel that reached the caption could never be
		 * grabbed again, because the caption swallows the pointer.
		 */
		function beginMove(event, panel, overlay) {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			const origin = overlay.getBoundingClientRect();
			const floor = topFloor(origin);
			const start = detach(panel, overlay);
			const from = { x: event.clientX, y: event.clientY, box: start };
			const band = event.currentTarget;
			band.setPointerCapture(event.pointerId);
			band.dataset.dragging = "";
			const move = moveEvent => {
				const dx = moveEvent.clientX - from.x;
				const dy = moveEvent.clientY - from.y;
				applyBox(panel, {
					width: from.box.width,
					height: from.box.height,
					left: clamp(from.box.left + dx, MARGIN, Math.max(MARGIN, origin.width - from.box.width - MARGIN)),
					top: clamp(from.box.top + dy, floor, Math.max(floor, origin.height - from.box.height - MARGIN))
				});
			};
			const end = () => {
				band.releasePointerCapture && band.releasePointerCapture(event.pointerId);
				band.removeEventListener("pointermove", move);
				band.removeEventListener("pointerup", end);
				band.removeEventListener("pointercancel", end);
				delete band.dataset.dragging;
				persist(panel, overlay);
			};
			band.addEventListener("pointermove", move);
			band.addEventListener("pointerup", end);
			band.addEventListener("pointercancel", end);
		}
		/**
		 * Wire a band's presses. A second press inside the window restores the
		 * panel's own size; detected here rather than through `dblclick` because a
		 * drag must preventDefault on pointerdown, which suppresses the
		 * compatibility mouse events `dblclick` is derived from.
		 */
		function pressable(band, panel, onPress) {
			let pressedAt = 0;
			band.addEventListener("pointerdown", event => {
				const now = Date.now();
				if (now - pressedAt < 400) {
					pressedAt = 0;
					event.preventDefault();
					event.stopPropagation();
					reset(panel);
					return;
				}
				pressedAt = now;
				onPress(event);
			});
		}
		/** Attach the eight bands and the move grip to a freshly rendered panel. */
		function enhance(panel) {
			const overlay = panel.parentElement;
			if (overlay === null) return null;
			restore(panel, overlay);
			const bands = DIRECTIONS.map(direction => {
				const band = document.createElement("div");
				band.className = "dsh-rs-handle";
				band.dataset.dir = direction;
				pressable(band, panel, event => begin(event, direction, panel, overlay));
				panel.appendChild(band);
				return band;
			});
			const grip = document.createElement("div");
			grip.className = "dsh-rs-drag";
			grip.setAttribute("aria-hidden", "true");
			pressable(grip, panel, event => beginMove(event, panel, overlay));
			panel.appendChild(grip);
			return { panel, bands: [...bands, grip] };
		}
		/** Remove every band and stop tracking the panel. */
		function teardown() {
			if (mounted === null) return;
			for (const band of mounted.bands) band.remove();
			mounted = null;
		}
		/**
		 * Browser plugin body: install the grab bands on the Settings panel for as
		 * long as this plugin lives.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.pluginCss = "dsh-resizable-settings";
				style.textContent = CSS;
				document.head.appendChild(style);
				// Settings is a portal that comes and goes, so the panel is found by
				// mutation rather than by hooking a slot. The scan is frame-bounded:
				// this observer sees every mutation the whole app makes.
				let scheduled = false;
				const tick = () => {
					scheduled = false;
					if (mounted !== null && (!mounted.panel.isConnected || !mounted.bands[0].isConnected)) teardown();
					if (mounted === null) {
						const panel = document.querySelector(SELECTOR);
						if (panel !== null) mounted = enhance(panel);
					}
				};
				const schedule = () => {
					if (scheduled) return;
					scheduled = true;
					window.requestAnimationFrame(tick);
				};
				const observer = new MutationObserver(schedule);
				observer.observe(document.body, { childList: true, subtree: true });
				tick();
				return () => {
					observer.disconnect();
					teardown();
					style.remove();
				};
			}, "dsh-resizable-settings: grab bands");
		}
		//#endregion
		exports.apply = apply;
		return module.exports;
	}
});
