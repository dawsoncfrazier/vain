# Mac node (optional): give the cloud vAIn your Mac's model

1. Make a secret (never share it): `openssl rand -hex 24`
2. Start the node (llama-server must already run on 8080):
   `VAIN_NODE_SECRET=<secret> python3 bridge/vain_node.py`
3. Tunnel (needs a free Cloudflare account + a domain on it):
   `cloudflared tunnel login && cloudflared tunnel create vain-mac`
   route a hostname, e.g. `mac.example.com`, to `http://127.0.0.1:8090`, then `cloudflared tunnel run vain-mac`.
4. In Cloudflare Zero Trust, put an **Access application** on that hostname and create a **service token**.
   Allow only that token. This is the first lock; the bearer secret is the second.
5. In Pages -> Settings -> Environment variables set (as encrypted secrets):
   `MAC_NODE_URL=https://mac.example.com`, `MAC_NODE_SECRET=<secret>`,
   `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`.

The node only serves /node/health and /node/chat, never files or shell. If the Mac is asleep, the cloud
site falls back to the biggest hosted model automatically.
