import type { Pure } from "@reactivescript/types";

export function late(): Promise<Pure<number>> {
  return Promise.resolve(1);
}
