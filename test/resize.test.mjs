/**
 * Offline harness for dsh-resizable-settings: evaluates the real bundle against
 * a minimal DOM and asserts the resize arithmetic — the part a wrong sign or a
 * missing clamp would break silently.
 *
 *   node test/resize.test.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const BUNDLE = new URL('../lib/client.js', import.meta.url)
const SELECTOR_EXPECTED = '[role="dialog"][aria-modal="true"][class*="_panel"]'

// ---- minimal DOM ----------------------------------------------------------
const HYPHEN = { 'max-width': 'maxWidth', 'min-width': 'minWidth', 'min-height': 'minHeight' }

function makeStyle() {
  const props = new Map()
  return {
    get: (key) => props.get(key),
    has: (key) => props.has(key),
    set: (key, value) => { props.set(key, value); return true },
    removeProperty: (name) => { props.delete(HYPHEN[name] ?? name) },
  }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parentElement = null
    this.dataset = {}
    this.listeners = new Map()
    this.isConnected = true
    this.className = ''
    this.rect = { left: 0, top: 0, width: 0, height: 0 }
    this._style = makeStyle()
    this.style = new Proxy({ removeProperty: (name) => this._style.removeProperty(name) }, {
      get: (target, key) => (key in target ? target[key] : this._style.get(key)),
      set: (target, key, value) => (key in target ? ((target[key] = value), true) : this._style.set(key, value)),
    })
  }
  appendChild(node) { node.parentElement = this; this.children.push(node); return node }
  remove() {
    if (this.parentElement !== null) {
      this.parentElement.children = this.parentElement.children.filter(child => child !== this)
      this.parentElement = null
    }
    this.isConnected = false
  }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]) }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(f => f !== fn)) }
  setAttribute(name) { (this._attributes ??= new Set()).add(name) }
  hasAttribute(name) {
    // The shell marks the Windows caption with a `data-*` attribute, so mirror
    // the DOM's attribute-to-dataset mapping the plugin relies on.
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())
      return key in this.dataset
    }
    return this._attributes?.has(name) ?? false
  }
  setPointerCapture() {}
  /** Inline absolute placement is what the plugin drives, so mirror it back. */
  getBoundingClientRect() {
    if (this._style.get('position') === 'absolute') {
      const num = (key) => Number.parseFloat(this._style.get(key) ?? '0') || 0
      return { left: num('left'), top: num('top'), width: num('width'), height: num('height') }
    }
    return this.rect
  }
  dispatch(type, event) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) {
      fn({ button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {}, currentTarget: this, target: this, ...event })
    }
  }
  /** The handle band for one direction, if it is attached. */
  band(direction) { return this.children.find(child => child.dataset?.dir === direction) }
}

const head = new El('head')
const body = new El('body')
let panel = null
const store = new Map()
// The shell publishes its top chrome as a custom property on the root element.
// An empty map is a plain browser document: no caption, so only the plain
// margin floors the panel.
const root = new El('html')
const rootProps = new Map()
globalThis.getComputedStyle = () => ({ getPropertyValue: (name) => rootProps.get(name) ?? '' })

globalThis.window = {
  requestAnimationFrame: (fn) => { fn(); return 1 },
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
  },
  __ModuleLoader__: { load: (mod) => { globalThis.__captured = mod } },
}
globalThis.document = {
  head,
  body,
  documentElement: root,
  createElement: (tag) => new El(tag),
  querySelector: (selector) => {
    assert.equal(selector, SELECTOR_EXPECTED)
    return panel !== null && panel.isConnected ? panel : null
  },
}
let fireMutation = () => {}
globalThis.MutationObserver = class {
  constructor(callback) { fireMutation = callback }
  observe() {}
  disconnect() { fireMutation = () => {} }
}

// ---- fake clock: presses must be far enough apart to read as separate drags
let now = 1_000_000
const realNow = Date.now
Date.now = () => now

// ---- evaluate the bundle --------------------------------------------------
const code = fs.readFileSync(BUNDLE, 'utf8')
new Function('window', 'document', 'MutationObserver', 'Date', code)(
  globalThis.window, globalThis.document, globalThis.MutationObserver, Date,
)
const captured = globalThis.__captured
assert.ok(captured, 'bundle must call window.__ModuleLoader__.load')
assert.equal(captured.id, 'dsh-resizable-settings')
const plugin = captured.factory()
assert.equal(typeof plugin.apply, 'function')
console.log('bundle id      :', captured.id)

/** Mount a freshly rendered panel the way the settings portal does. */
function open(rect) {
  const overlay = new El('div')
  overlay.rect = { left: 0, top: 0, width: 1600, height: 1000 }
  panel = new El('div')
  panel.className = 'wCInkW_panel'
  panel.rect = rect
  overlay.appendChild(panel)
  return overlay
}

let disposer = null
function mount(rect) {
  open(rect)
  if (disposer === null) {
    const ctx = { effect: (fn) => { disposer = fn() } }
    plugin.apply(ctx)
  }
  return panel
}

// ---- case 1: the bands are attached, the panel stays centred until dragged --
mount({ left: 400, top: 100, width: 800, height: 800 })
for (const dir of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) {
  assert.ok(panel.band(dir) !== undefined, 'missing band ' + dir)
}
// Freezing the panel is what makes one edge track the pointer, but doing it up
// front would override the shell's own centring for users who never drag.
assert.equal(panel.style.position, undefined, 'an untouched panel keeps its stylesheet placement')
console.log('bands          : 8 attached, panel still flex-centred')

/** Drag one band from a start point by a delta. */
function drag(direction, from, to) {
  now += 5000
  const band = panel.band(direction)
  band.dispatch('pointerdown', { clientX: from[0], clientY: from[1] })
  band.dispatch('pointermove', { clientX: to[0], clientY: to[1] })
  band.dispatch('pointerup', { clientX: to[0], clientY: to[1] })
}

// ---- case 2: south-east grows width and height, leaving left/top alone -----
// Height stops at 888 because the panel's top is 100 and the bottom margin is
// 12 — the anchor stays put and the moving edge stops at the viewport.
drag('se', [1200, 900], [1400, 1000])
assert.equal(panel.style.width, '1000px', 'se drag grows width by dx')
assert.equal(panel.style.height, '888px', 'se drag stops the moving edge at the bottom margin')
assert.equal(panel.style.left, '400px', 'se drag must not move the anchor')
assert.equal(panel.style.top, '100px')
console.log('drag se        : 800x800 ->', panel.style.width, 'x', panel.style.height, '@', panel.style.left, panel.style.top)

// ---- case 3: north-west moves the origin and shrinks -----------------------
drag('nw', [400, 100], [500, 150])
assert.equal(panel.style.width, '900px', 'nw drag shrinks width by dx')
assert.equal(panel.style.height, '838px')
assert.equal(panel.style.left, '500px', 'nw drag moves the left edge')
assert.equal(panel.style.top, '150px')
console.log('drag nw        : ->', panel.style.width, 'x', panel.style.height, '@', panel.style.left, panel.style.top)

// ---- case 4: an edge only touches its own axis -----------------------------
drag('e', [1400, 500], [1500, 700])
assert.equal(panel.style.width, '1000px', 'e drag grows width')
assert.equal(panel.style.height, '838px', 'e drag must not touch height')
assert.equal(panel.style.top, '150px')
console.log('drag e         : width only ->', panel.style.width, 'x', panel.style.height)

// ---- case 5: the floor holds ----------------------------------------------
drag('se', [1500, 900], [200, 200])
assert.equal(panel.style.width, '420px', 'width cannot go below the floor')
assert.equal(panel.style.height, '320px', 'height cannot go below the floor')
console.log('drag se small  : clamped to', panel.style.width, 'x', panel.style.height)

// ---- case 5b: the move grip translates without resizing --------------------
/** Drag the move grip (the empty strip along the panel's top edge). */
function moveBy(from, to) {
  now += 5000
  const grip = panel.children.find(child => child.className === 'dsh-rs-drag')
  assert.ok(grip !== undefined, 'the move grip must be attached')
  grip.dispatch('pointerdown', { clientX: from[0], clientY: from[1] })
  grip.dispatch('pointermove', { clientX: to[0], clientY: to[1] })
  grip.dispatch('pointerup', { clientX: to[0], clientY: to[1] })
}
moveBy([600, 30], [700, 80])
assert.equal(panel.style.left, '600px', 'the grip moves the panel by dx')
assert.equal(panel.style.top, '200px', 'the grip moves the panel by dy')
assert.equal(panel.style.width, '420px', 'moving must not resize')
assert.equal(panel.style.height, '320px')
console.log('grip move      : ->', panel.style.left, panel.style.top, 'at', panel.style.width, 'x', panel.style.height)

// ---- case 5c: moving cannot push the panel out of the viewport -------------
moveBy([700, 80], [-5000, -5000])
assert.equal(panel.style.left, '12px', 'the left edge stops at the margin')
assert.equal(panel.style.top, '12px', 'the top edge stops at the margin')
moveBy([12, 12], [9000, 9000])
assert.equal(panel.style.left, '1168px', 'the right edge stops at the margin')
assert.equal(panel.style.top, '668px', 'the bottom edge stops at the margin')
console.log('grip clamped   : stays inside the viewport')

// Put the panel back at a known spot so the arithmetic below reads plainly.
moveBy([1168, 668], [500, 150])
assert.equal(panel.style.left, '500px')
assert.equal(panel.style.top, '150px')

// ---- case 6: the anchor holds when the floor bites -------------------------
// Dragging the west edge past the floor must stop the edge where the clamp
// landed while the right edge stays exactly where the user last saw it.
drag('se', [500, 500], [700, 600])
assert.equal(panel.style.width, '620px')
const anchorRight = Number.parseFloat(panel.style.left) + 620
drag('w', [500, 500], [900, 500])
assert.equal(panel.style.width, '420px', 'w drag hit the floor')
assert.equal(
  Number.parseFloat(panel.style.left) + 420,
  anchorRight,
  'the right edge must not move when the west drag is clamped',
)
console.log('drag w clamped : width floor hit, anchor held at', anchorRight)

// ---- case 7: the ceiling is the viewport, not a fixed number ---------------
drag('se', [900, 900], [9000, 9000])
assert.equal(panel.style.width, '888px', 'width stops at the right margin from this left edge')
assert.equal(panel.style.height, '838px', 'height stops at the bottom margin from this top edge')
console.log('drag se huge   : clamped to', panel.style.width, 'x', panel.style.height)

// ---- case 7b: the shell's top chrome is a hard floor -----------------------
// On Windows the caption is 40px of `-webkit-app-region: drag` with the caption
// menubar at z-index 1100 — above this modal's 1000. A pointer over it drags the
// window or hits the menubar and never reaches the panel, so parking the panel
// there makes it permanently undraggable: the grip stops answering and the
// cursor never changes. The floor is the caption's bottom edge, not the margin.
moveBy([500, 150], [500, -4000])
assert.equal(panel.style.top, '12px', 'with no caption the grip reaches the plain margin')
root.dataset.windowsTitlebar = ''
rootProps.set('--dsh-frame-chrome-top', '40px')
moveBy([500, 12], [500, -4000])
assert.equal(panel.style.top, '40px', 'with a caption the grip stops below it')
drag('n', [800, 40], [800, -4000])
assert.ok(
  Number.parseFloat(panel.style.top) >= 40,
  'a north resize cannot push the panel back under the caption',
)
console.log('caption floor  : grip floor 12px ->', panel.style.top, 'under a 40px caption')

// ---- case 7c: a box remembered from under the caption is rescued -----------
// Anyone who parked the panel in the caption before this floor existed gets it
// back below the caption on the next open instead of staying stuck.
store.set('dsh-resizable-settings.v1', JSON.stringify({ left: 300, top: 12, width: 700, height: 500 }))
panel.remove()
open({ left: 400, top: 100, width: 800, height: 800 })
fireMutation()
assert.equal(panel.style.top, '40px', 'a stored box under the caption is restored below it')
assert.equal(panel.style.left, '300px', 'and the rest of the stored box is kept')
assert.equal(panel.style.width, '700px')
console.log('restore floor  : a caption-parked box comes back below the caption')

// ---- case 8: the chosen box is remembered and restored --------------------
const remembered = JSON.parse(store.get('dsh-resizable-settings.v1'))
assert.ok(remembered.width > 0 && remembered.height > 0, 'the box must be persisted')
console.log('persisted      :', JSON.stringify(remembered))
panel.remove()
// Closing and reopening Settings renders a new portal; the observer is what
// finds it, so the harness has to drive the same signal.
open({ left: 400, top: 100, width: 800, height: 800 })
fireMutation()
const reopened = panel
assert.equal(reopened.style.width, remembered.width + 'px', 'a reopened panel restores the chosen width')
assert.equal(reopened.style.height, remembered.height + 'px')
assert.equal(reopened.style.left, remembered.left + 'px')
console.log('reopen         : restored', reopened.style.width, 'x', reopened.style.height)

// ---- case 9: a double press restores the panel's own size -----------------
const band = reopened.band('nw')
band.dispatch('pointerdown', { clientX: 100, clientY: 100 })
band.dispatch('pointerup', { clientX: 100, clientY: 100 })
band.dispatch('pointerdown', { clientX: 100, clientY: 100 })
assert.equal(reopened.style.width, undefined, 'a double press drops the inline size')
assert.equal(reopened.style.position, undefined, 'and hands the panel back to its stylesheet')
assert.equal(store.has('dsh-resizable-settings.v1'), false, 'and forgets the choice')
console.log('double press   : reset to the stylesheet default')

// ---- case 10: closing Settings disposes the bands; disabling removes all ---
reopened.remove()
fireMutation()
assert.equal(reopened.children.length, 0, 'the bands must go when the panel does')
assert.ok(disposer !== null, 'apply registered a disposer')
disposer()
assert.equal(head.children.length, 0, 'disabling the plugin removes its stylesheet')
console.log('teardown       : bands and stylesheet removed')
Date.now = realNow
console.log('\nALL CHECKS PASSED')
