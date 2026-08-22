"""Backend query example using only Python's standard library."""
import json
import os
import urllib.error
import urllib.request

BASE_URL = os.environ.get("RAG_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
API_KEY = os.environ.get("RAG_API_KEY")
if not API_KEY:
    raise RuntimeError("RAG_API_KEY is required in the backend process environment")


def post_json(route, payload, timeout):
    request = urllib.request.Request(
        f"{BASE_URL}{route}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body = json.load(error)
        raise RuntimeError(f"{body['errorCode']}: {body['message']}") from error


def search(topic_id, question):
    return post_json("/api/rag/v1/search", {"topicId": topic_id, "question": question}, 10)


def chat(topic_id, question):
    result = post_json("/api/rag/v1/chat", {"topicId": topic_id, "question": question}, 30)
    if result["status"] == "ANSWERED":
        return result["answer"], result["citations"]
    return result["answer"], []
