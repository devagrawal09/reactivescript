export const pending = [];

const DEPTS = ["Design", "Eng", "Ops", "Sales"];

export function buildRows() {
  const rows = [];
  for (let i = 1; i <= 1000; i++) {
    rows.push({
      id: i,
      name: "Person " + i,
      dept: DEPTS[i % 4],
      score: (i * 17) % 100,
    });
  }
  return rows;
}

export function sortRows(rows, key, dir) {
  const list = Array.from(rows);
  const d = dir === "desc" ? -1 : 1;
  list.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av < bv) return -1 * d;
    if (av > bv) return 1 * d;
    return 0;
  });
  return list;
}
