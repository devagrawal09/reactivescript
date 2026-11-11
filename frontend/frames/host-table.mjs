// The server-only hosts of a frames program (docs/RESULTS.md, "Slice 6"): a seeded table and its loaders and
// mutators, run inside a leg's server process. This is the `server` JS that `db.d.rx` declares (RX SF-5a); the
// client never loads it. Every call is logged with its arguments and its outcome (a value or a plain Error), in call
// order: the leg's server host log, and, recorded from the native split, the answer script the Rust server replays.
//
// Host kinds (the spec's `hosts[]`):
//   list    () -> rows projected to `fields`, in table order
//   record  (id) -> the row whose `key` is id, projected to `fields`; no such row: Error
//   count   () -> the number of rows whose `field` equals `equals`
//   assign  (id) -> sets the row's `field` to `value` and returns `value`; a row whose field is not "" (or none): Error
//   scalar  (id) -> the row's `field`; no such row: Error
export function createHostTable(spec) {
  const rows = structuredClone(spec.table);
  const log = (globalThis.__framesHostLog ??= []);
  const find = (key, id) => rows.find(r => r[key] === id);
  const project = (row, fields) => Object.fromEntries(fields.map(f => [f, row[f]]));
  const kinds = {
    list: h => rows.map(r => project(r, h.fields)),
    record: (h, id) => {
      const row = find(h.key ?? 'id', id);
      if (!row) throw new Error('no record ' + id);
      return project(row, h.fields);
    },
    count: h => rows.filter(r => r[h.field] === h.equals).length,
    assign: (h, id) => {
      const row = find(h.key ?? 'id', id);
      if (!row) throw new Error('no record ' + id);
      if (row[h.field] !== '') throw new Error('#' + id + ' is already assigned');
      row[h.field] = h.value;
      return h.value;
    },
    scalar: (h, id) => {
      const row = find(h.key ?? 'id', id);
      if (!row) throw new Error('no record ' + id);
      return row[h.field];
    },
  };
  const hosts = new Map(spec.hosts.map(h => [h.name, h]));
  return {
    async call(name, args) {
      const h = hosts.get(name);
      if (!h) throw new Error('no server host ' + name);
      try {
        const value = kinds[h.kind](h, ...args);
        log.push({ host: name, args, value: structuredClone(value) });
        return value;
      } catch (error) {
        log.push({ host: name, args, error: String(error && error.message) });
        throw error;
      }
    },
  };
}

/** The server host module a leg imports in place of `./db`: one export per declared host. */
export function hostModule(spec, runtime) {
  return 'import { createHostTable } from ' + JSON.stringify(runtime) + ';\n' +
    'const H = createHostTable(' + JSON.stringify(spec) + ');\n' +
    spec.hosts.map(h => 'export const ' + h.name + ' = (...args) => H.call(' + JSON.stringify(h.name) + ', args);').join('\n') + '\n';
}
