"""Job diário: lê a lista de objetos, consulta os CTT e atualiza a DB.

Uso:
    python -m tracker.update                 # corre tudo (usado no GitHub Actions)
    python -m tracker.update --method http   # força estratégia HTTP
    python -m tracker.update --only RR123..PT # atualiza só um código
    python -m tracker.update --dry-run       # não grava (para testar)
"""

from __future__ import annotations

import argparse
import sys
import time
from typing import Dict, List

from .ctt import fetch_status
from .models import Parcel, CATEGORY_LABELS, utcnow_iso
from .store import read_tracking_list, load_parcels, save_parcels


def build_parcel_index(parcels: List[Parcel]) -> Dict[str, Parcel]:
    return {p.code: p for p in parcels}


def run(method: str = "auto", only: str = "", dry_run: bool = False,
        pause: float = 1.5) -> int:
    wanted = read_tracking_list()
    if only:
        only_u = only.strip().upper()
        wanted = [(c, d) for (c, d) in wanted if c == only_u]
        if not wanted:
            wanted = [(only_u, "")]

    if not wanted:
        print("Nada para seguir: data/tracking_numbers.txt está vazio.")
        # Ainda assim regrava a DB (para não deixar docs/data.json em falta).
        if not dry_run:
            save_parcels(load_parcels())
        return 0

    existing = build_parcel_index(load_parcels())
    results: List[Parcel] = []
    ok = 0
    failed = 0

    print(f"A atualizar {len(wanted)} objeto(s) via método '{method}'...\n")
    for code, desc in wanted:
        parcel = existing.get(code) or Parcel(code=code, added_at=utcnow_iso())
        if desc:
            parcel.description = desc
        prev_category = parcel.status_category

        try:
            events = fetch_status(code, method=method)
            parcel.apply_events(events)
            change = " *** MUDOU ***" if parcel.status_category != prev_category else ""
            flag = ""
            if parcel.returned:
                flag = "  [DEVOLVIDO]"
            elif parcel.delivered:
                flag = "  [ENTREGUE]"
            print(f"  {code}: {CATEGORY_LABELS.get(parcel.status_category)}"
                  f" — {parcel.status_text[:60]}{flag}{change}")
            ok += 1
        except Exception as exc:  # noqa: BLE001
            parcel.error = str(exc)
            parcel.last_checked = utcnow_iso()
            print(f"  {code}: ERRO — {exc}")
            failed += 1

        results.append(parcel)
        time.sleep(pause)  # ser simpático com o site dos CTT

    # Mantém na DB objetos que já não estão na lista (histórico), no fim.
    tracked_codes = {c for c, _ in wanted}
    for code, parcel in existing.items():
        if code not in tracked_codes:
            results.append(parcel)

    print(f"\nConcluído: {ok} ok, {failed} com erro.")

    if dry_run:
        print("(dry-run: nada gravado)")
    else:
        save_parcels(results)
        print("DB e dashboard atualizados (data/parcels.json, docs/data.json).")

    return 0 if failed == 0 else 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Atualiza estados de objetos CTT.")
    parser.add_argument("--method", default="auto",
                        choices=["auto", "playwright", "http"])
    parser.add_argument("--only", default="", help="Atualiza só este código.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--pause", type=float, default=1.5,
                        help="Pausa (s) entre pedidos.")
    args = parser.parse_args(argv)
    return run(method=args.method, only=args.only, dry_run=args.dry_run,
               pause=args.pause)


if __name__ == "__main__":
    sys.exit(main())
