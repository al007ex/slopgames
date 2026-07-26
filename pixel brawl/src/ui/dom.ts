type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  id?: string;
  text?: string | number;
  html?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  onclick?: (e: MouseEvent) => void;
  oninput?: (e: Event) => void;
  onchange?: (e: Event) => void;
  onkeydown?: (e: KeyboardEvent) => void;
  [key: string]: unknown;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = String(v);
      else if (k === 'text') node.textContent = String(v);
      else if (k === 'html') node.innerHTML = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') node.setAttribute('style', v);
        else Object.assign(node.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2), v as EventListener);
      } else {
        node.setAttribute(k, String(v));
      }
    }
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(node: Node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(parent: HTMLElement, ...children: Child[]) {
  clear(parent);
  append(parent, children);
}

/** Counts a number up over `ms`, for reward reveals. */
export function countUp(node: HTMLElement, from: number, to: number, ms = 700, prefix = '') {
  const start = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    node.textContent = prefix + Math.round(from + (to - from) * eased).toLocaleString();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
