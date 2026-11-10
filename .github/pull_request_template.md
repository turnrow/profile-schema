## What changed and why

<!-- What a reviewer needs to know first. Link the issue ("Closes #n"). -->

## Checks

- [ ] `npm test` passes.
- [ ] Example outputs are regenerated (CI fails on a difference).
- [ ] README, CHANGELOG and SECURITY say what the code now does.

## Privacy

- [ ] Nothing a profile marks private, unapproved or unconsented can reach an output or a release through this change.
- [ ] No real person's data is added to the repository.

## Accessibility checks a tool can't make

Fill this in when the change touches the résumé PDF, a template, the review file, or any text a reader sees. Otherwise write "Not applicable" and say why.

CI already checks what a tool can: veraPDF validates every example PDF against PDF/UA-1, and the tests check heading order and table headers in the review file. These are the checks it can't make. Use the PDFs from the `resume-pdfs` artifact of this pull request's CI run, so you check what was built.

- [ ] **Screen reader.** I listened to at least `sample.pdf` and `recommended-photo.pdf` from start to end with a screen reader (name which: NVDA, JAWS, VoiceOver, Orca). Headings are announced at the right levels, nothing is skipped or read twice, dates are read with the entry they belong to, and the photo's description says what the photo shows.
- [ ] **Reading order.** Read aloud, the order matches the page from top to bottom. I also checked by selecting all the text and pasting it into a plain-text editor.
- [ ] **Plain language.** Headings and fixed wording added or changed here are short and plain, and mean the same in every language they are translated into. New translations were checked by a fluent speaker, or are listed below as unchecked.
- [ ] **Not by appearance alone.** Nothing new depends on color, position, an icon or bold type alone to carry meaning.
- [ ] **Contrast.** New colors come from `brand/design-system/tokens.json` and meet 7:1 on their background (`brand/tools/contrast.py`).
- [ ] **Zoom.** At 200% the PDF is still readable without losing text.

**Not checked, and why:**

<!-- Be exact: "No screen reader on this machine" is a fine answer. An unchecked box with a reason is better than a checked box without the check. -->

**Exceptions.** A failing veraPDF rule is fixed in the template, never exempted to get a green build. If something truly can't be fixed yet, say what, why, who owns it and when it will be looked at again.
