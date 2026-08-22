# T2.1 Formal Acceptance Upload Page

The production frontend selects `UploadAcceptance` only for `/acceptance/upload`; every other path keeps the existing ChatBot. The backend production fallback serves the same built `index.html` for the upload deep link, so a direct request and a refresh both resolve without introducing an acceptance path into the public API contract.

The page identifies itself as `MOCK / LOCAL ACCEPTANCE`, shows the fixed six-format policy and 30 MB limit while context is loading, displays the bootstrapped Topic identity/status when available, and gives distinct loading, missing-Topic and API-error copy. A prominent safety notice prohibits real enterprise material and explains that files stay in the isolated local Mock data directory.

Navigation is bidirectional: the ChatBot header exposes “上传资料” and the upload page exposes “返回问答页”. The existing inspection-console visual language is retained with a single dark pipeline panel, and the layout collapses to one column below 820 px. Focus styling and reduced-motion handling remain explicit.

Automated evidence covers the page shell, loading/empty/error source states, both links, production direct access plus a second refresh request, the existing Chat main/error states, and a Vite production build. In-app visual inspection could not run because the browser-control process failed to start in the Windows sandbox; no browser interaction was performed.
