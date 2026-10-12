# Doorstep hosted API

HTTPS endpoints for builders who'd rather not run the SDK: create payment addresses and invoices, check their status, and get signed webhooks when payments are delivered or returned. Full reference: `/docs` on the running API (source: `docs.html`).

```
POST /v1/addresses            create an address or invoice (registered for automatic delivery)
GET  /v1/addresses/{address}  status: waiting, part_paid, delivering, delivered, returned, cancelled, …
GET  /v1/addresses?reference= list yours
GET  /v1/health               no key needed
```

The API never holds money. It calculates Doorstep addresses (anyone can recompute them), registers them on-chain from its own small wallet so delivery bots find them, and reports what the chain says. Watching uses Arc's public RPC, so a free private RPC plan is only used for registrations.

## Run it on the VPS next to the bot

As the `doorstep` user, in the repo:

```shell
cd ~/doorstep && git pull
cd sdk && npm install && cd ../api && npm install
cp .env.example .env            # set PUBLIC_URL and RPC_URL (your Alchemy mainnet URL)
node admin.mjs new-wallet       # the wallet that registers addresses; send it ~0.05 USDC on Arc
node admin.mjs new-key my-app   # an API key and webhook secret for each app
node server.mjs                 # try it, then Ctrl+C
```

As root: install the service and HTTPS.

```shell
cp /home/doorstep/doorstep/api/doorstep-api.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now doorstep-api
apt-get install -y caddy        # see https://caddyserver.com/docs/install if your distro lacks it
cp /home/doorstep/doorstep/api/Caddyfile.example /etc/caddy/Caddyfile   # put your IP in it
systemctl reload caddy
```

The free hostname `api.<your-ip-with-dashes>.sslip.io` resolves to your server with no signup; Caddy gets a Let's Encrypt certificate for it automatically. Ports 80 and 443 must be reachable from the internet.

## Admin

```shell
node admin.mjs new-key <name>      # shown once; the server stores only a hash of the key
node admin.mjs list-keys
node admin.mjs revoke-key <name>
```

Each key may create `CREATES_PER_HOUR` addresses (default 100), since every registration costs the registration wallet about 0.001 USDC.

## Tested

On a local Arc node with the delivery bot and a webhook receiver: an invoice for 0.2 USDC paid as 0.1 + 0.1 (`part_paid`, then `delivered` / invoice `paid`), a below-minimum payment cancelled by the refund wallet (`cancelled`), both webhooks received with valid signatures; missing key → 401; invalid contract → 400; repeated request → existing address.
