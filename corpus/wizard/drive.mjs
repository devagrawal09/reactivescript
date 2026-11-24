// Step 1: inputs 0 name, 1 email, button 0 Next.
// Step 2: buttons 0 Back, 1 Free, 2 Pro, 3 Team, 4 Next. No inputs.
// Step 3: buttons 0 Back, 1 −, 2 +, 3 Agree, 4 Submit. No inputs.
// Submit is the only promise. A click that fails validation pushes nothing.
export const steps = [
  { click: 0 },
  { input: 0, value: "Ada Lovelace" },
  { input: 1, value: "ada@acme.com" },
  { click: 0 },
  { click: 4 },
  { click: 2 },
  { click: 4 },
  { click: 1 },
  { click: 2 },
  { click: 2 },
  { click: 3 },
  { click: 4 },
  { resolve: true },
  { click: 0 },
  { click: 1 },
  { click: 4 },
  { click: 3 },
  { click: 4 },
  { click: 3 },
  { click: 2 },
  { click: 4 },
  { resolve: true },
  { click: 0 },
  { click: 0 },
  { input: 0, value: "Ada L." },
  { click: 0 },
  { click: 3 },
  { click: 4 },
]
