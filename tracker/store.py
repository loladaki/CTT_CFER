"""Leitura/escrita da "base de dados" (ficheiros JSON no repositório).

Optámos por JSON commitado no repo em vez de uma base de dados a sério
porque tudo corre em GitHub Actions: é simples, versionado (dá para ver o
histórico de mudanças de estado no próprio git) e o dashboard estático
consegue ler o ficheiro diretamente.

Fontes de dados:
  - data/tracking_numbers.txt : lista editável do que queremos seguir
                                (um código por linha; `codigo; descrição`).
  - data/parcels.json         : estado + histórico de cada objeto (gerado).
  - docs/data.json            : cópia pública consumida pelo dashboard.
"""

from __future__ import annotations

import json
import os
from typing import List, Tuple

from .models import Parcel, utcnow_iso

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKING_LIST = os.path.join(ROOT, "data", "tracking_numbers.txt")
PARCELS_DB = os.path.join(ROOT, "data", "parcels.json")
PUBLIC_DATA = os.path.join(ROOT, "docs", "data.json")


def read_tracking_list() -> List[Tuple[str, str]]:
    """Lê data/tracking_numbers.txt.

    Formato por linha (flexível):
        RR123456789PT
        RR123456789PT ; Encomenda para cliente X
        RR123456789PT , Fornecedor Y
    Linhas vazias e a começar por '#' são ignoradas.
    Devolve lista de (codigo, descricao).
    """
    entries: List[Tuple[str, str]] = []
    if not os.path.exists(TRACKING_LIST):
        return entries
    seen = set()
    with open(TRACKING_LIST, "r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            # aceita ';' ',' ou tab como separador entre código e descrição
            for sep in (";", "\t", ","):
                if sep in line:
                    code, desc = line.split(sep, 1)
                    break
            else:
                code, desc = line, ""
            code = code.strip().upper()
            desc = desc.strip()
            if not code or code in seen:
                continue
            seen.add(code)
            entries.append((code, desc))
    return entries


def load_parcels() -> List[Parcel]:
    if not os.path.exists(PARCELS_DB):
        return []
    with open(PARCELS_DB, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    return [Parcel.from_dict(p) for p in data.get("parcels", [])]


def _dump(path: str, parcels: List[Parcel]) -> None:
    payload = {
        "generated_at": utcnow_iso(),
        "count": len(parcels),
        "parcels": [p.to_dict() for p in parcels],
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def save_parcels(parcels: List[Parcel]) -> None:
    """Grava a DB e a cópia pública para o dashboard."""
    _dump(PARCELS_DB, parcels)
    _dump(PUBLIC_DATA, parcels)


def add_to_tracking_list(code: str, description: str = "") -> bool:
    """Acrescenta um código à lista de seguimento. Devolve False se já existia."""
    code = code.strip().upper()
    if not code:
        return False
    existing = {c for c, _ in read_tracking_list()}
    if code in existing:
        return False
    os.makedirs(os.path.dirname(TRACKING_LIST), exist_ok=True)
    line = code if not description else f"{code} ; {description.strip()}"
    with open(TRACKING_LIST, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    return True
