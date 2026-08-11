"""Modelos de dados e normalização de estados dos objetos CTT.

Este módulo não faz pedidos à rede: só define as estruturas de dados e a
lógica que traduz o texto livre dos CTT para categorias estáveis que o
dashboard consegue mostrar com cores e alertas.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional


# Categorias de estado que o dashboard conhece. A ordem serve também para
# ordenar por "urgência" no painel.
CATEGORY_UNKNOWN = "unknown"
CATEGORY_REGISTERED = "registered"        # Objeto aceite / registado
CATEGORY_IN_TRANSIT = "in_transit"        # Em trânsito / expedido
CATEGORY_OUT_FOR_DELIVERY = "out_for_delivery"  # Em distribuição
CATEGORY_AWAITING_PICKUP = "awaiting_pickup"    # Disponível para levantamento
CATEGORY_PROBLEM = "problem"              # Tentativa falhada / morada errada
CATEGORY_RETURNED = "returned"            # Devolvido ao remetente
CATEGORY_DELIVERED = "delivered"          # Entregue

# Rótulos legíveis (PT) para cada categoria.
CATEGORY_LABELS = {
    CATEGORY_UNKNOWN: "Desconhecido",
    CATEGORY_REGISTERED: "Registado",
    CATEGORY_IN_TRANSIT: "Em trânsito",
    CATEGORY_OUT_FOR_DELIVERY: "Em distribuição",
    CATEGORY_AWAITING_PICKUP: "Aguarda levantamento",
    CATEGORY_PROBLEM: "Problema na entrega",
    CATEGORY_RETURNED: "Devolvido",
    CATEGORY_DELIVERED: "Entregue",
}

# Palavras-chave (já sem acentos, minúsculas) mapeadas para categorias.
# A ordem de avaliação é importante: "devolvido" tem de ganhar a "entregue"
# porque uma devolução também acaba por ser "entregue ao remetente".
_KEYWORD_RULES = [
    (CATEGORY_RETURNED, [
        "devolv",              # devolvido / devolução / em devolucao
        "return",              # return to sender
        "remetente",           # entregue ao remetente
        "reexpedido para origem",
    ]),
    (CATEGORY_DELIVERED, [
        "entregue",
        "entrega efetuada",
        "entrega realizada",
        "delivered",
        "objeto entregue",
    ]),
    (CATEGORY_AWAITING_PICKUP, [
        "disponivel para levantamento",
        "levantamento",
        "aguarda levantamento",
        "ponto ctt",
        "loja ctt",
        "cacifo",
        "locker",
    ]),
    (CATEGORY_PROBLEM, [
        "tentativa de entrega",
        "nao foi possivel entregar",
        "morada",
        "endereco insuficiente",
        "destinatario ausente",
        "ausente",
        "insucesso",
        "extraviado",
        "danificado",
    ]),
    (CATEGORY_OUT_FOR_DELIVERY, [
        "em distribuicao",
        "saiu para entrega",
        "out for delivery",
        "em entrega",
    ]),
    (CATEGORY_IN_TRANSIT, [
        "em transito",
        "expedido",
        "encaminhado",
        "aceite",
        "em transporte",
        "chegada ao centro",
        "saida do centro",
        "in transit",
    ]),
    (CATEGORY_REGISTERED, [
        "registado",
        "objeto registado",
        "aceitacao",
        "recebido",
        "criado",
        "pre-registado",
    ]),
]


def _strip_accents(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def normalize_text(text: str) -> str:
    """Minúsculas, sem acentos e sem espaços a mais — para casar keywords."""
    text = _strip_accents(text or "").lower()
    return re.sub(r"\s+", " ", text).strip()


def categorize(status_text: str) -> str:
    """Traduz uma descrição de estado dos CTT para uma categoria estável."""
    norm = normalize_text(status_text)
    if not norm:
        return CATEGORY_UNKNOWN
    for category, keywords in _KEYWORD_RULES:
        for kw in keywords:
            if kw in norm:
                return category
    return CATEGORY_UNKNOWN


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class Event:
    """Um evento na vida do objeto (uma linha do histórico dos CTT)."""
    datetime: str = ""      # data/hora tal como vem dos CTT (string)
    status: str = ""        # descrição do estado
    location: str = ""      # local / centro operacional
    extra: str = ""         # informação adicional, quando existe

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Parcel:
    """Estado atual + histórico de um objeto/encomenda."""
    code: str
    description: str = ""
    status_category: str = CATEGORY_UNKNOWN
    status_text: str = ""
    last_event: Optional[dict] = None
    history: list = field(default_factory=list)
    last_checked: str = ""
    delivered: bool = False
    returned: bool = False
    error: Optional[str] = None
    added_at: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "Parcel":
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in data.items() if k in known})

    def apply_events(self, events: list["Event"]) -> None:
        """Atualiza o estado do objeto a partir da lista de eventos.

        Os CTT devolvem normalmente os eventos do mais recente para o mais
        antigo. Guardamos o histórico completo e usamos o evento mais recente
        para determinar a categoria atual.
        """
        self.history = [e.to_dict() if isinstance(e, Event) else e for e in events]
        if not events:
            self.status_category = CATEGORY_UNKNOWN
            self.status_text = ""
            self.last_event = None
        else:
            latest = events[0]
            if isinstance(latest, dict):
                latest = Event(**{k: latest.get(k, "") for k in Event.__dataclass_fields__})  # type: ignore[attr-defined]
            self.last_event = latest.to_dict()
            self.status_text = latest.status
            self.status_category = categorize(latest.status)
        self.delivered = self.status_category == CATEGORY_DELIVERED
        self.returned = self.status_category == CATEGORY_RETURNED
        self.last_checked = utcnow_iso()
        self.error = None
