# Doorstep for AI agents (MCP server)

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent, such as Claude, take payments on Arc with Doorstep. It has three tools and no others:

| Tool | What it does |
| --- | --- |
| `create_payment_address` | Makes an address that deposits USDC into a contract for a named person, with a refund wallet, deadline, fee limit and reference. Returns the address, a pay link and a plain-language description. Offline: nothing is deployed. The address is cross-checked against the Doorstep contract before it's returned. |
| `check_payment` | Reads a pay link: what it does, what's waiting, what was delivered or returned (with explorer links) and invoice progress. Give it the contract, beneficiary and refund wallet you expect, and it tells you whether a link someone sent you really matches **before** you pay it. |
| `deliver_payment` | Pushes money waiting at an address into its contract (or back to the refund wallet after the deadline). Only if the server has a delivery wallet. |

## What an agent can't do

- **Move money anywhere else.** There's no send or transfer tool. Addresses are computed from their instructions, delivery recomputes the address from the pay link, and the Doorstep contract only ever pays the contract named in the instructions or the refund wallet.
- **Use a look-alike contract.** Links that name another Doorstep contract or another chain are refused.
- **Go past the operator's limits.** `DOORSTEP_ALLOWED_TARGETS` restricts which contracts addresses may pay into, `DOORSTEP_MAX_FEE` caps the delivery fee limit (default 0.02 USDC), and `DOORSTEP_MAX_DAYS` caps how long an address accepts payments (default 90).
- **Spend the delivery wallet.** It only pays network fees, and each delivery repays it from the payment, up to the fee limit.

## Use it with Claude

```shell
cd agent && npm install
```

Claude Desktop (`claude_desktop_config.json`) or any MCP client:

```json
{
  "mcpServers": {
    "doorstep": {
      "command": "node",
      "args": ["/path/to/doorstep/agent/server.mjs"],
      "env": { "DOORSTEP_ALLOWED_TARGETS": "0xYourVault" }
    }
  }
}
```

Claude Code: `claude mcp add doorstep -- node /path/to/doorstep/agent/server.mjs`

Then ask, for example: *"Make a 25 USDC invoice payable into 0xYourVault for 0xCustomer, refunds to 0xCustomer, reference inv-1042"*, or *"Before I pay this link, check it really credits 0xMe"*.

To let it deliver, give it its own wallet with a little USDC for gas, as a Foundry keystore:

```shell
DOORSTEP_KEYSTORE=~/.foundry/keystores/doorstep-agent
DOORSTEP_PASSWORD_FILE=~/.doorstep-agent-password   # chmod 600
```

Other settings: `DOORSTEP_RPC_URL` (default Arc's public RPC), `DOORSTEP_CHAIN_ID` (5042), `DOORSTEP` (the contract), `DOORSTEP_PAY_BASE`.

## Tests

Against a local Arc node with Doorstep deployed (see the main README), through a real MCP client:

```shell
RPC_URL=http://127.0.0.1:8547 DOORSTEP=0x… ESCROW=0x… npm test
```

They cover a full invoice (part payment waits, delivery is refused until it's complete, then delivered and marked paid), catching a swapped beneficiary, refusing a forged contract or chain, the operator limits, and running without a delivery wallet.
