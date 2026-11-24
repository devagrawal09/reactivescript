export const pending = [];

const thread = [
  { id: "s1", from: "ada", text: "shipped the patch to staging" },
  { id: "s2", from: "bo", text: "looking now" },
  { id: "s3", from: "ada", text: "the lag is in the list, not the save" },
];

function later(value) {
  return new Promise((resolve, reject) => {
    pending.push({ resolve, reject, value });
  });
}

export function loadMessages() {
  return later(thread.map((m) => ({ ...m })));
}

export function postMessage(text, id) {
  const msg = { id, from: "me", text };
  thread.push(msg);
  return later({ ...msg });
}
