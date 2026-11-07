// Minimal DOM helpers — no framework, as specified.

import { shelfTrace } from "../core/shelf-trace";

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else if (k === "data-nook-action") {
      if (__NOOK_DEV_BUILD__) el.setAttribute(k, String(v));
    }
    else if (k.startsWith("on") && typeof v === "function") {
      const type = k.slice(2).toLowerCase();
      const listener = type === "click" && __NOOK_DEV_BUILD__
        ? (event: Event) => {
            if (!el.closest("#island")) {
              (v as EventListener).call(el, event);
              return;
            }
            const action = el.dataset.nookAction;
            const classes = [...el.classList].slice(0, 2).join(".").replace(/[^a-zA-Z0-9_.-]/g, "");
            const label = action ?? `${el.tagName.toLowerCase()}.${classes || "unmarked"}`;
            shelfTrace("ui-handler", { source: `start.click.${label}`, mutationType: "handler" });
            try {
              (v as EventListener).call(el, event);
            } finally {
              shelfTrace("ui-handler", { source: `end.click.${label}`, mutationType: "handler" });
            }
          }
        : v as EventListener;
      el.addEventListener(type, listener);
    } else if (k === "style") el.setAttribute("style", String(v));
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

export function svg(path: string, size = 14, opts: { fill?: string; stroke?: number } = {}): SVGSVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  if (opts.stroke) {
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", String(opts.stroke));
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
  } else {
    p.setAttribute("fill", opts.fill ?? "currentColor");
  }
  el.append(p);
  return el;
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Write text only when its rendered value changes; avoids needless text-node replacement. */
export function setTextIfChanged(el: Node, value: string): boolean {
  if (el.textContent === value) return false;
  el.textContent = value;
  return true;
}

/** Reflect an attribute only when the rendered value changes. */
export function setAttributeIfChanged(el: Element, name: string, value: string): boolean {
  if (el.getAttribute(name) === value) return false;
  el.setAttribute(name, value);
  return true;
}

export function removeAttributeIfPresent(el: Element, name: string): boolean {
  if (!el.hasAttribute(name)) return false;
  el.removeAttribute(name);
  return true;
}

export function setHiddenIfChanged(el: HTMLElement, hidden: boolean): boolean {
  if (el.hidden === hidden) return false;
  el.hidden = hidden;
  return true;
}

export function setStylePropertyIfChanged(el: HTMLElement, name: string, value: string): boolean {
  if (el.style.getPropertyValue(name) === value) return false;
  el.style.setProperty(name, value);
  return true;
}

export function removeStylePropertyIfPresent(el: HTMLElement, name: string): boolean {
  if (!el.style.getPropertyValue(name)) return false;
  el.style.removeProperty(name);
  return true;
}

export function setStyleValueIfChanged(el: HTMLElement, name: keyof CSSStyleDeclaration & string, value: string): boolean {
  if (el.style[name] === value) return false;
  (el.style[name] as string) = value;
  return true;
}

/** Card dot used in every "who" row. */
export function dot(color: string, size = 7): HTMLElement {
  return h("i", {
    class: "dot",
    style: `width:${size}px;height:${size}px;background:${color}`,
  });
}

/**
 * Plays an element's entrance again: the class that carries the animation is
 * taken off and put back, with a look at the layout between the two so the
 * browser sees it go.
 */
export function replay(el: HTMLElement, animation: string) {
  el.classList.remove(animation);
  void el.offsetWidth;
  el.classList.add(animation);
}

/** Same shape as the Swift `timeAgo` computed properties. */
export function timeAgo(value: unknown): string {
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  const diff = (Date.now() - date.getTime()) / 1000;
  if (!Number.isFinite(diff)) return "";
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
