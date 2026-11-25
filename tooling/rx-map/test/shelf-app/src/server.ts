// A fake server for the reading list, deterministic for the r4 travel tests: `load()` answers after 300 ms,
// `save()` after 200 ms and fails every fourth call. Ids count up.
export type Book = { id: string; title: string; author: string; read: boolean };

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let db: Book[] = [
  { id: 'b1', title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', read: true },
  { id: 'b2', title: 'Piranesi', author: 'Susanna Clarke', read: false },
  { id: 'b3', title: 'Godel, Escher, Bach', author: 'Douglas Hofstadter', read: false },
  { id: 'b4', title: 'A Wizard of Earthsea', author: 'Ursula K. Le Guin', read: false },
];

let failNext = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fail');
let saves = 0;

export async function load(): Promise<Book[]> {
  await delay(300);
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
