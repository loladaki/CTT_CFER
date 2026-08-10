# CTT_CFER — Seguimento automático de encomendas CTT

Dashboard + robô que consulta **todos os dias** o estado das encomendas dos
CTT e o mostra num painel, destacando **entregues** e, sobretudo,
**devoluções** — para deixarem de andar a verificar à mão.

## Como funciona

```
data/tracking_numbers.txt   →  lista do que seguir (editável por vocês)
        │
        ▼
tracker/  (Python)          →  robô que vai aos CTT buscar o estado
        │                      (corre no GitHub Actions, 1x/dia)
        ▼
data/parcels.json           →  base de dados (estado + histórico, versionada no git)
docs/data.json              →  cópia lida pelo dashboard
        │
        ▼
docs/index.html             →  dashboard (GitHub Pages)
```

Três peças:

1. **Robô (`tracker/`)** — abre o site dos CTT com um browser automático
   (Playwright) e **interceta o JSON interno** que o próprio site usa para
   desenhar a timeline (mais robusto do que raspar HTML). Tem fallback por
   HTTP direto. Classifica cada estado em categorias estáveis
   (`entregue`, `devolvido`, `em trânsito`, `problema`, etc.).
2. **Base de dados (`data/`)** — ficheiros JSON commitados no repositório.
   Vantagem: o histórico de mudanças de estado fica no próprio `git log`.
3. **Dashboard (`docs/`)** — página estática com KPIs, pesquisa, filtros por
   estado, histórico por encomenda e destaque a vermelho para devoluções.

## Pôr a funcionar (uma vez)

1. **Ativar o GitHub Pages:** repositório → *Settings* → *Pages* →
   *Build and deployment* → *Deploy from a branch* → escolher o branch e a
   pasta **`/docs`**. O dashboard fica em
   `https://<utilizador>.github.io/<repo>/`.
2. **Permissões das Actions:** *Settings* → *Actions* → *General* →
   *Workflow permissions* → **Read and write permissions** (para o robô poder
   gravar as atualizações de estado no repo).
3. Pronto. O robô corre sozinho todos os dias (ver `cron` em
   `.github/workflows/daily-update.yml`).

## Adicionar encomendas

Três formas (qualquer uma serve):

- **Editar o ficheiro** `data/tracking_numbers.txt` (um número por linha;
  descrição opcional a seguir a `;`) e fazer commit.
- **Pela interface do GitHub:** *Actions* → *Adicionar encomenda* →
  *Run workflow* → escrever o(s) número(s).
- **Localmente:** `python scripts/add_parcel.py RR123456789PT "descrição"`

## Correr / testar localmente

```bash
pip install -r requirements.txt
python -m playwright install chromium

# atualizar tudo
python -m tracker.update

# opções úteis
python -m tracker.update --only RR123456789PT     # só um objeto
python -m tracker.update --method http            # sem browser
python -m tracker.update --dry-run                # não grava
CTT_DEBUG=1 python -m tracker.update --only RR..PT # guarda dumps em debug/

# ver o dashboard
cd docs && python -m http.server 8000   # abre http://localhost:8000
```

## Afinação do extrator (importante)

Como o site dos CTT muda de tempos a tempos, **todo o conhecimento do site
está isolado em `tracker/ctt.py`**. Se um dia parar de apanhar estados:

1. Corre a *Atualização diária* com `CTT_DEBUG=1` (já ativado no workflow) —
   isso guarda em `debug/` o HTML, os JSON intercetados e um screenshot, que
   ficam disponíveis como **artefacto** da execução do GitHub Actions.
2. Ajusta, se preciso, as variáveis de ambiente (sem tocar no código):
   - `CTT_TRACKING_ENTRY_URL` — página de entrada do rastreio.
   - `CTT_TRACKING_DIRECT_URL` — URL direto com `{code}`.
   - `CTT_HTTP_URL` — endpoint do fallback HTTP.

> Nota: o número de cliente/contrato dos CTT não é preciso para o rastreio
> público (basta o nº de objeto). Se no futuro obtiverem credenciais de
> **webservice oficial CTT**, a fonte de dados troca-se só em `tracker/ctt.py`,
> ficando tudo o resto igual — e muito mais fiável.

## Categorias de estado

| Categoria | Significado | No dashboard |
|-----------|-------------|--------------|
| `delivered` | Entregue | verde |
| `returned` | **Devolvido ao remetente** | vermelho (alerta) |
| `out_for_delivery` | Em distribuição | roxo |
| `in_transit` | Em trânsito / expedido | azul |
| `awaiting_pickup` | Disponível para levantamento | amarelo |
| `problem` | Tentativa falhada / morada / ausente | laranja |
| `registered` | Registado / aceite | cinzento |
| `unknown` | Não classificado | cinzento |

## Estrutura do projeto

```
tracker/
  models.py     estruturas de dados + classificação de estados
  store.py      leitura/escrita dos ficheiros JSON e da lista
  ctt.py        recolha do estado nos CTT (Playwright + HTTP)
  update.py     job diário (orquestra tudo)
scripts/
  add_parcel.py adicionar objetos por linha de comando
data/
  tracking_numbers.txt   lista do que seguir (editável)
  parcels.json           base de dados (gerada)
docs/
  index.html / app.js / style.css   dashboard
  data.json                         dados consumidos pelo dashboard
.github/workflows/
  daily-update.yml   agendamento diário + execução manual
  add-parcel.yml     adicionar encomenda pela interface
```
