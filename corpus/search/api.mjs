export const pending = [];

const CATALOG = [
  { id: 1, name: "Alloy", kind: "lib" },
  { id: 2, name: "Alpine", kind: "lib" },
  { id: 3, name: "Amber", kind: "app" },
  { id: 4, name: "Anchor", kind: "app" },
  { id: 5, name: "Atlas", kind: "tool" },
  { id: 6, name: "Bolt", kind: "tool" },
  { id: 7, name: "Cedar", kind: "lib" },
  { id: 8, name: "Cinder", kind: "app" },
];

export function search(q) {
  const query = String(q).trim().toLowerCase();
  const value = query === ""
    ? CATALOG.slice(0, 3)
    : CATALOG.filter((h) => h.name.toLowerCase().includes(query) || h.kind.includes(query));
  return new Promise((resolve, reject) => {
    pending.push({ resolve, reject, value });
  });
}
