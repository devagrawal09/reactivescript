export type Hit = { id: number; name: string };
export type Item = { id: number; name: string; blurb: string };
export function search(q: string): Promise<Hit[]>;
export function fetchItem(id: number): Promise<Item | null>;
