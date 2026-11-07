import json, os, subprocess, sys, threading, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
seen = {}
class L(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        b = json.dumps({"data": [{"id": "qwen-fake"}]}).encode(); self.send_response(200); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        seen["body"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        b = json.dumps({"choices": [{"message": {"content": "<think>hmm</think>answer"}}]}).encode(); self.send_response(200); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
llama = HTTPServer(("127.0.0.1", 18080), L); threading.Thread(target=llama.serve_forever, daemon=True).start()
env = dict(os.environ, VAIN_NODE_SECRET="x" * 24, VAIN_LLAMA_URL="http://127.0.0.1:18080", VAIN_NODE_PORT="18090")
p = subprocess.Popen([sys.executable, "bridge/vain_node.py"], env=env, stdout=subprocess.DEVNULL); time.sleep(1)
def call(path, data=None, tok="x" * 24):
    r = urllib.request.Request("http://127.0.0.1:18090" + path, json.dumps(data).encode() if data else None, {"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.load(x)
    except urllib.error.HTTPError as e: return e.code, None
try:
    assert call("/node/health")[1]["model"] == "qwen-fake"
    assert call("/node/health", tok="wrong")[0] == 401
    s, d = call("/node/chat", {"messages": [{"role": "user", "content": "hi"}], "no_think": True}); assert d["response"] == "answer", d
    assert seen["body"]["messages"][-1]["content"].endswith("/no_think")
    assert call("/other", {"a": 1})[0] == 404
    assert call("/node/chat", {"nope": 1})[0] == 400
    print("bridge ok")
finally: p.terminate()
