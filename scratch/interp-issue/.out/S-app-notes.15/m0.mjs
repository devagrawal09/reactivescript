// compiled by ReactiveScript ref/compile from data.rx — do not edit
let c$NotFound;
function g$NotFound(__rt) {
	const __B = __rt.B;
	return c$NotFound ??= __rt.errorClass("NotFound", ["id"], (v$id) => "note " + __rt.fmt(v$id) + " not found");
}
async function sf$listNotes(...__a) {
	"use server";
	const __rt = globalThis.__rx_app;
	const __B = __rt.B;
	const v$dbNotes = __rt.api("dbNotes");
	const v$dbNote = __rt.api("dbNote");
	const v$dbSave = __rt.api("dbSave");
	const v$Conflict = __rt.jsError("Conflict");
	const v$NotFound = g$NotFound(__rt);
	function v$note(v$r) {
		return {
			"id": v$r?.id,
			"title": v$r?.title,
			"body": v$r?.body,
			"updated": v$r?.updated
		};
	}
	return __rt.serverCall("listNotes", function* (v$q) {
		let v$rows = yield __rt.awaited(v$dbNotes(v$q));
		return v$rows?.map((v$r) => v$note(v$r));
	}, __a);
}
async function sf$getNote(...__a) {
	"use server";
	const __rt = globalThis.__rx_app;
	const __B = __rt.B;
	const v$dbNotes = __rt.api("dbNotes");
	const v$dbNote = __rt.api("dbNote");
	const v$dbSave = __rt.api("dbSave");
	const v$Conflict = __rt.jsError("Conflict");
	const v$NotFound = g$NotFound(__rt);
	function v$note(v$r) {
		return {
			"id": v$r?.id,
			"title": v$r?.title,
			"body": v$r?.body,
			"updated": v$r?.updated
		};
	}
	return __rt.serverCall("getNote", function* (v$id) {
		let v$r = yield __rt.awaited(v$dbNote(v$id));
		if (__rt.eq(v$r, null)) {
			throw v$NotFound(v$id);
		} else {}
		return v$note(v$r);
	}, __a);
}
async function sf$saveNote(...__a) {
	"use server";
	const __rt = globalThis.__rx_app;
	const __B = __rt.B;
	const v$dbNotes = __rt.api("dbNotes");
	const v$dbNote = __rt.api("dbNote");
	const v$dbSave = __rt.api("dbSave");
	const v$Conflict = __rt.jsError("Conflict");
	const v$NotFound = g$NotFound(__rt);
	function v$note(v$r) {
		return {
			"id": v$r?.id,
			"title": v$r?.title,
			"body": v$r?.body,
			"updated": v$r?.updated
		};
	}
	return __rt.serverCall("saveNote", function* (v$id, v$title, v$body) {
		let v$r = yield __rt.awaited(v$dbSave(v$id, v$title, v$body));
		return v$note(v$r);
	}, __a);
}
export default function module(__rt) {
	const __B = __rt.B;
	const __o = __rt.owner();
	const v$dbNotes = __rt.api("dbNotes");
	__rt.reg("dbNotes", { value: v$dbNotes });
	const v$dbNote = __rt.api("dbNote");
	__rt.reg("dbNote", { value: v$dbNote });
	const v$dbSave = __rt.api("dbSave");
	__rt.reg("dbSave", { value: v$dbSave });
	const v$Conflict = __rt.jsError("Conflict");
	__rt.reg("Conflict", { value: v$Conflict });
	const v$NotFound = g$NotFound(__rt);
	function v$note(v$r) {
		return {
			"id": v$r?.id,
			"title": v$r?.title,
			"body": v$r?.body,
			"updated": v$r?.updated
		};
	}
	const v$search = __rt.action(function* (v$q) {
		w$query.set(v$q);
	});
	__rt.reg("search", { value: v$search });
	const v$open = __rt.action(function* (v$id) {
		w$route.set({
			"page": "note",
			"id": v$id
		});
		w$saveError.set("");
	});
	__rt.reg("open", { value: v$open });
	const v$back = __rt.action(function* () {
		w$route.set({ "page": "list" });
	});
	__rt.reg("back", { value: v$back });
	const v$save = __rt.action(function* (v$id, v$title, v$body) {
		w$saveError.set("");
		w$notes.guess((v$ns) => v$ns?.map((v$n) => __rt.eq(v$n?.id, v$id) ? {
			...v$n,
			"title": v$title,
			"body": v$body
		} : v$n));
		try {
			try {
				let v$saved = yield __rt.awaited(v$saveNote(v$id, v$title, v$body));
				w$notes.set((v$ns) => v$ns?.map((v$n) => __rt.eq(v$n?.id, v$id) ? v$saved : v$n));
				__rt.refresh("current", v$current);
			} catch (v$e) {
				if (!__rt.isA(v$e, [v$Conflict])) throw v$e;
				w$saveError.set("someone else saved first: " + __rt.fmt(v$e?.message));
			}
		} catch (v$e) {
			w$saveError.set(v$e?.message);
		}
	});
	__rt.reg("save", { value: v$save });
	const v$listNotes = __rt.serverRef("listNotes", sf$listNotes);
	const v$getNote = __rt.serverRef("getNote", sf$getNote);
	const v$saveNote = __rt.serverRef("saveNote", sf$saveNote);
	const [v$query, w$query] = __rt.source("query", __rt.untrack(() => ""));
	__rt.reg("query", {
		get: v$query,
		w: w$query
	});
	const [v$route, w$route] = __rt.source("route", __rt.untrack(() => ({ "page": "list" })));
	__rt.reg("route", {
		get: v$route,
		w: w$route
	});
	const [v$notes, w$notes] = __rt.question("notes", (__prev) => __rt.awaited(v$listNotes(v$query())), undefined, {
		optimistic: true,
		structured: false
	}, "id");
	__rt.reg("notes", {
		get: v$notes,
		w: w$notes
	});
	const v$current = __rt.memo("current", (__prev) => __rt.eq(v$route()?.page, "note") ? __rt.awaited(v$getNote(v$route()?.id)) : null, undefined);
	__rt.reg("current", { get: v$current });
	const [v$saveError, w$saveError] = __rt.source("saveError", __rt.untrack(() => ""));
	__rt.reg("saveError", {
		get: v$saveError,
		w: w$saveError
	});
	return {
		"NotFound": v$NotFound,
		"query": v$query,
		"route": v$route,
		"notes": v$notes,
		"current": v$current,
		"saveError": v$saveError,
		"search": v$search,
		"open": v$open,
		"back": v$back,
		"save": v$save
	};
}
