// List controls live under the loading boundary. After the load resolves:
// input 0 draft
// button 0 Add, 1 all, 2 active, 3 done
// then Done/Remove pairs in list order: t1, t2, t3, t4
// (4/5, 6/7, 8/9, 10/11). Mutations stay on All so those indexes hold.
// Each mutation is one promise: the server returns the whole list.
export const steps = [
  { resolve: true },
  { click: 2 },
  { click: 1 },
  { click: 3 },
  { click: 1 },
  { click: 4 },
  { resolve: true },
  { click: 6 },
  { resolve: true },
  { input: 0, value: "Write the postmortem" },
  { click: 0 },
  { resolve: true },
  { click: 2 },
  { click: 1 },
  { click: 8 },
  { resolve: true },
  { input: 0, value: "   " },
  { click: 0 },
  { input: 0, value: "File the retro" },
  { click: 0 },
  { resolve: true },
  { click: 11 },
  { resolve: true },
  { click: 3 },
  { click: 1 },
  { click: 4 },
  { resolve: true },
  { click: 2 },
  { click: 1 },
]
