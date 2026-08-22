# T2.2 Browser File Preflight

The browser preflight is a pure, independently tested function. It accepts only PDF, DOCX, XLSX, PPTX, MD and TXT by the final case-insensitive filename extension, requires a finite size greater than zero, and permits the configured maximum byte boundary. Unsupported or missing extensions return `LOCAL_FORMAT_CHECK`; empty, invalid-size and oversized files return `LOCAL_SIZE_CHECK` with the effective limit in the message.

`UploadAcceptance` runs the preflight before retaining the selected or dropped file. A rejected file leaves the component without a file, so the upload action remains disabled and `uploadAcceptanceFile` cannot run. The file input is also disabled until acceptance context has loaded.

This check is deliberately advisory. The browser does not attempt MIME, magic-byte, archive, parser or content validation; the canonical backend remains the final authority and returns stable API errors for those cases. Automated coverage includes all six valid extensions, uppercase names, the exact 30 MB boundary, legacy Office extensions, ZIP, image, missing extension, 0 B, non-finite size and one byte over the limit.
