# T2.6 Frontend Safety and Accessibility

The frontend continues to use only the same-origin HttpOnly browser session. Repository scanning rejects long-lived credential references in `frontend/src`, and the post-build scanner independently reads every generated HTML, JavaScript, CSS and source-map text artifact. A production bundle containing `RAG_API_KEY`, `MODEL_API_KEY` or `X-API-Key` fails the security gate.

Upload errors and acceptance-context errors use `role=alert`; Chat API failures receive the same assertive role inside the message log. Upload and publication actions expose busy state, native buttons remain disabled whenever an action is unavailable, and the question textarea now follows its disabled parent state. File selection, upload/publication actions, navigation, send, close and reopen controls all retain visible keyboard focus treatment.

At 820 px the acceptance console becomes a single column. At 520 px its action rows, publication result and audit grid stack; file names may wrap; padding contracts; and Topic metadata remains bounded. The chat shell removes fixed outer spacing, constrains the root width, reduces header/citation spacing and permits long citation file names to wrap.

Automated evidence covers alerts, busy/disabled states, focus selectors, narrow-screen rules, safe and deliberately contaminated bundle fixtures, page loading/empty/API-error states, production build and the real generated bundle scan. In-app visual inspection remains unavailable because the browser-control process did not start in this Windows sandbox, as recorded in the T2.1 page evidence.
