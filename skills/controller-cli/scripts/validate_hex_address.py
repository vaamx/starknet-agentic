#!/usr/bin/env python3
from __future__ import annotations

import re
import sys


HEX_ADDRESS = re.compile(r"^0x[0-9a-fA-F]+$")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: validate_hex_address.py <0x...> [more...]", file=sys.stderr)
        return 2

    bad = 0
    for s in argv[1:]:
        if HEX_ADDRESS.match(s):
            continue
        print(f"invalid hex address: {s}", file=sys.stderr)
        bad = 1
    return bad


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

