# T2.5 Acceptance Q&A and Citation Verification

After an explicit publication succeeds, the upload page exposes separate “进入问答” and “核对原文件” actions. The Q&A link carries only an acceptance-mode marker; it never accepts a Topic ID from the URL. The chat page obtains the protected acceptance context, displays its fixed Topic name and ID, and keeps question input disabled until that context is available.

The compatibility Chat endpoint remains the source of the Topic binding through `FRONTEND_DEFAULT_TOPIC_ID`. In acceptance mode the frontend additionally supplies the context Topic as `expectedTopicId` when validating the response. A response for any other Topic fails closed with `RAG_TOPIC_MISMATCH` and is not rendered.

The browser treats the final API response as the only answer source. `ANSWERED` must contain one to five structurally valid citations; `NO_RELIABLE_EVIDENCE` and `BLOCKED` must contain none. Invalid status/citation combinations fail with `RAG_INVALID_RESPONSE`. The message view displays the exact answer, final status, numbered citations, file name, compact source location, bounded excerpt and the authenticated original-file link.

Location formatting covers PDF pages, DOCX paragraphs, XLSX worksheets/cells, PPTX slides, Markdown heading/line ranges and TXT line ranges without exposing internal parser `sources`. Automated evidence covers grounded answers, fixed refusal, attack blocking, response/API errors, Topic mismatch, forged citations, loading context, the pre-publication empty state, original-file links and the production frontend build.
