import type { Pure, Rejects } from "@reactivescript/types";

export type User = { name: string; title: string };

export class NotFound extends Error {
  constructor(id: number) {
    super(`No user with id ${id}`);
  }
}

export class Offline extends Error {}

// Stands in for a real API call.
export async function fetchUser(id: number): Pure<Rejects<Promise<User>, NotFound | Offline>> {
  await new Promise((resolve) => setTimeout(resolve, 10));
  if (id !== 1) throw new NotFound(id);
  return { name: "Ada", title: "Engineer" };
}

export async function saveUser(id: number, name: string): Promise<void> {
  void id; void name;
}
