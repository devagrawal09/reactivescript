export const pending = [];

let board = {
  todo: [
    { id: "c1", title: "Spec the API" },
    { id: "c2", title: "Draw the empty state" },
    { id: "c3", title: "Wire the save" },
  ],
  doing: [
    { id: "c4", title: "Review the diff" },
    { id: "c5", title: "Fix the flicker" },
  ],
  done: [
    { id: "c6", title: "Ship the header" },
    { id: "c7", title: "Write the notes" },
  ],
};

function later(value) {
  return new Promise((resolve, reject) => {
    pending.push({ resolve, reject, value });
  });
}

function clone() {
  return {
    todo: board.todo.map((c) => ({ ...c })),
    doing: board.doing.map((c) => ({ ...c })),
    done: board.done.map((c) => ({ ...c })),
  };
}

export function loadBoard() {
  return later(clone());
}

export function saveMove(id, to) {
  const all = [...board.todo, ...board.doing, ...board.done];
  const card = all.find((c) => c.id === id);
  board.todo = board.todo.filter((c) => c.id !== id);
  board.doing = board.doing.filter((c) => c.id !== id);
  board.done = board.done.filter((c) => c.id !== id);
  if (card && board[to]) board[to].push(card);
  return later(clone());
}
