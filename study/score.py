#!/usr/bin/env python3
"""Summarise scored participant CSVs against the pre-registered criteria.

  python3 study/score.py                # reads study/results/P*.csv
  python3 study/score.py --self-test    # checks the scorer on SYNTHETIC rows (in memory only)

Descriptive only: with 5 to 8 participants nothing here is a significance test.
Refuses to report if no scored participant data exists.
"""
import csv
import pathlib
import statistics
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SCORES = {"correct", "partial", "incorrect", "no-answer"}
CODES = {"", "M-OUTCOME", "M-WETH", "M-DIRECTION", "M-PARTIAL-AMOUNT", "M-NFT-ID", "M-HEURISTIC-AS-FACT", "M-INCOMPLETE-AS-EXACT", "M-INVENTED"}


def validate(rows):
    errors = []
    for i, r in enumerate(rows, start=2):
        if r["interface"] not in ("txstory", "explorer"):
            errors.append(f"row {i}: interface {r['interface']!r}")
        if r["score"] and r["score"] not in SCORES:
            errors.append(f"row {i}: score {r['score']!r} not in {sorted(SCORES)}")
        if r["code"] not in CODES:
            errors.append(f"row {i}: unknown code {r['code']!r}")
        if r["time_s"] and not r["time_s"].replace(".", "", 1).isdigit():
            errors.append(f"row {i}: time_s {r['time_s']!r}")
    return errors


def summarise(rows):
    scored = [r for r in rows if r["score"]]
    out = {"participants": sorted({r["participant"] for r in scored}), "by_interface": {}}
    for iface in ("txstory", "explorer"):
        rs = [r for r in scored if r["interface"] == iface]
        if not rs:
            continue
        correct = sum(r["score"] == "correct" for r in rs)
        times = [float(r["time_s"]) for r in rs if r["time_s"]]
        conf = [int(r["confidence"]) for r in rs if r["confidence"].isdigit()]
        codes = {}
        for r in rs:
            if r["code"]:
                codes[r["code"]] = codes.get(r["code"], 0) + 1
        t5q2 = [r for r in rs if r["task"] == "T5" and r["question"] == "Q2"]
        t2q3 = [r for r in rs if r["task"] == "T2" and r["question"] == "Q3"]
        out["by_interface"][iface] = {
            "questions_scored": len(rs),
            "correct_rate": correct / len(rs),
            "partial": sum(r["score"] == "partial" for r in rs),
            "no_answer": sum(r["score"] == "no-answer" for r in rs),
            "median_time_s": statistics.median(times) if times else None,
            "median_confidence": statistics.median(conf) if conf else None,
            "misunderstandings": codes,
            "t5_noticed_rate": (sum(r["score"] == "correct" for r in t5q2) / len(t5q2)) if t5q2 else None,
            "t2_q3_rate": (sum(r["score"] == "correct" for r in t2q3) / len(t2q3)) if t2q3 else None,
            "assisted": sum(r["assisted"].lower() == "yes" for r in rs),
        }
    # Criterion 2: the same critical misunderstanding on the same TxStory question by >1 participant.
    seen = {}
    for r in scored:
        if r["interface"] == "txstory" and r["code"]:
            key = (r["task"], r["question"], r["code"])
            seen.setdefault(key, set()).add(r["participant"])
    out["repeated_txstory_misunderstandings"] = {f"{k[0]}{k[1]} {k[2]}": len(v) for k, v in seen.items() if len(v) > 1}
    return out


def verdict(s):
    t, e = s["by_interface"].get("txstory"), s["by_interface"].get("explorer")
    if not t or not e:
        return "insufficient data"
    c1 = t["correct_rate"] >= e["correct_rate"] - 0.05
    c2 = not s["repeated_txstory_misunderstandings"]
    c3 = t["t5_noticed_rate"] is not None and t["t5_noticed_rate"] >= 0.75
    c4 = t["t2_q3_rate"] is not None and t["t2_q3_rate"] >= 0.75
    c5 = (t["median_time_s"] or 0) <= 1.5 * (e["median_time_s"] or 0) if e["median_time_s"] else None
    lines = [f"C1 accuracy within 5 pts: {c1}", f"C2 no repeated TxStory misunderstanding: {c2}",
             f"C3 T5 incomplete data noticed ≥75%: {c3}", f"C4 T2 Q3 interpretation identified ≥75%: {c4}",
             f"C5 median time ≤1.5× explorer: {c5}"]
    if not c2 or t["correct_rate"] < e["correct_rate"] - 0.05:
        overall = "HARMED on these tasks (exploratory)"
    elif c1 and c2 and c3 and c4:
        overall = "HELPED on these tasks (exploratory)"
    else:
        overall = "INCONCLUSIVE (exploratory)"
    return "\n".join(lines + [f"Overall: {overall}. n={len(s['participants'])}; not statistically representative."])


def load():
    rows = []
    for f in sorted((ROOT / "results").glob("P*.csv")):
        with f.open(newline="") as fh:
            rows += list(csv.DictReader(fh))
    return rows


def self_test():
    # SYNTHETIC rows, never written to disk, only to check the arithmetic and verdict logic.
    def row(p, iface, task, q, score, code="", t="30", conf="4"):
        return {"participant": p, "interface": iface, "task": task, "question": q, "score": score, "code": code,
                "time_s": t, "confidence": conf, "assisted": "no"}
    rows = [row("S1", "txstory", "T5", "Q2", "correct"), row("S1", "explorer", "T5", "Q2", "correct"),
            row("S1", "txstory", "T2", "Q3", "correct"), row("S1", "explorer", "T2", "Q3", "incorrect"),
            row("S2", "txstory", "T5", "Q2", "incorrect", "M-INCOMPLETE-AS-EXACT"), row("S2", "explorer", "T1", "Q1", "correct"),
            row("S3", "txstory", "T5", "Q2", "incorrect", "M-INCOMPLETE-AS-EXACT")]
    s = summarise(rows)
    assert s["participants"] == ["S1", "S2", "S3"]
    assert abs(s["by_interface"]["txstory"]["correct_rate"] - 2 / 4) < 1e-9
    assert s["repeated_txstory_misunderstandings"] == {"T5Q2 M-INCOMPLETE-AS-EXACT": 2}
    assert verdict(s).splitlines()[-1].startswith("Overall: HARMED")
    assert validate([{**rows[0], "score": "great"}])
    print("score.py self-test passed (synthetic data only)")


def main():
    if "--self-test" in sys.argv:
        self_test()
        return
    rows = load()
    errors = validate(rows)
    if errors:
        print("Invalid results:", *errors[:20], sep="\n  ")
        sys.exit(2)
    if not any(r["score"] for r in rows):
        print("No scored participant data in study/results/. Human usability remains unmeasured.")
        sys.exit(1)
    s = summarise(rows)
    for iface, v in s["by_interface"].items():
        print(iface, v)
    print("Repeated TxStory misunderstandings:", s["repeated_txstory_misunderstandings"] or "none")
    print(verdict(s))


if __name__ == "__main__":
    main()
