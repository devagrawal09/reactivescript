export const pending = [];

function later(value) {
  return new Promise((resolve, reject) => {
    pending.push({ resolve, reject, value });
  });
}

let seq = 0;

export function loadRevenue(range) {
  seq += 1;
  const days = range === "90d" ? 90 : range === "30d" ? 30 : 7;
  return later({ total: days * 120 + seq, delta: days === 7 ? 4 : 11, currency: "USD" });
}

export function loadTickets(range) {
  const n = range === "90d" ? 4 : range === "30d" ? 3 : 2;
  const items = [];
  for (let i = 1; i <= n; i++) items.push({ id: range + "-" + i, title: "Ticket " + i + " (" + range + ")", age: i });
  return later({ open: n, items });
}

export function loadSignups(range) {
  const count = range === "90d" ? 40 : range === "30d" ? 18 : 6;
  return later({ count, trial: Math.round(count / 3), paid: count - Math.round(count / 3) });
}
