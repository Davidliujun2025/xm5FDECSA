// Browser-only example: the API key never enters JavaScript.
export async function createQuerySession() {
  const response = await fetch('/api/rag/v1/auth/browser-session', {
    method: 'POST',
    credentials: 'include'
  });
  if (!response.ok) throw new Error(`session failed: ${response.status}`);
}

export async function askDefaultTopic(message) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(30_000)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${body.errorCode}: ${body.message}`);
  if (body.status === 'ANSWERED') return { answer: body.answer, citations: body.citations };
  if (body.status === 'NO_RELIABLE_EVIDENCE' || body.status === 'BLOCKED') return { answer: body.answer, citations: [] };
  throw new Error('unknown chat status');
}
