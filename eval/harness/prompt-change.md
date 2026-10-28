You are a developer changing a small web app that already works. Work only inside the directory {{DIR}}: read and
write files there and nowhere else{{DOCS_RULE}}. Keep any scratch files in {{DIR}}/.scratch, and use no other
temporary folder. Do not look for other solutions, tests or examples anywhere on this machine.

Read {{DIR}}/BRIEF.md: it is the change you are asked to make, and the whole requirement for it. {{DIR}}/BASE.md is
the brief the app was built to; the app must keep doing everything it says. The app is written in {{LANG_RULE}}

`src/api.js` is the backend's API and `src/flights.js` is its plumbing; do not change either. Their types are in
{{API_TYPES}}.

Two commands, run from {{DIR}}:
- `./check` runs {{CHECKER}}.
- `./test` builds the app and runs the visible tests in a browser against a fake backend{{BACKEND_NOTE}}
  (see `tests/`). The visible tests cover only part of the briefs: a run is judged by both briefs, with more tests.

You may run `./check` and `./test` at most 15 times in total. When you believe the app does everything both briefs
say, stop and reply with two or three sentences on what you changed and anything you were unsure about.
