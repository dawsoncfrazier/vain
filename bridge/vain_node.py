#!/usr/bin/env python3
"""vAIn Mac node: lets the cloud site use your Mac's local model. Python 3.9+, standard library only.

Listens on 127.0.0.1 only. Expose it with a Cloudflare Tunnel protected by Access (see README_BRIDGE.md).
It answers exactly two routes and proxies nothing else:
  GET  /node/health
  POST /node/chat   {messages, max_tokens, temperature, no_think}
Every request needs  Authorization: Bearer <VAIN_NODE_SECRET>.
"""
import hmac, json, os, re, sys, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = os.environ.get("VAIN_NODE_SECRET", "")
LLAMA = os.environ.get("VAIN_LLAMA_URL", "http://127.0.0.1:8080").rstrip("/")
PORT = int(os.environ.get("VAIN_NODE_PORT", "8090"))
MAX_BODY = 200_000
THINK = re.compile(r"<think>.*?</think>", re.S)


def authorized(header):
    if not SECRET or len(SECRET) < 16:
        return False
    want = "Bearer " + SECRET
    return hmac.compare_digest((header or "").encode(), want.encode())


class H(BaseHTTPRequestHandler):
    server_version = "vainnode"

    def log_message(self, *a):
        pass

    def send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if not authorized(self.headers.get("Authorization")):
            return self.send(401, {"error": "unauthorized"})
        if self.path != "/node/health":
            return self.send(404, {"error": "not found"})
        try:
            with urllib.request.urlopen(LLAMA + "/v1/models", timeout=5) as r:
                d = json.load(r)
            m = (d.get("data") or [{}])[0].get("id", "local")
            return self.send(200, {"ok": True, "model": m})
        except Exception as e:
            return self.send(503, {"ok": False, "error": "llama-server unreachable"})

    def do_POST(self):
        if not authorized(self.headers.get("Authorization")):
            return self.send(401, {"error": "unauthorized"})
        if self.path != "/node/chat":
            return self.send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n <= 0 or n > MAX_BODY:
            return self.send(413, {"error": "bad size"})
        try:
            body = json.loads(self.rfile.read(n))
            msgs = [{"role": str(m["role"]), "content": str(m["content"])} for m in body["messages"]][-40:]
        except Exception:
            return self.send(400, {"error": "bad request"})
        if body.get("no_think") and msgs:
            msgs[-1]["content"] += " /no_think"
        req = {"messages": msgs, "stream": False,
               "max_tokens": min(int(body.get("max_tokens") or 700), 2000),
               "temperature": float(body.get("temperature", 0.6))}
        try:
            r = urllib.request.Request(LLAMA + "/v1/chat/completions", json.dumps(req).encode(),
                                       {"Content-Type": "application/json"})
            with urllib.request.urlopen(r, timeout=85) as resp:
                d = json.load(resp)
            text = THINK.sub("", d["choices"][0]["message"]["content"] or "").strip()
            return self.send(200, {"response": text})
        except Exception:
            return self.send(502, {"error": "local model failed"})


if __name__ == "__main__":
    if len(SECRET) < 16:
        sys.exit("Set VAIN_NODE_SECRET to a random string of 16+ characters first.")
    print("vAIn node on 127.0.0.1:%d -> %s" % (PORT, LLAMA))
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
