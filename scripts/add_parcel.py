#!/usr/bin/env python3
"""Acrescenta um ou mais objetos à lista de seguimento.

Uso:
    python scripts/add_parcel.py RR123456789PT
    python scripts/add_parcel.py RR123456789PT "Encomenda cliente X"
    python scripts/add_parcel.py RR1..PT RR2..PT DW3..PT
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker.store import add_to_tracking_list  # noqa: E402


def main(argv):
    if not argv:
        print("Indica pelo menos um número de objeto.")
        print('Ex.: python scripts/add_parcel.py RR123456789PT "descrição opcional"')
        return 2

    # Se o 2º argumento não parecer um código, trata-o como descrição do 1º.
    codes_and_desc = []
    if len(argv) == 2 and " " in argv[1] or (len(argv) == 2 and not _looks_like_code(argv[1])):
        codes_and_desc = [(argv[0], argv[1])]
    else:
        codes_and_desc = [(c, "") for c in argv]

    added = 0
    for code, desc in codes_and_desc:
        if add_to_tracking_list(code, desc):
            print(f"Adicionado: {code}" + (f" — {desc}" if desc else ""))
            added += 1
        else:
            print(f"Já existia (ignorado): {code}")
    print(f"\n{added} novo(s) objeto(s). Correm na próxima atualização diária.")
    return 0


def _looks_like_code(s: str) -> bool:
    s = s.strip().upper()
    # Códigos CTT: normalmente 2 letras + dígitos + 2 letras (ex.: RR123456789PT)
    # ou sequências alfanuméricas sem espaços.
    return " " not in s and len(s) >= 8 and any(c.isdigit() for c in s)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
