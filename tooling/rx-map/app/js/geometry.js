// Layout boxes, untouched by the camera's transforms.
const getBoard = () => document.getElementById("board");
const anchorClasses = [".chip", ".ctag", ".flabel"];
const anchorSelector = data => anchorClasses.map(c => c + data).join(", ");
export function zoomUnder(el) {
  let z = 1;
  for (let e = el, board = getBoard(); e && e !== board; e = e.parentElement) z *= +e.style.zoom || 1;
  return z;
}

export function boxOf(el) {
  if (!el || !el.offsetParent) return null;
  const board = getBoard();
  if (!board) return null;
  let x = 0, y = 0, e = el;
  while (e && e !== board) { const z = zoomUnder(e); x += e.offsetLeft * z; y += e.offsetTop * z; e = e.offsetParent; }
  if (e !== board) return null;
  const z = zoomUnder(el), w = el.offsetWidth * z, h = el.offsetHeight * z;
  return { l: x, t: y, r: x + w, b: y + h, x: x + w / 2, y: y + h / 2 };
}
export const moduleEl = i => getBoard()?.querySelector(`.module[data-mod="${CSS.escape(String(i))}"]`) ?? null;
export const regionEl = id => getBoard()?.querySelector(`.frame[data-region="${CSS.escape(id)}"]`) ?? null;

export function anchorOf(id) {
  return getBoard()?.querySelector(anchorSelector(`[data-id="${CSS.escape(id)}"]`)) ?? null;
}

export function boxOfId(id) { return boxOf(anchorOf(id)); }

export function measureAnchors() {
  const board = getBoard(), seen = new Set(), entries = [];
  if (board) for (const el of board.querySelectorAll(anchorSelector("[data-id]"))) {
    const id = el.dataset.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const b = boxOf(el);
    if (b) entries.push([id, b]);
  }
  return Object.fromEntries(entries);
}

export function boardSize() {
  const board = getBoard();
  return { w: board.offsetWidth, h: board.offsetHeight };
}

// from what depends (A) up to what it needs (B)
export function edgePath(A, B) {
  if (B.b < A.t - 4) {
    const dy = Math.max(24, (A.t - B.b) * 0.5);
    return `M${A.x},${A.t} C${A.x},${A.t - dy} ${B.x},${B.b + dy} ${B.x},${B.b}`;
  }
  if (Math.abs(A.y - B.y) < 14) {
    const h = 16 + Math.min(40, Math.abs(B.x - A.x) * 0.12);
    return `M${A.x},${A.t} C${A.x},${A.t - h} ${B.x},${B.t - h} ${B.x},${B.t}`;
  }
  // pointing down breaks the layout's promise: route it round the side so it stands out
  const x1 = A.r, x2 = B.r, mx = Math.max(x1, x2) + 26 + Math.min(160, Math.abs(B.y - A.y) * 0.3);
  return `M${x1},${A.y} C${mx},${A.y} ${mx},${B.y} ${x2},${B.y}`;
}

// the way data moves: from a source (S) to what it reaches (D)
export function flowPath(S, D) {
  if (S.b < D.t - 4) { const k = Math.max(24, (D.t - S.b) * .5); return `M${S.x},${S.b} C${S.x},${S.b + k} ${D.x},${D.t - k} ${D.x},${D.t}`; }
  if (D.b < S.t - 4) { const k = Math.max(24, (S.t - D.b) * .5); return `M${S.x},${S.t} C${S.x},${S.t - k} ${D.x},${D.b + k} ${D.x},${D.b}`; }
  const h = 18 + Math.min(44, Math.abs(D.x - S.x) * .12);
  return `M${S.x},${S.t} C${S.x},${S.t - h} ${D.x},${D.t - h} ${D.x},${D.t}`;
}
