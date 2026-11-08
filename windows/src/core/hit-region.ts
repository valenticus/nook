// Where the island takes the pointer, worked out from where it is DRAWN.
//
// Rust decides click-through from one rectangle the page hands it (island.rs
// `IslandRect`, plus its 14 px margin), in window-logical coordinates — the
// same ones the page's CSS uses, since the island is never zoomed. That
// rectangle used to be computed from `Room.w`, the window width Rust last
// announced. The island itself is placed by CSS (`left: 50%` of the real
// viewport), so a `Room.w` that was stale or never set (it starts at the
// normal panel's 720) moved the pointer's rectangle away from the drawn island
// by half the difference: dead clicks on one side, a live strip beside the
// island on the other. Now the island is placed from the window the page is
// really drawn in (the viewport), the way the CSS places it, and the rectangle
// is that box plus its ears. The box is also MEASURED, but once, after the
// island has settled, to check the arithmetic against what is on screen (and
// to log a mismatch): reading a box back on every frame would make the browser
// lay the page out in the middle of each one.
//
// No DOM in this file: the page reads, this decides, and the tests drive it.

import { PANEL_H, PANEL_W } from "./layout";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The part of a DOMRect this needs, in client (CSS) pixels. */
export interface ClientBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Viewport {
  w: number;
  h: number;
}

/** How far apart two positions may be before they are called different (sub-pixel snapping, a rounded half-pixel). */
export const GEOMETRY_TOLERANCE = 2;

const finite = (...values: number[]) => values.every(Number.isFinite);

/**
 * Whether the page is drawn in the island's full window. The wake strip is
 * 240 × 6 (or 6 × 240): there the island is not where the full window has it,
 * and the poll that reads the rectangle is parked anyway. Every full window is
 * at least the normal panel (dock.rs `panel_size`).
 */
export function viewportIsFullWindow(vp: Viewport): boolean {
  return finite(vp.w, vp.h) && vp.w >= PANEL_W - 1 && vp.h >= PANEL_H - 1;
}

/** A box in client pixels, in the page's layout units: the same ones Rust's window-logical coordinates are in. */
export function layoutBox(client: ClientBox, zoom: number): Box {
  const z = zoom > 0 && Number.isFinite(zoom) ? zoom : 1;
  return { x: client.left / z, y: client.top / z, w: client.width / z, h: client.height / z };
}

/**
 * The drawn island's body as measured, or null when it cannot be trusted: the
 * page is not in the full window (the wake strip), or nothing is drawn.
 * `getBoundingClientRect` already has the CSS transform in it — the pixel
 * snapping the page applies as `translateX` — so nothing is added back.
 */
export function measuredBody(client: ClientBox, zoom: number, vp: Viewport): Box | null {
  if (!viewportIsFullWindow(vp)) return null;
  const box = layoutBox(client, zoom);
  if (!finite(box.x, box.y, box.w, box.h)) return null;
  // Retracted at the top, the island is a line: no height, still a width.
  if (!(box.w > 0 || box.h > 0)) return null;
  return box;
}

/**
 * The ear that is really drawn: the wanted one, cut to the room the window has
 * beside the island along the edge it hangs from (left and right at the top
 * and bottom, above and below on a side). One value serves both ears — the
 * outline draws them alike — so it is the smaller of the two sides' room. This
 * is the single place that decides it: the outline (`shape.draw`) and the
 * pointer's region both take it from here, so they cannot disagree.
 */
export function effectiveEar(ear: number, body: Box, alongVertical: boolean, frame: Viewport): number {
  if (!(Number.isFinite(ear) && ear > 0)) return 0;
  const room = alongVertical
    ? Math.min(body.y, frame.h - (body.y + body.h))
    : Math.min(body.x, frame.w - (body.x + body.w));
  return Number.isFinite(room) ? Math.max(0, Math.min(ear, room)) : 0;
}

/**
 * What takes the pointer: the body, and the decorative ear on each side (they
 * are drawn, so they are hit). `ear` is the EFFECTIVE ear (`effectiveEar`) —
 * already cut to the window — or 0 where the ears are left to Rust's margin.
 * No margin is added here: Rust adds its own 14 px (island.rs `HIT_MARGIN`)
 * around whatever it is handed, once.
 */
export function interactiveRegion(body: Box, ear: number, alongVertical: boolean): Box {
  const e = Number.isFinite(ear) && ear > 0 ? ear : 0;
  return alongVertical
    ? { x: body.x, y: body.y - e, w: body.w, h: body.h + 2 * e }
    : { x: body.x - e, y: body.y, w: body.w + 2 * e, h: body.h };
}

/** Whether the point is in the box grown by `margin` on every side (the same test as island.rs `IslandRect::near`). */
export function nearBox(box: Box, x: number, y: number, margin: number): boolean {
  return (box.w > 0 || box.h > 0)
    && x >= box.x - margin && x <= box.x + box.w + margin
    && y >= box.y - margin && y <= box.y + box.h + margin;
}

export interface GeometryMismatch {
  /** Room.w − viewport width, and the same for the height. */
  roomDx: number;
  roomDy: number;
  /** Where the island is drawn (measured) minus where the page worked out it would be (its left, its top). */
  placedDx: number;
  placedDy: number;
}

/**
 * The page's idea of the window (`Room`) against the window it is drawn in,
 * and the island where the page computed it against where it is really drawn
 * (a measurement, taken once things have settled — not on every frame). Null
 * when they agree, or when the page is not in the full window (the wake
 * strip, where they are meant to differ).
 */
export function geometryMismatch(
  room: Viewport, vp: Viewport, drawn: Box | null, byRoom: Box,
): GeometryMismatch | null {
  if (!viewportIsFullWindow(vp)) return null;
  const roomDx = room.w - vp.w;
  const roomDy = room.h - vp.h;
  const placedDx = drawn ? drawn.x - byRoom.x : 0;
  const placedDy = drawn ? drawn.y - byRoom.y : 0;
  const bad = (v: number) => Math.abs(v) > GEOMETRY_TOLERANCE;
  if (!bad(roomDx) && !bad(roomDy) && !bad(placedDx) && !bad(placedDy)) return null;
  return { roomDx, roomDy, placedDx, placedDy };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** One log line for a mismatch: sizes and rectangles only — no pointer position, no window text. */
export function describeMismatch(
  mismatch: GeometryMismatch, room: Viewport, vp: Viewport, region: Box,
): string {
  return `geometry mismatch: viewport=${r1(vp.w)}x${r1(vp.h)} room=${r1(room.w)}x${r1(room.h)}`
    + ` room_dx=${r1(mismatch.roomDx)} placed_dx=${r1(mismatch.placedDx)} placed_dy=${r1(mismatch.placedDy)}`
    + ` region=${r1(region.x)},${r1(region.y)},${r1(region.w)},${r1(region.h)}`;
}
