import { pure, rejects } from "@reactivescript/js";

export type User = { name: string; title: string };

export class NotFound extends Error {
  constructor(id: number) {
    super(`No user with id ${id}`);
  }
}

export class Offline extends Error {}

// Stands in for a real API call. No annotation: the generated line's types are inferred.
export const fetchUser = pure(rejects([NotFound, Offline], async (id: number) => {
  await new Promise((resolve) => setTimeout(resolve, 10));
  if (id !== 1) throw new NotFound(id);
  const user: User = { name: "Ada", title: "Engineer" };
  return user;
}));

export async function saveUser(id: number, name: string): Promise<void> {
  void id; void name;
}
