// A fake backend for running the examples in a browser (`ref/compile/build.ts`): every function answers after a delay.
const later = (v, ms = 400) => new Promise(r => setTimeout(() => r(typeof v === "function" ? v() : v), ms));
const fail = (msg, ms = 400) => new Promise((_, j) => setTimeout(() => j(new Error(msg)), ms));

const users = [
  { id: 1, name: "Ann", email: "ann@example.com" }, { id: 2, name: "Bob", email: "bob@example.com" },
  { id: 3, name: "Cy", email: "cy@example.com" }, { id: 4, name: "Dee", email: "dee@example.com" },
];
export const fetchUsers = (page, query) => later(() => users.filter(u => u.name.toLowerCase().includes(String(query).toLowerCase())).slice((page - 1) * 2, page * 2), 600);
export const saveUser = (id, name) => later(() => { const u = users.find(u => u.id === id); u.name = name; return { ...u }; }, 800);

export const checkUsername = name => later(name === "ryan", 500);
export const register = (username) => later({ ok: true, message: `welcome, ${username}` }, 700);

export const fetchProducts = () => later([{ id: 1, name: "Tea", price: 4 }, { id: 2, name: "Mug", price: 10 }, { id: 3, name: "Pot", price: 25 }]);
export const validateCoupon = code => later(code === "SAVE10" ? 10 : 0);
let orders = 76;
export const checkout = items => items.some(l => l.qty > 5) ? fail("too many of one item") : later({ id: ++orders }, 900);

export const fetchRooms = () => later([{ id: 1, name: "general" }, { id: 2, name: "random" }]);
export async function* streamMessages(room) {
  yield [{ id: 1, from: "ann", text: `welcome to room ${room}` }];
  await later(null, 1500); yield [{ id: 1, from: "ann", text: `welcome to room ${room}` }, { id: 2, from: "bob", text: "hi" }];
}
export const sendMessage = () => later(true, 600);

const rows = [{ id: 1, name: "ann", age: 30 }, { id: 2, name: "bob", age: 25 }, { id: 3, name: "cat", age: 40 }, { id: 4, name: "dan", age: 35 }, { id: 5, name: "eve", age: 28 }];
export const fetchRows = (page, sortBy) => later(() => ({ rows: [...rows].sort((a, b) => a[sortBy] < b[sortBy] ? -1 : 1).slice((page - 1) * 2, page * 2), total: rows.length }));

export const submitSignup = form => form.name === "fail" ? fail("name refused") : later(42);
