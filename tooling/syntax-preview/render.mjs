import { createHighlighter } from "shiki";
import githubLight from "shiki/themes/github-light.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const [grammarPath, examples, out] = process.argv.slice(2);
const g = JSON.parse(readFileSync(grammarPath, "utf8"));
// ReactiveScript's forms get their own colours on top of GitHub's themes
const extra = (dark) => [
  { scope: ["storage.type.source.rx", "variable.other.readwrite.source.rx", "variable.other.readwrite.write.rx", "keyword.operator.assignment.write.rx"], settings: { foreground: dark ? "#ffb86b" : "#a14a00", fontStyle: "bold" } },
  { scope: ["keyword.other.action.rx"], settings: { foreground: dark ? "#ffb86b" : "#a14a00", fontStyle: "italic" } },
  { scope: ["variable.other.constant.equation.rx"], settings: { foreground: dark ? "#5fd3c6" : "#0b766e" } },
  { scope: ["keyword.operator.reactive.rx", "keyword.operator.probe.rx", "keyword.control.flow.stream.rx", "keyword.operator.first-paint.rx", "storage.modifier.key.rx", "storage.modifier.rx"], settings: { foreground: dark ? "#c9b0ff" : "#6b35d9" } },
  { scope: ["keyword.control.boundary.rx", "keyword.control.loading.rx", "keyword.control.on.rx"], settings: { foreground: dark ? "#ff8fb8" : "#b8174f", fontStyle: "bold" } },
  { scope: ["storage.modifier.server.rx", "storage.modifier.row.rx"], settings: { foreground: dark ? "#8fb5ff" : "#2557a8", fontStyle: "italic" } },
  { scope: ["variable.other.constant.context.rx", "keyword.other.provide.rx"], settings: { foreground: dark ? "#e3c46a" : "#7a5d00" } },
];
const light = { ...githubLight, name: "rx-light", tokenColors: [...githubLight.tokenColors, ...extra(false)] };
const dark = { ...githubDark, name: "rx-dark", tokenColors: [...githubDark.tokenColors, ...extra(true)] };
const hl = await createHighlighter({ themes: [light, dark], langs: ["tsx", "css", { ...g, name: "rx", embeddedLangs: ["tsx", "css"] }] });
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".rx") ? [p] : []; });
const files = walk(examples).map(p => relative(examples, p)).sort();
const groupOf = f => f.includes("/") ? f.split("/").slice(0, -1).join("/") : "single files";
const order = ["notes", "shop", "ai2/search", "ai2/settings", "ai2/tracker", "ai", "single files"];
const groups = [...new Set(files.map(groupOf))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const id = f => f.replace(/\.d\.rx$/, "-d").replace(/\.rx$/, "").replace(/[^A-Za-z0-9]+/g, "-");
let sections = "", nav = "";
for (const grp of groups) {
  const fs = files.filter(f => groupOf(f) === grp).sort((a, b) => (b.endsWith("main.rx") - a.endsWith("main.rx")) || a.localeCompare(b));
  nav += `<li class="grp"><span>${esc(grp)}</span><ul>${fs.map(f => `<li><a href="#${id(f)}">${esc(f.split("/").pop())}</a></li>`).join("")}</ul></li>`;
  for (const f of fs) {
    const code = readFileSync(join(examples, f), "utf8").replace(/\s+$/, "");
    const html = hl.codeToHtml(code, { lang: "rx", themes: { light: "rx-light", dark: "rx-dark" }, defaultColor: false });
    const lines = code.split("\n").length;
    sections += `<section id="${id(f)}"><header><h2>${esc(f)}</h2><span class="meta">${lines} lines</span></header><div class="code">${html}</div></section>\n`;
  }
}
const total = files.reduce((n, f) => n + readFileSync(join(examples, f), "utf8").split("\n").length, 0);
writeFileSync(out, readFileSync(new URL("./page.html", import.meta.url), "utf8").replace("<!--NAV-->", nav).replace("<!--SECTIONS-->", sections).replace("<!--COUNT-->", `${files.length} files · ${total} lines`));
console.log(files.length, "files", total, "lines");
