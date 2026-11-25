// A fake server for the reading list, deterministic for the r4 travel tests: `load()` answers after 300 ms,
// `save()` after 200 ms and fails every fourth call. Ids count up.
export type Book = { id: string; title: string; author: string; read: boolean };

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function loadAnswer(text: string): Promise<string> {
  await delay(350);
  return text;
}

let db: Book[] = [
  { id: 'b1', title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', read: true },
  { id: 'b2', title: 'Piranesi', author: 'Susanna Clarke', read: false },
  { id: 'b3', title: 'Godel, Escher, Bach', author: 'Douglas Hofstadter', read: false },
  { id: 'b4', title: 'A Wizard of Earthsea', author: 'Ursula K. Le Guin', read: false },
];

let failNext = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fail');
let saves = 0;
let loads = 0;

export async function load(): Promise<Book[]> {
  const number = ++loads;
  await delay(300);
  if (number === 2 && new URLSearchParams(location.search).has("fail-reask"))
    throw Object.assign(new Error("Retry in 5s"), { name: "RateLimited" });
  if (failNext) {
    failNext = false;
    throw new Error('load failed');
  }
  return db.map((b) => ({ ...b }));
}

export async function save(book: Book): Promise<Book> {
  await delay(200);
  if (++saves % 4 === 0) throw new Error('save failed');
  const i = db.findIndex((b) => b.id === book.id);
  db = i < 0 ? [...db, { ...book }] : db.map((b) => (b.id === book.id ? { ...book } : b));
  return { ...book };
}

let n = 0;
export function newId(): string {
  n += 1;
  return `c${n}`;
}

export async function revert(_opId: string): Promise<void> {
  await delay(150);
}

export type Shelf = { name: string; count: number };
// `nope` is not a shelf: its panel shows the error.
export async function loadShelf(id: string): Promise<Shelf> {
  // `slow` answers after 5 s: a question still in the air when travel is asked for (the travel wait is bounded at 3 s)
  await delay(id === 'slow' ? 5000 : 120);
  if (id === 'nope') throw new Error('NotFound "nope"');
  return { name: `Shelf ${id}`, count: id.length };
}
