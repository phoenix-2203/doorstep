# Doorstep delivery bot

The bot watches every Doorstep address that has been registered (announced), and delivers each payment into its contract within seconds. It pays the network fee and is repaid from the payment, capped by each address's fee limit. Anyone can run one; several can run at once.

The bot can only ever deliver to the contract in the instructions or return the money to the refund wallet. A bot that stops just means payments wait until someone delivers them.

## 1. Give the bot its own wallet

Use a separate wallet with a little USDC for gas, not your main wallet.

```shell
arc-cast wallet new ~/.foundry/keystores doorstep-keeper    # asks for a password, prints the address
```

Send about 0.1 USDC on Arc to the address it prints. Each delivery costs under 0.01 USDC up front and is repaid from the payment, so the balance stays roughly level.

## 2. Configure

```shell
cd keeper
cp .env.example .env
```

Edit `.env`: set `RPC_URL` to your own endpoint (the public one rate-limits a bot that runs all day), `DOORSTEP` and `FROM_BLOCK` to the deployment you deliver for, and `KEEPER_KEYSTORE` to the keystore from step 1. `.env` is git-ignored; keep it private.

## 3. Run it on your Mac

```shell
caffeinate -i ./start.sh     # caffeinate keeps the Mac awake while the bot runs
```

It asks for the keystore password once, then prints each delivery:

```
[discover] 0x7ce28911 -> 0xEB95…788a (block 25489102)
[land] 0x7ce28911 0.05 USDC status=success tx=0x…
```

Stop it with Ctrl+C.

## 4. Move it to a VPS (Linux)

1. Install Node.js 20+ and Arc Foundry, clone the repo, and repeat steps 1 and 2 there (or copy the keystore file over).
2. For unattended running, put the keystore password in a file only you can read and point `KEEPER_PASSWORD_FILE` at it:
   ```shell
   printf '%s' 'your-password' > ~/.doorstep-keeper-password && chmod 600 ~/.doorstep-keeper-password
   ```
3. Run it as a service so it restarts after crashes and reboots: edit `User` and the paths in `doorstep-keeper.service`, then
   ```shell
   sudo cp doorstep-keeper.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now doorstep-keeper
   journalctl -u doorstep-keeper -f
   ```

## Settings

| Variable | Meaning |
| --- | --- |
| `RPC_URL`, `CHAIN_ID` | Arc mainnet by default |
| `DOORSTEP`, `FROM_BLOCK` | Which Doorstep contract to deliver for, and its deploy block |
| `KEEPER_KEYSTORE` | The bot's Foundry keystore file |
| `KEEPER_PASSWORD_FILE` | Password file for unattended runs; empty means "ask at start" |
| `KEEPER_PRIVATE_KEY` | Alternative to a keystore, for throwaway wallets only |
| `POLL_MS` | How often it checks, in milliseconds (default 2000) |
| `STATE_FILE` | Where it remembers registered addresses (default `keeper-state-<contract>.json`, one per Doorstep contract) |

With no wallet configured it runs read-only and prints what it would deliver.
