export const pending = [];

export function submitSignup(name, email, plan, seats) {
  const value = { id: 77, name, plan, seats };
  return new Promise((resolve, reject) => {
    pending.push({ resolve, reject, value });
  });
}
