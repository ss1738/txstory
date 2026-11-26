#!/usr/bin/env python3
"""Generate counterbalanced session sheets and pre-filled result CSVs.

  python3 study/make_session_sheets.py 8        # participants P01..P08

Writes study/sessions/P0N.md (link order for the facilitator) and
study/results/P0N.csv (one row per question, answers blank). The results
folder is git-ignored. Existing result files are never overwritten.
"""
import csv
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
KEY = json.loads((ROOT / "answer-key.json").read_text())
TX = {(t["task"], t["set"]): t["hash"] for t in KEY["tasks"]}
QUESTIONS = {"T1": 3, "T2": 3, "T3": 3, "T4": 3, "T5": 2}
CONDITIONS = {
    "A": [("txstory", "X"), ("explorer", "Y")],
    "B": [("explorer", "Y"), ("txstory", "X")],
    "C": [("txstory", "Y"), ("explorer", "X")],
    "D": [("explorer", "X"), ("txstory", "Y")],
}
ORDER = ["A", "B", "C", "D"]
COLUMNS = ["participant", "condition", "familiarity", "block", "interface", "task", "set", "question",
           "answer", "score", "code", "time_s", "confidence", "assisted", "comment"]
TXSTORY_BASE = "http://127.0.0.1:8787/example/ethereum/"
EXPLORER_BASE = "https://eth.blockscout.com/tx/"


def link(interface, h):
    return (TXSTORY_BASE if interface == "txstory" else EXPLORER_BASE) + h


def main(n):
    (ROOT / "sessions").mkdir(exist_ok=True)
    (ROOT / "results").mkdir(exist_ok=True)
    for i in range(1, n + 1):
        pid = f"P{i:02d}"
        cond = ORDER[(i - 1) % 4]
        lines = [f"# Session sheet {pid}: condition {cond}", "",
                 "Read questions from TASKS.md. Do not show this sheet to the participant.", ""]
        rows = []
        for b, (iface, s) in enumerate(CONDITIONS[cond], start=1):
            lines += [f"## Block {b}: {'TxStory' if iface == 'txstory' else 'Explorer (eth.blockscout.com)'}, set {s}", ""]
            for task in ["T1", "T2", "T3", "T4", "T5"]:
                lines.append(f"- **{task}**: {link(iface, TX[(task, s)])}")
                for q in range(1, QUESTIONS[task] + 1):
                    rows.append({"participant": pid, "condition": cond, "familiarity": "", "block": b, "interface": iface,
                                 "task": task, "set": s, "question": f"Q{q}", "answer": "", "score": "", "code": "",
                                 "time_s": "", "confidence": "", "assisted": "", "comment": ""})
            lines.append("")
        (ROOT / "sessions" / f"{pid}.md").write_text("\n".join(lines))
        out = ROOT / "results" / f"{pid}.csv"
        if out.exists():
            print(f"{out} exists; not overwritten")
            continue
        with out.open("w", newline="") as f:
            w = csv.DictWriter(f, COLUMNS)
            w.writeheader()
            w.writerows(rows)
        print(f"wrote sessions/{pid}.md and results/{pid}.csv (condition {cond}, {len(rows)} questions)")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8)
