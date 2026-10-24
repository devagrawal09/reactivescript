# S-ai-wizard — examples/ai/wizard.rx

Rules: RG-1a, RG-1b, RG-3, EF-4, EF-5, O-2, E-4, C-2, C-2a, ST-2a, AC-1, AC-7, H-2, H-9, W-3.

Written from the spec alone (no examples consulted). A three-step wizard:
each step is an `if` region with local state and a mount effect whose
cleanup logs leaving; the form is one structured source at the top;
`furthest` remembers the highest step through `pre` of itself; `submit` is
an action whose await may reject and whose catch reports the failure.

## Program

```
file: ../examples/ai/wizard.rx
```

## Frames

| instant | action | frame | effect |
| ------- | ------ | ----- | ------ |
| 0 | mount | `Step 1 of 3 (reached 1)next` | `log(enter, 1)` |
| 1 | handler `if (nameOk) { step := 2 } else { tries := tries + 1 }` | `Step 1 of 3 (reached 1)name requirednext` | — |
| 2 | handler `form.name := "Ann"` | `Step 1 of 3 (reached 1)next` | — |
| 3 | handler `if (nameOk) { step := 2 } else { tries := tries + 1 }` | `Step 2 of 3 (reached 2)email: (invalid)backnext` | `log(leave, 1); log(enter, 2)` |
| 4 | handler `email := "ann@x.io"` | `Step 2 of 3 (reached 2)email: ann@x.io backnext` | — |
| 5 | handler `if (emailOk) { form.email := email; step := 3 }` | `Step 3 of 3 (reached 3)Ann / ann@x.io / no planproagreebacksubmit` | `log(leave, 2); log(enter, 3)` |
| 6 | handler `form.plan := "pro"; agreed := !agreed` | `Step 3 of 3 (reached 3)Ann / ann@x.io / proproagreedbacksubmit` | — |
| 7 | handler `step := 2` | `Step 2 of 3 (reached 3)email: ann@x.io backnext` | `log(leave, 3); log(enter, 2)` |
| 8 | handler `if (emailOk) { form.email := email; step := 3 }` | `Step 3 of 3 (reached 3)Ann / ann@x.io / proproagreebacksubmit` | `log(leave, 2); log(enter, 3)` |
| 9 | handler `agreed := !agreed` | `Step 3 of 3 (reached 3)Ann / ann@x.io / proproagreedbacksubmit` | — |
| 10 | handler `if (ready) { submit() }` | `Step 3 of 3 (reached 3)Ann / ann@x.io / proproagreedbacksubmitsubmitting` | — |
| 11 | reject "submitSignup:{"name":"Ann","email":"ann@x.io","plan":"pro"}" "boom" | `Step 3 of 3 (reached 3)Ann / ann@x.io / proproagreedbacksubmitfailed: boom` | — |

Instant 1: `next` refused — the step-local `tries` shows the hint. Instant 3:
the step-1 region ends (cleanup runs first, O-2) and step 2 is created fresh
with its own effect (EF-4). Instant 5: two writes, one instant (W-3).
Instant 7: going back re-creates step 2 — its buffer re-seeds from the
committed `form.email` (E-4) — and `furthest` keeps 3 through `pre` (C-2).
Instant 8: step 3 is fresh (`agreed` reset, RG-1a) while the shared
`form.plan` is kept; `form.email := email` writes an equal value (ST-2a).
Instant 10: `status := "submitting"` is the action's and is held; the
status reader is a lane reader (`pending? status`, H-9) and shows ahead.
Instant 11: the rejection is thrown at the `await` and caught inside the
body — the catch's write lands with the body's end in one frame (AC-7).

## Variant: the submit resolves

| instant | action | frame | effect |
| ------- | ------ | ----- | ------ |
| 11 | resolve "submitSignup:{"name":"Ann","email":"ann@x.io","plan":"pro"}" 42 | `Step 3 of 3 (reached 3)Ann / ann@x.io / proproagreedbacksubmitdone #42` | — |
