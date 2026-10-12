#!/usr/bin/env bash
# Doorstep live demo on Arc mainnet, using only arc-cast and your local encrypted keystore.
# Your key never leaves the keystore; the password is held in a private temp file that is
# deleted when the script exits.
#
#   cd ~/doorstep && bash scripts/demo-mainnet.sh
#
# What it does (about 0.13 USDC moves through Doorstep; all of it comes back to you minus gas):
#   1. A plain wallet send straight to the escrow reverts (the problem).
#   2. Announce an intent: deposit into DemoEscrow for you, refunds to you.
#   3. Native send 0.05 USDC to the deposit address, then land it   -> Landed
#   4. ERC-20 transfer 0.05 USDC to the SAME address, then land it -> Landed (address reused)
#   5. A short-expiry intent: send 0.03 USDC, wait for expiry, land -> Bounced back to you
#   6. (Doorstep v2+) Early cancel: send 0.02 USDC to an intent with a 1 USDC minimum, cancel it
#      at once from the refund wallet -> Bounced (cancelled), every wei back
#   7. Withdraw your escrow credit back to your wallet
# Every transaction hash is written to mainnet-proof.txt.
set -euo pipefail

RPC="${RPC:-https://rpc.mainnet.arc.io}"
EXPLORER="${EXPLORER:-https://explorer.arc.io}"
DOOR="${DOOR:-0x56BD0FEfdaAF9d053a74107E6dDb9de19D306229}"
ESCROW="${ESCROW:-0x3da5F9d36d1AE8769A9460a7788a21c8041C7bB3}"
ACCT="${ACCT:-doorstep-deployer}"
USDC=0x3600000000000000000000000000000000000000
EXPECT_CHAIN="${EXPECT_CHAIN:-5042}"
PROOF="${PROOF:-mainnet-proof.txt}"

INTENT_T='(address,bytes,uint32,address,uint256,uint256,uint64,bytes32)'
LANDED_T0=$(arc-cast keccak "Landed(bytes32,bytes32,address,address,uint256,uint256,uint256)")
BOUNCED_T0=$(arc-cast keccak "Bounced(bytes32,bytes32,address,address,uint8,uint256,uint256,bytes)")

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

# --- preflight -------------------------------------------------------------------------------
chain=$(arc-cast chain-id --rpc-url "$RPC")
[ "$chain" = "$EXPECT_CHAIN" ] || die "RPC is chain $chain, expected $EXPECT_CHAIN"
[ "$(arc-cast code "$DOOR" --rpc-url "$RPC")" != "0x" ] || die "no Doorstep contract at $DOOR"
[ "$(arc-cast code "$ESCROW" --rpc-url "$RPC")" != "0x" ] || die "no DemoEscrow contract at $ESCROW"

PWFILE=$(mktemp)
chmod 600 "$PWFILE"
trap 'rm -f "$PWFILE"' EXIT
read -rsp "Keystore password for '$ACCT': " pw; echo
printf '%s' "$pw" > "$PWFILE"; unset pw

ME=$(arc-cast wallet address --account "$ACCT" --password-file "$PWFILE")
bal() { arc-cast balance "$1" --rpc-url "$RPC" --ether; }
credit() { arc-cast call "$ESCROW" "balanceOf6(address)(uint256)" "$1" --rpc-url "$RPC" | awk '{print $1}'; }

echo "chain $chain | wallet $ME | balance $(bal "$ME") USDC"
echo "Doorstep $DOOR | DemoEscrow $ESCROW"
{
  echo "Doorstep mainnet demo, $(date -u +%Y-%m-%dT%H:%M:%SZ), chain $chain"
  echo "Doorstep   $DOOR"
  echo "DemoEscrow $ESCROW"
  echo "Wallet     $ME"
} > "$PROOF"

# Send a transaction, stop if it fails, print and record its hash.
tx() {
  local label="$1"; shift
  local out hash status
  out=$(arc-cast send --rpc-url "$RPC" --account "$ACCT" --password-file "$PWFILE" --json "$@") || die "$label: send failed"
  hash=$(printf '%s' "$out" | sed -n 's/.*"transactionHash":"\(0x[0-9a-fA-F]*\)".*/\1/p' | head -1)
  status=$(printf '%s' "$out" | sed -n 's/.*"status":"\(0x[0-9a-fA-F]*\)".*/\1/p' | head -1)
  [ -n "$hash" ] || die "$label: no transaction hash in output"
  [ "$status" = "0x1" ] || die "$label: transaction $hash failed (status $status)"
  echo "   $label: $EXPLORER/tx/$hash"
  echo "$label: $EXPLORER/tx/$hash" >> "$PROOF"
  LAST_TX="$hash"
}

# Which Doorstep event did a landing emit?
outcome() {
  local r; r=$(arc-cast receipt "$1" --rpc-url "$RPC" --json)
  if printf '%s' "$r" | grep -qi "${LANDED_T0#0x}"; then echo Landed
  elif printf '%s' "$r" | grep -qi "${BOUNCED_T0#0x}"; then echo Bounced
  else echo none; fi
}

land() { tx "$1" "$DOOR" "land($INTENT_T)" "$2" --gas-limit 600000; }

# --- 1. the problem --------------------------------------------------------------------------
say "1. Plain wallet send straight to the escrow"
if est=$(arc-cast estimate "$ESCROW" --value 0.01ether --from "$ME" --rpc-url "$RPC" 2>&1); then
  die "a plain send to the escrow did not revert; the demo premise does not hold"
fi
printf '%s' "$est" | grep -qi "revert" || die "unexpected error checking the escrow: $est"
echo "   reverts, as expected: DemoEscrow has no payable receive()"
echo "plain send to escrow: reverts (eth_estimateGas)" >> "$PROOF"

# --- 2. intent A -----------------------------------------------------------------------------
say "2. Announce an intent: deposit into DemoEscrow for $ME"
CALLDATA=$(arc-cast calldata "deposit(uint256,address)" 0 "$ME")
REF_A=$(arc-cast format-bytes32-string "doorstep-mainnet-demo")
EXP_A=1798761600   # 2027-01-01T00:00:00Z
INTENT_A="($ESCROW,$CALLDATA,4,$ME,10000,10000,$EXP_A,$REF_A)"
DEP_A=$(arc-cast call "$DOOR" "addressOf($INTENT_T)(address)" "$INTENT_A" --rpc-url "$RPC")
echo "   deposit address: $DEP_A"
echo "deposit address A: $DEP_A" >> "$PROOF"
tx "announce A" "$DOOR" "announce($INTENT_T)" "$INTENT_A"

# --- 3. native send + land -------------------------------------------------------------------
say "3. Native send 0.05 USDC to the deposit address, then land"
c0=$(credit "$ME")
tx "native send 0.05 to A" "$DEP_A" --value 0.05ether
land "land A (native)" "$INTENT_A"
[ "$(outcome "$LAST_TX")" = Landed ] || die "expected Landed"
c1=$(credit "$ME")
echo "   Landed. Escrow credit: $c0 -> $c1 (6-decimal units)"
[ "$(arc-cast code "$DEP_A" --rpc-url "$RPC")" = "0x" ] || die "deposit address still has code"

# --- 4. ERC-20 transfer to the same address + land -------------------------------------------
say "4. ERC-20 transfer 0.05 USDC to the same address (later tx), then land"
tx "ERC-20 transfer 0.05 to A" "$USDC" "transfer(address,uint256)" "$DEP_A" 50000
land "land A again (ERC-20, reused address)" "$INTENT_A"
[ "$(outcome "$LAST_TX")" = Landed ] || die "expected Landed"
c2=$(credit "$ME")
echo "   Landed. Escrow credit: $c1 -> $c2"

# --- 5. expiry bounce ------------------------------------------------------------------------
say "5. Short-expiry intent: send, wait for expiry, land -> bounces back to you"
NOW=$(arc-cast block latest -f timestamp --rpc-url "$RPC")
EXP_B=$((NOW + 45))
REF_B=$(arc-cast format-bytes32-string "doorstep-bounce-demo")
INTENT_B="($ESCROW,$CALLDATA,4,$ME,10000,10000,$EXP_B,$REF_B)"
DEP_B=$(arc-cast call "$DOOR" "addressOf($INTENT_T)(address)" "$INTENT_B" --rpc-url "$RPC")
echo "   deposit address: $DEP_B (expires at block time $EXP_B)"
echo "deposit address B: $DEP_B (expiry $EXP_B)" >> "$PROOF"
tx "native send 0.03 to B" "$DEP_B" --value 0.03ether
printf '   waiting for expiry'
while [ "$(arc-cast block latest -f timestamp --rpc-url "$RPC")" -le "$EXP_B" ]; do printf '.'; sleep 5; done; echo
land "land B (expired -> bounce)" "$INTENT_B"
[ "$(outcome "$LAST_TX")" = Bounced ] || die "expected Bounced"
[ "$(credit "$ME")" = "$c2" ] || die "escrow credit changed on a bounce"
echo "   Bounced. Refunded to $ME"

# --- 6. early cancel (v2+) -------------------------------------------------------------------
if arc-cast call "$DOOR" "NEW_ACCOUNT_GAS()(uint256)" --rpc-url "$RPC" >/dev/null 2>&1; then
  say "6. Early cancel: pay less than the minimum, then take it back at once"
  REF_C=$(arc-cast format-bytes32-string "doorstep-cancel-demo")
  INTENT_C="($ESCROW,$CALLDATA,4,$ME,1000000,10000,$EXP_A,$REF_C)"
  DEP_C=$(arc-cast call "$DOOR" "addressOf($INTENT_T)(address)" "$INTENT_C" --rpc-url "$RPC")
  echo "   deposit address: $DEP_C (minimum 1 USDC)"
  echo "deposit address C: $DEP_C (minimum 1 USDC)" >> "$PROOF"
  tx "native send 0.02 to C" "$DEP_C" --value 0.02ether
  if arc-cast estimate "$DOOR" "land($INTENT_T)" "$INTENT_C" --from "$ME" --rpc-url "$RPC" >/dev/null 2>&1; then
    die "landing below the minimum should revert"
  fi
  echo "   land reverts (below minimum): the money waits"
  tx "cancel C (refund wallet takes it back)" "$DOOR" "cancel($INTENT_T)" "$INTENT_C" --gas-limit 300000
  [ "$(outcome "$LAST_TX")" = Bounced ] || die "expected Bounced (cancelled)"
  [ "$(arc-cast balance "$DEP_C" --rpc-url "$RPC")" = "0" ] || die "deposit address not empty after cancel"
  echo "   Cancelled. 0.02 USDC back to $ME, no delivery fee"
else
  say "6. Early cancel: skipped (this Doorstep is v1, which has no cancel)"
fi

# --- 7. withdraw from the escrow -------------------------------------------------------------
say "7. Withdraw your escrow credit ($c2) back to your wallet"
tx "escrow withdraw" "$ESCROW" "withdraw(uint256,address)" "$c2" "$ME"

say "Done"
echo "   Doorstep balance: $(bal "$DOOR") USDC (should be 0)"
echo "   Wallet balance:   $(bal "$ME") USDC"
echo "   Proof written to $PROOF"
