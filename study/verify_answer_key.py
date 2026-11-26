#!/usr/bin/env python3
"""Build the study answer key from RAW recorded provider responses.

Independent of TxStory: this script shares no code with src/ and never reads
TxStory's headlines or interpretations. It decodes the RPC transaction, receipt
and block itself, and checks sender balance changes against the explorer's own
recorded state changes where those exist.

The captured recordings it reads are NOT part of the public repository
(their redistribution terms are unresolved; see DATA_PROVENANCE.md). Point
the script at a local copy:

  python3 study/verify_answer_key.py --captured DIR --evidence DIR          (rewrites study/answer-key.json)
  python3 study/verify_answer_key.py --captured DIR --evidence DIR --check  (compares, writes nothing)

Defaults come from TXSTORY_CAPTURED_DIR and TXSTORY_STUDY_EVIDENCE_DIR.
Exit codes: 0 consistent; 1 a computed fact disagrees with explorer evidence
or (with --check) with the committed key; 2 inputs missing.
"""
import argparse
import os
import json
import pathlib
import sys
from decimal import Decimal, getcontext

getcontext().prec = 120
ROOT = pathlib.Path(__file__).resolve().parent.parent
# Set from the command line in main(); see the module docstring.
FIX = pathlib.Path()
EVIDENCE = pathlib.Path()
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"  # Transfer(address,address,uint256)
WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
DEPOSIT = "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c"  # Deposit(address,uint256)

TASKS = [
    # (task, set, chain, hash)
    ("T1", "X", "ethereum", "0xf935435dedce77233eb8855ed84277c0ebf4fbbc278f03ad34167f11446a9730"),
    ("T1", "Y", "ethereum", "0x645ab583f1ea8edc7699314314d236869557971b76723be237d004d4c849df0a"),
    ("T2", "X", "ethereum", "0xec893ce03b8b8ef2d5e0d5edb9db9f63ad0972e2a6845504bc31cca395869804"),
    ("T2", "Y", "ethereum", "0xfe989499443b4aff4d8059b21cab89ea18fd3538f80630c970a878611fc970d3"),
    ("T3", "X", "ethereum", "0xdfd1aafcddded21d650c737b90940226b68e82902dfa807b8059e012f1fd0618"),
    ("T3", "Y", "ethereum", "0x31b4768c1940d3a02bdc9616b2dff7587b404a5ae3cc1fee8be10724a574d3a8"),
    ("T4", "X", "ethereum", "0x1f9753fbf97af6c0cf0d00e7893448203f944644f7d96aa76bc563b36385198a"),
    ("T4", "Y", "ethereum", "0xd711cffdf621402988b430348bd8953aad0d67b61aa570fc0537326500bbc517"),
    ("T5", "X", "ethereum", "0x783cf8c07a02931b7271444c71524f8b29174bafbd74cec382ae802a87ff8a69"),
    ("T5", "Y", "ethereum", "0x55696a279cd550531b7f8ef4d8d234c2b5504fd5bc8dcc19f768d878ca484a83"),
]


def exchange(fx, method_substr, kind=None):
    for e in fx["exchanges"].values():
        if method_substr in e["method"] and (kind is None or e["kind"] == kind) and e["httpStatus"] == 200 and not e.get("failure"):
            return json.loads(e["text"])
    return None


def addr(topic):
    return "0x" + topic[-40:].lower()


def fmt(wei, decimals):
    if not wei:
        return "0"
    return format((Decimal(wei) / (Decimal(10) ** decimals)).normalize(), "f")


def analyse(chain, h):
    fx = json.loads((FIX / f"{chain}-{h}.json").read_text())
    tx = exchange(fx, "eth_getTransactionByHash")["result"]
    rc = exchange(fx, "eth_getTransactionReceipt")["result"]
    sender, to = tx["from"].lower(), (tx["to"] or "").lower()
    ok = int(rc["status"], 16) == 1
    value = int(tx["value"], 16)
    fee = int(rc["gasUsed"], 16) * int(rc["effectiveGasPrice"], 16)

    # Token metadata as reported by the explorer's transfer list (if recorded).
    meta = {}
    tt = exchange(fx, "/token-transfers", "explorer")
    for item in (tt or {}).get("items", []):
        tok = item.get("token") or {}
        a = (tok.get("address_hash") or tok.get("address") or "").lower()
        if a:
            meta[a] = {"symbol": tok.get("symbol"), "decimals": int(tok["decimals"]) if tok.get("decimals") not in (None, "") else None, "type": tok.get("type")}

    # WETH9 is a fixed, well-known contract; used only when the explorer list was not recorded.
    meta.setdefault(WETH, {"symbol": "WETH", "decimals": 18, "type": "ERC-20"})
    fungible, nfts = {}, []
    for log in rc["logs"]:
        t = log["topics"]
        if not t:
            continue
        c = log["address"].lower()
        if t[0].lower() == TRANSFER and len(t) == 3:
            frm, dst, amt = addr(t[1]), addr(t[2]), int(log["data"], 16)
            if frm == sender: fungible[c] = fungible.get(c, 0) - amt
            if dst == sender: fungible[c] = fungible.get(c, 0) + amt
        elif t[0].lower() == TRANSFER and len(t) == 4:
            nfts.append({"contract": c, "tokenId": str(int(t[3], 16)), "from": addr(t[1]), "to": addr(t[2]), "logIndex": int(log["logIndex"], 16)})
        elif t[0].lower() == DEPOSIT and c == WETH and addr(t[1]) == sender:
            fungible[c] = fungible.get(c, 0) + int(log["data"], 16)

    outgoing_transfers = {}
    for log in rc["logs"]:
        t = log["topics"]
        if t and t[0].lower() == TRANSFER and len(t) == 3 and addr(t[1]) == sender:
            outgoing_transfers.setdefault(log["address"].lower(), []).append(int(log["data"], 16))

    # Explorer state changes, if recorded (independent pipeline).
    sc = exchange(fx, "/state-changes", "explorer")
    explorer_sender = None
    if sc:
        explorer_sender = {}
        for it in sc.get("items", []):
            if (it.get("address") or {}).get("hash", "").lower() != sender:
                continue
            if it.get("type") == "coin":
                explorer_sender["ETH"] = int(it["change"])
            elif isinstance(it.get("change"), str):
                tok = (it.get("token") or {})
                explorer_sender[(tok.get("address_hash") or "").lower()] = int(it["change"])

    # Native: value (if success) + fee; internal native movements only via explorer (not in RPC data).
    eth_rpc_only = (-value if ok else 0) - fee
    return {
        "hash": h, "chain": chain, "succeeded": ok, "sender": sender, "to": to,
        "value_wei": str(value), "value_eth": fmt(value, 18),
        "fee_wei": str(fee), "fee_eth": fmt(fee, 18),
        "eth_change_from_rpc_only_wei": str(eth_rpc_only),
        "explorer_sender_changes": {k: str(v) for k, v in explorer_sender.items()} if explorer_sender is not None else None,
        "sender_token_changes": {c: {"raw": str(v), "symbol": meta.get(c, {}).get("symbol"), "amount": fmt(v, meta[c]["decimals"]) if meta.get(c, {}).get("decimals") is not None else None} for c, v in fungible.items() if v},
        "sender_outgoing_transfer_count": {meta.get(c, {}).get("symbol") or c: len(v) for c, v in outgoing_transfers.items()},
        "sender_outgoing_transfers": {meta.get(c, {}).get("symbol") or c: [fmt(x, meta[c]["decimals"]) if meta.get(c, {}).get("decimals") is not None else str(x) for x in v] for c, v in outgoing_transfers.items()},
        "nft_transfers": [{**n, "symbol": meta.get(n["contract"], {}).get("symbol")} for n in nfts],
        "log_count": len(rc["logs"]),
    }


def main():
    global FIX, EVIDENCE
    parser = argparse.ArgumentParser(description="Derive the study answer key from captured recordings.")
    parser.add_argument("--captured", default=os.environ.get("TXSTORY_CAPTURED_DIR"), help="directory of captured recordings")
    parser.add_argument("--evidence", default=os.environ.get("TXSTORY_STUDY_EVIDENCE_DIR"), help="directory holding blockscout-state-changes-0x55696a27.json")
    parser.add_argument("--check", action="store_true", help="compare with study/answer-key.json instead of rewriting it")
    args = parser.parse_args()
    if not args.captured or not pathlib.Path(args.captured).is_dir() or not args.evidence or not pathlib.Path(args.evidence).is_dir():
        print("Captured recordings are not distributed with the repository. Pass --captured DIR and --evidence DIR "
              "(or set TXSTORY_CAPTURED_DIR / TXSTORY_STUDY_EVIDENCE_DIR). See study/README.md.", file=sys.stderr)
        sys.exit(2)
    FIX, EVIDENCE = pathlib.Path(args.captured), pathlib.Path(args.evidence)
    out, problems = [], []
    for task, s, chain, h in TASKS:
        a = analyse(chain, h)
        a.update(task=task, set=s)
        ex = a["explorer_sender_changes"]
        # Cross-validate sender token deltas with the explorer where recorded.
        if ex is not None:
            for c, v in a["sender_token_changes"].items():
                if c in ex and ex[c] != v["raw"]:
                    problems.append(f"{task}{s}: token {c} TxStory-independent {v['raw']} != explorer {ex[c]}")
        out.append(a)
    # T5-Y explorer evidence fetched after indexing.
    ev = json.loads((EVIDENCE / "blockscout-state-changes-0x55696a27.json").read_text())
    t5y = next(x for x in out if x["task"] == "T5" and x["set"] == "Y")
    t5y["explorer_sender_changes_late_fetch"] = {
        "retrievedAt": ev["retrievedAt"],
        "ETH": next(str(i["change"]) for i in ev["body"]["items"] if i["type"] == "coin" and i["address"]["hash"].lower() == t5y["sender"]),
    }
    if t5y["explorer_sender_changes_late_fetch"]["ETH"] != t5y["eth_change_from_rpc_only_wei"]:
        problems.append("T5Y: explorer ETH change differs from value+fee (internal movement?)")
    key_text = json.dumps({"generatedBy": "study/verify_answer_key.py", "tasks": out}, indent=1) + "\n"
    key_path = ROOT / "study" / "answer-key.json"
    if args.check:
        if key_path.read_text() != key_text:
            problems.append("study/answer-key.json differs from the facts derived from the captured recordings")
    else:
        key_path.write_text(key_text)
    for a in out:
        print(f"{a['task']}{a['set']} ok={a['succeeded']} value={a['value_eth']} fee={a['fee_eth']} tokens={ {v['symbol']: v['amount'] for v in a['sender_token_changes'].values()} } outgoing={a['sender_outgoing_transfers']} nfts={[(n['symbol'], n['tokenId'], n['from'][-4:], n['to'][-4:]) for n in a['nft_transfers']]} explorerETH={(a['explorer_sender_changes'] or {}).get('ETH')} rpcETH={a['eth_change_from_rpc_only_wei']}")
    if problems:
        print("PROBLEMS:", *problems, sep="\n  ")
        sys.exit(1)
    print("answer key consistent with explorer evidence where available")


if __name__ == "__main__":
    main()
