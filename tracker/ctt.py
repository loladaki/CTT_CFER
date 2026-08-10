"""Extrator do estado de objetos no site dos CTT.

Estratégia (por ordem de robustez):

1. Playwright (browser headless) — abre o site de rastreio dos CTT, pesquisa
   o código e **interceta as respostas XHR/JSON** que o próprio frontend dos
   CTT usa para desenhar a timeline. Ler o JSON da API interna é muito mais
   estável do que raspar HTML com seletores, que mudam a cada redesenho.
   Se não apanhar JSON, cai para ler o texto renderizado da página.

2. HTTP direto (fallback) — tenta um endpoint público conhecido dos CTT sem
   browser. Mais leve, mas mais sujeito a mudar/deixar de existir.

Nota importante: este ficheiro concentra TODO o conhecimento sobre o site dos
CTT. Se algum dia mudarem o site, é só aqui que se mexe. As variáveis de
ambiente permitem afinar sem alterar código:

    CTT_TRACKING_ENTRY_URL   página de entrada do rastreio (default abaixo)
    CTT_TRACKING_DIRECT_URL  URL direto com '{code}' (opcional, tentado 1º)
    CTT_DEBUG=1              grava HTML/JSON em debug/ para diagnóstico
    CTT_HEADFUL=1           corre o browser com janela (só local)
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import List, Optional

from .models import Event

DEFAULT_ENTRY_URL = "https://www.ctt.pt/particulares/index"
DEBUG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "debug")

# Chaves que costumam identificar campos de data/estado/local em JSONs de
# tracking. Usadas para reconhecer eventos dentro de qualquer estrutura JSON.
_DATE_KEYS = ["datetime", "date", "data", "dataHora", "dataEvento", "timestamp", "eventDate"]
_STATUS_KEYS = ["status", "estado", "descricao", "description", "evento", "event", "state", "text"]
_LOCATION_KEYS = ["location", "local", "localizacao", "office", "centro", "place", "city"]


def _debug_enabled() -> bool:
    return os.environ.get("CTT_DEBUG", "") not in ("", "0", "false", "False")


def _write_debug(code: str, name: str, content: str) -> None:
    if not _debug_enabled():
        return
    os.makedirs(DEBUG_DIR, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", f"{code}_{name}")
    path = os.path.join(DEBUG_DIR, safe)
    try:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
    except OSError:
        pass


def _pick(d: dict, keys: List[str]) -> str:
    for k in d.keys():
        kl = k.lower()
        for want in keys:
            if kl == want.lower():
                val = d[k]
                if isinstance(val, (str, int, float)):
                    return str(val).strip()
    return ""


def _looks_like_event(d: dict) -> bool:
    has_date = bool(_pick(d, _DATE_KEYS))
    has_status = bool(_pick(d, _STATUS_KEYS))
    return has_status and (has_date or _pick(d, _LOCATION_KEYS))


def _events_from_json(data, code: str) -> List[Event]:
    """Procura recursivamente listas de objetos que pareçam eventos."""
    best: List[Event] = []

    def walk(node):
        nonlocal best
        if isinstance(node, list):
            events = [x for x in node if isinstance(x, dict) and _looks_like_event(x)]
            if len(events) > len(best):
                best = [
                    Event(
                        datetime=_pick(e, _DATE_KEYS),
                        status=_pick(e, _STATUS_KEYS),
                        location=_pick(e, _LOCATION_KEYS),
                        extra="",
                    )
                    for e in events
                ]
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)

    walk(data)
    return best


def _order_newest_first(events: List[Event]) -> List[Event]:
    """Tenta ordenar do mais recente para o mais antigo por data (dd/mm/aaaa)."""
    def key(ev: Event):
        m = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](\d{2,4}).*?(\d{1,2}):(\d{2})", ev.datetime)
        if not m:
            m2 = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})", ev.datetime)
            if not m2:
                return (0,)
            d, mo, y = m2.groups()
            return (int(y) if len(y) == 4 else 2000 + int(y), int(mo), int(d), 0, 0)
        d, mo, y, hh, mm = m.groups()
        return (int(y) if len(y) == 4 else 2000 + int(y), int(mo), int(d), int(hh), int(mm))

    try:
        ordered = sorted(events, key=key, reverse=True)
        # Se a ordenação por data não distinguiu nada, mantém a ordem original.
        return ordered
    except Exception:
        return events


# --------------------------------------------------------------------------
# Estratégia 1: Playwright
# --------------------------------------------------------------------------

def fetch_playwright(code: str, timeout_ms: int = 30000) -> List[Event]:
    from playwright.sync_api import sync_playwright  # import tardio: só quando usado

    captured_json: List[dict] = []
    events: List[Event] = []

    entry = os.environ.get("CTT_TRACKING_ENTRY_URL", DEFAULT_ENTRY_URL)
    direct = os.environ.get("CTT_TRACKING_DIRECT_URL", "")
    headful = os.environ.get("CTT_HEADFUL", "") not in ("", "0", "false", "False")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headful)
        context = browser.new_context(
            locale="pt-PT",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
        )
        page = context.new_page()

        def on_response(resp):
            try:
                ct = (resp.headers or {}).get("content-type", "")
                if "json" not in ct.lower():
                    return
                body = resp.json()
                captured_json.append(body)
            except Exception:
                return

        page.on("response", on_response)

        try:
            if direct:
                page.goto(direct.replace("{code}", code), timeout=timeout_ms,
                          wait_until="domcontentloaded")
            else:
                page.goto(entry, timeout=timeout_ms, wait_until="domcontentloaded")
                _try_search_box(page, code)

            # Dá tempo às chamadas XHR de tracking para completarem.
            try:
                page.wait_for_load_state("networkidle", timeout=timeout_ms)
            except Exception:
                pass
            time.sleep(2)

            # 1) tenta apanhar dos JSONs intercetados
            for body in captured_json:
                ev = _events_from_json(body, code)
                if len(ev) > len(events):
                    events = ev

            if _debug_enabled():
                _write_debug(code, "page.html", page.content())
                _write_debug(code, "captured.json",
                             json.dumps(captured_json, ensure_ascii=False, indent=2)[:500000])
                try:
                    page.screenshot(path=os.path.join(DEBUG_DIR, f"{code}.png"), full_page=True)
                except Exception:
                    pass

            # 2) fallback: ler texto renderizado
            if not events:
                events = _events_from_text(page.inner_text("body"))
        finally:
            context.close()
            browser.close()

    return _order_newest_first(events)


def _try_search_box(page, code: str) -> None:
    """Tenta localizar a caixa de pesquisa de objetos e submeter o código."""
    selectors = [
        "input[name*='object' i]",
        "input[id*='object' i]",
        "input[placeholder*='objeto' i]",
        "input[placeholder*='rastre' i]",
        "input[placeholder*='track' i]",
        "input[aria-label*='objeto' i]",
        "input[type='search']",
    ]
    for sel in selectors:
        try:
            el = page.query_selector(sel)
            if el:
                el.click()
                el.fill(code)
                el.press("Enter")
                return
        except Exception:
            continue
    # Se não encontrou, tenta clicar num botão/link de "rastrear" primeiro.
    for text in ["Rastrear", "Seguir", "Localizar", "Procurar", "Pesquisar"]:
        try:
            page.get_by_text(text, exact=False).first.click(timeout=2000)
            for sel in selectors:
                el = page.query_selector(sel)
                if el:
                    el.fill(code)
                    el.press("Enter")
                    return
        except Exception:
            continue


# --------------------------------------------------------------------------
# Estratégia 2: HTTP direto (fallback, sem browser)
# --------------------------------------------------------------------------

_LEGACY_URL = (
    "https://www.ctt.pt/feapl_2/app/open/objectSearch/objectSearch.jspx"
    "?request_locale=pt&objects={code}&showResults=true"
)


def fetch_http(code: str, timeout: int = 25) -> List[Event]:
    import requests

    url = os.environ.get("CTT_HTTP_URL", _LEGACY_URL).replace("{code}", code)
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; CTT-CFER/1.0)",
        "Accept-Language": "pt-PT,pt;q=0.9",
    }
    resp = requests.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()
    text = resp.text
    _write_debug(code, "http.html", text)

    # Tenta JSON primeiro; senão, parse do texto/HTML.
    try:
        return _order_newest_first(_events_from_json(json.loads(text), code))
    except Exception:
        pass
    return _order_newest_first(_events_from_text(_strip_html(text)))


def _strip_html(html: str) -> str:
    html = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    html = re.sub(r"<style[\s\S]*?</style>", " ", html, flags=re.I)
    html = re.sub(r"<[^>]+>", "\n", html)
    html = re.sub(r"&nbsp;", " ", html)
    return re.sub(r"[ \t]+", " ", html)


def _events_from_text(text: str) -> List[Event]:
    """Heurística: apanha linhas com data + descrição no texto renderizado."""
    events: List[Event] = []
    date_re = re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b(?:\s+\d{1,2}:\d{2})?")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for i, line in enumerate(lines):
        m = date_re.search(line)
        if not m:
            continue
        when = m.group(0)
        # A descrição costuma estar na mesma linha (a seguir à data) ou na próxima.
        rest = line.replace(when, "").strip(" -–—|,;")
        status = rest
        if len(status) < 3 and i + 1 < len(lines):
            status = lines[i + 1].strip()
        if status:
            events.append(Event(datetime=when, status=status, location="", extra=""))
    return events


# --------------------------------------------------------------------------
# API pública do módulo
# --------------------------------------------------------------------------

def fetch_status(code: str, method: str = "auto") -> List[Event]:
    """Devolve a lista de eventos (mais recente primeiro) para um código.

    method: 'auto' (playwright e depois http), 'playwright' ou 'http'.
    Lança exceção se nenhuma estratégia conseguir obter dados.
    """
    errors = []
    order = {
        "auto": ["playwright", "http"],
        "playwright": ["playwright"],
        "http": ["http"],
    }.get(method, ["playwright", "http"])

    for strat in order:
        try:
            if strat == "playwright":
                events = fetch_playwright(code)
            else:
                events = fetch_http(code)
            if events:
                return events
            errors.append(f"{strat}: sem eventos")
        except Exception as exc:  # noqa: BLE001 — queremos tentar a próxima estratégia
            errors.append(f"{strat}: {exc}")

    raise RuntimeError("; ".join(errors) or "sem dados")
