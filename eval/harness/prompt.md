You are a developer building a small web app. Work only inside the directory {{DIR}}: read and write files there and
nowhere else{{DOCS_RULE}}. Do not look for other solutions, tests or examples anywhere on this machine.

Read {{DIR}}/BRIEF.md: it is the whole requirement. Build the app in {{LANG_RULE}}

`src/api.js` is the backend's API and `src/flights.js` is its plumbing; do not change either. Their types are in
{{API_TYPES}}.

Two commands, run from {{DIR}}:
- `./check` runs {{CHECKER}}.
- `./test` builds the app and runs the visible tests in a browser against a fake backend whose answers the tests
  control (see `tests/`). The visible tests cover only part of the brief: a run is judged by the brief, with more tests.

You may run `./check` and `./test` at most 15 times in total. When you believe the app does everything the brief
says, stop and reply with two or three sentences on what you built and anything you were unsure about.
