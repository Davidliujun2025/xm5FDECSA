function publicationError(errorCode, message, traceId = null) {
  return Object.assign(new Error(message), { errorCode, traceId });
}

export function createAcceptancePublicationGate(publishDocument) {
  if (typeof publishDocument !== 'function') {
    throw new TypeError('publishDocument must be a function');
  }

  let inFlight = null;

  return {
    isPublishing() {
      return inFlight !== null;
    },

    publish(documentId, options = {}) {
      if (inFlight) {
        return inFlight;
      }
      if (typeof documentId !== 'string' || !documentId.trim()) {
        return Promise.reject(publicationError(
          'LOCAL_DOCUMENT_ID_INVALID',
          '缺少可发布的 READY 文档。'
        ));
      }

      const operation = Promise.resolve()
        .then(() => publishDocument(documentId, options))
        .then((published) => {
          if (published?.status !== 'PUBLISHED') {
            throw publicationError(
              'LOCAL_PUBLICATION_RESPONSE_INVALID',
              '发布响应未确认文档进入 PUBLISHED。',
              published?.traceId
            );
          }
          return published;
        });
      const tracked = operation.finally(() => {
        if (inFlight === tracked) {
          inFlight = null;
        }
      });
      inFlight = tracked;
      return tracked;
    }
  };
}
