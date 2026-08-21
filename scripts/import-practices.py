"""Import the approved Practice Map workbook into the frontend JSON catalogue."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import openpyxl


FIELDS = (
    "id",
    "category",
    "signals",
    "pattern",
    "barrier",
    "resource",
    "need",
    "goal",
    "level",
    "duration",
    "text",
    "restrictions",
    "routes",
    "nextStep",
)


def split_list(value: object) -> list[str]:
    return [item.strip() for item in str(value or "").replace("\n", ";").split(";") if item.strip()]


def split_routes(value: object) -> list[str]:
    return [item.strip() for item in re.split(r"[,;\n]+", str(value or "")) if item.strip()]


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: import-practices.py <source.xlsx> <output.json>")

    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    workbook = openpyxl.load_workbook(source, read_only=False, data_only=True)
    sheet = workbook["Practice Map"]
    practices: list[dict[str, object]] = []

    for row in sheet.iter_rows(min_row=2, values_only=True):
        if not row[0]:
            continue
        practice = dict(zip(FIELDS, row[: len(FIELDS)], strict=True))
        for key in ("signals", "pattern", "barrier", "resource", "need", "restrictions", "routes"):
            practice[key] = split_list(practice[key])
        practice["routes"] = split_routes(row[12])
        for key, value in practice.items():
            if value is None:
                practice[key] = "" if key not in {"signals", "pattern", "barrier", "resource", "need", "restrictions", "routes"} else []
        practices.append(practice)

    ids = [item["id"] for item in practices]
    if len(ids) != len(set(ids)):
        raise ValueError("Practice Map contains duplicate IDs")
    if not practices:
        raise ValueError("Practice Map is empty")

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(practices, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Imported {len(practices)} practices to {target}")


if __name__ == "__main__":
    main()
