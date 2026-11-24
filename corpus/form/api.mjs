export const pending = [];

export function passwordScore(pw) {
  const s = String(pw);
  let n = 0;
  if (s.length >= 8) n += 1;
  if (s.length >= 12) n += 1;
  if (/[A-Z]/.test(s)) n += 1;
  if (/[0-9]/.test(s)) n += 1;
  return n;
}

export function register(name, email, password, company, plan, newsletter) {
  const taken = String(email).toLowerCase() === "taken@acme.com";
  const value = taken
    ? { ok: false, code: "email_taken", message: "That email is already registered" }
    : { ok: true, code: "created", message: "Welcome, " + name, id: 1001, plan, company, newsletter: !!newsletter };
  return new Promise((resolve, reject) => {
    pending.push({ resolve, reject, value });
  });
}
