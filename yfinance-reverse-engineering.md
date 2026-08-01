# Yahoo Finance Platform — Engenharia Reversa Completa

> Documento técnico de referência que mapeia a arquitetura, protocolos e
> comportamentos do sistema Yahoo Finance, abrangendo o *frontend* JavaScript
> (bundles minificados) e o *backend* Python (biblioteca yfinance v1.5.2).
> A análise cobre schemas Protobuf, WebSocket streaming, autenticação,
> endpoints REST, portfolio worker, search/screener e o módulo de histórico.
> v4.0 (Final) | 2026-07-24 | Alvos: yfinance 1.5.2 + Yahoo Finance JS bundles (Jul 2026)

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Artefatos analisados](#2-artefatos-analisados)
3. [Backend Python (yfinance)](#3-backend-python-yfinance)
4. [Frontend JavaScript (Yahoo Finance Web)](#4-frontend-javascript-yahoo-finance-web)
5. [Fluxos End-to-End](#5-fluxos-end-to-end)
6. [Mapa Completo da Arquitetura](#6-mapa-completo-da-arquitetura)
7. [Protocol Map (Protobuf)](#7-protocol-map-protobuf)
8. [Glossário](#8-glossário)
9. [Gap Analysis: Backend vs. Frontend](#9-gap-analysis-backend-vs-frontend)
10. [Riscos e considerações](#10-riscos-e-considerações)
11. [Apêndices](#11-apêndices)
12. [Análise Comparativa: yahoo-finance2](#12-análise-comparativa-yahoo-finance2-typescript)
13. [Validação Empírica: Página Real de Cotação (INTC)](#13-validação-empírica-página-real-de-cotação-intc)

---

## 1. Visão geral

### 1.1 Objetivo da investigação

Revelar a arquitetura completa do sistema Yahoo Finance — como os dados fluem
do servidor para o browser (frontend JS) e como a biblioteca yfinance (Python)
os consome programaticamente. O foco está nos:
- Schemas de dados (Protobuf, JSON)
- Protocolos de comunicação (REST, WebSocket)
- Mecanismos de autenticação (cookie/crumb, login tiers)
- Componentes de frontend (streaming, portfolio, search)
- Mapeamento de equivalência backend ↔ frontend

### 1.2 Metodologia usada

- **Análise estática**: leitura completa dos bundles JS minificados e do código
  fonte Python do yfinance.
- **Comparação com referência**: yfinance (open-source) como implementação de
  referência para validar os schemas e endpoints descobertos nos bundles JS.
- **Análise de dependências**: mapeamento de variáveis de ambiente, cookies,
  singletons e estado global que afetam o comportamento.
- **Análise diferencial**: comparação entre a implementação Python (yfinance)
  e a JavaScript (bundles) para identificar divergências.

### 1.3 Escopo: coberto vs. fora do escopo

| Coberto | Fora do escopo |
|---------|----------------|
| Schemas Protobuf (PricingData, StaticData, EarningSignals, Polymarket) | Implementação completa do UI renderer (React/Svelte) |
| WebSocket streaming (quote, earnings, polymarket) + Web Components | Algoritmos de negociação |
| Portfolio calculation engine + fórmulas de cálculo | Dados históricos de opções |
| Search & Screener (REST) + Search modes | Análise de vulnerabilidades |
| Auth (cookie/crumb, login tiers) | Engenharia reversa de binários server-side |
| REST endpoints (quoteSummary v10, chart v8, spark v7, etc.) | Performance benchmarking |
| Price history repair logic (auto_adjust, back_adjust, gap detection) | — |
| HTML page structure + inline data format | — |

---

## 2. Artefatos analisados

### 2.1 Frontend JavaScript bundles

| Arquivo | Tamanho | Hash (SHA256 inferido) | Função |
|---------|---------|------------------------|--------|
| `_staticFinProtobuf.4ac0aa7cd811394598dc.mjs` | 100 KB | N/A | Schemas Protobuf (quotefeeder, earningsignals, polymarket) |
| `streamer.6dd62afba71e23928463.mjs` | 56 KB | N/A | UI components de streaming + Web Components |
| `streamer.worker.f3908d5612a4e787ca3a.worker.mjs` | 12 KB | N/A | Web Worker de streamer (WS connection + protobuf decode) |
| `portfolio.worker.ce3eaa8f91eba0e3c283.worker.mjs` | 11 KB | N/A | Web Worker de portfolio (cálculos, polling REST) |
| `finSearch.modern.js` | 96 KB | N/A | Módulo de busca e screener |
| `quoteSummary.68a66e32992e50724401.js` | 143 KB | N/A | Quote summary UI e dados fundamentalistas |
| `marketSummary.ed61671e0327b67d6b94.js` | 191 KB | N/A | Market summary charts e indicadores |
| `finance.yahoo.com` (homepage HTML) | 1.5 MB | N/A | Página inicial com SvelteKit, `data-sveltekit-fetched`, runtime config, asset manifest, premium tiers |
| `finance.yahoo.com/quote/AAPL` (quote HTML) | 1.5 MB | N/A | Página de quote com inline data + root.App config + Google Analytics |

### 2.2 Backend Python (yfinance v1.5.2)

| Caminho | Linhas | Função |
|---------|--------|--------|
| `yfinance/__init__.py` | 61 | Entry points públicos |
| `yfinance/_http.py` | 101 | Abstraction de HTTP (curl_cffi/requests) |
| `yfinance/data.py` | 689 | Singleton YfData, cookie/crumb, Auth |
| `yfinance/base.py` | 828 | Classe base TickerBase |
| `yfinance/ticker.py` | 328 | Ticker com options chain |
| `yfinance/search.py` | 159 | Search REST |
| `yfinance/const.py` | 1154 | Constantes, endpoints, schemas de fields |
| `yfinance/live.py` | 350 | WebSocket sync/async |
| `yfinance/scrapers/quote.py` | 945 | Quote summary + FastInfo |
| `yfinance/scrapers/history.py` | 3405 | Price history download |
| `yfinance/config.py` | — | Config singleton |
| `yfinance/pricing_pb2.py` | — | Protobuf Python (gerado) |
| `yfinance/pricing.proto` | — | Fonte .proto |

---

## 3. Backend Python (yfinance)

### 3.1 Arquitetura geral

```
                    +-----------+
                    |  Usuário  |
                    +-----+-----+
                          |
          +---------------++---------------+
          |              |                |
    +-----v-----+  +----v----+   +-------v------+
    |  Ticker   |  |  Search |   |  Screener    |
    +-----+-----+  +----+----+   +-------+------+
          |              |               |
    +-----v-----+  +----+----+   +-------v------+
    |  TickerBase|  | YfData  |   |  Query       |
    +-----+-----+  +----+----+   +-------+------+
          |              |               |
    +-----v-----+  +----+----+   +-------v------+
    | Scrapers  |  | _http   |   |  WebSocket   |
    | (quote,   |  | (session|   |  (live.py)   |
    |  history, |  |  mgmt)  |   |              |
    |  holders, +--+---------+   +--------------+
    |  analysis)|
    +-----------+
```

**Observado:** `data.py:80` — `YfData` usa `SingletonMeta` para garantir uma
única sessão HTTP compartilhada. `data.py:60-77` — implementação de singleton
com `threading.Lock`.

### 3.2 Camada HTTP (`_http.py`)

**Observado:** `_http.py:21-33` — dois backends:
- `curl_cffi` (default): impersonação TLS Chrome via `curl_cffi.requests`
- `requests` (fallback): quando `YF_DISABLE_CURL_CFFI` está setado ou
  `curl_cffi` não pode ser importado

**Observado:** `_http.py:58-69` — `new_session()` cria sessão com
`impersonate="chrome"` quando curl_cffi está disponível.

**Inferido:** O fallback para `requests` puro não replica JA3/JA4 fingerprint,
tornando o cliente mais suscetível a rate limiting.

### 3.3 config.py — Configuração Global

**Arquivo:** `config.py` (61 linhas, `yfinance/config.py:1-61`)

**`ConfigMgr`** é o singleton de configuração. Exposto como `YfConfig`.

```python
# config.py L21-38
class ConfigMgr:
    def _load_option(self):
        n = self.__getattr__('network')
        n.proxy = None
        n.retries = 0
        d = self.__getattr__('debug')
        d.hide_exceptions = True
        d.logging = False
        loc = self.__getattr__('locale')
        loc.lang = "en-US"
        loc.region = "US"
```

**Namespaces dinâmicos:** `__getattr__` cria qualquer namespace na primeira
leitura (`config.py:40-46`). `config.foo.bar = x` funciona sem erro.

| Namespace | Campo | Default | Uso |
|-----------|-------|---------|-----|
| `network` | `proxy` | `None` | Proxy HTTP |
| `network` | `retries` | `0` | Retentativas em erro |
| `debug` | `hide_exceptions` | `True` | Silencia exceções |
| `debug` | `logging` | `False` | Log detalhado |
| `locale` | `lang` | `"en-US"` | BCP-47 language tag |
| `locale` | `region` | `"US"` | ISO 3166-1 alpha-2 |

### 3.4 Sistema de Crumb — CSRF Token (`data.py`)

O **crumb** é um token CSRF (Cross-Site Request Forgery) que o Yahoo Finance
exige como query parameter (`?crumb=...`) em **todas** as chamadas de API.
Sem ele, o servidor retorna 401/Unauthorized ou redireciona para a página de
consentimento.

#### 3.3.1 Estrutura de estado (`data.py:86-109`)

```python
class YfData(metaclass=SingletonMeta):
    def __init__(self, session=None):
        self._crumb = None          # ← o token CSRF (string)
        self._cookie = None         # flag: obtivemos cookie?
        self._logged_in = False     # usuário forneceu login cookies (T/Y)?
        self._cookie_strategy = 'basic'  # 'basic' | 'csrf'
```

**Propriedades do crumb:**
- É uma string alfanumérica curta (ex: `"abc123def456"`)
- Fica em cache em `self._crumb` durante toda a vida do singleton
- É invalidado (`self._crumb = None`) quando:
  1. `set_login_cookies()` é chamado (novo login → novo crumb)
  2. `_set_cookie_strategy()` troca de estratégia
  3. Uma request 4xx força troca de estratégia

#### 3.3.2 Duas estratégias de obtenção

**Estratégia 1 — `basic` (default):**

```python
# data.py:226-274
# Passo 1: obtém cookie A3
def _get_cookie_basic(self, timeout=30):
    # Tenta carregar cookie persistente em cache
    if self._load_cookie_curlCffi():
        return True
    # GET https://fc.yahoo.com → servidor seta cookie A3
    self._session.get(url='https://fc.yahoo.com', timeout=timeout)
    self._save_cookie_curlCffi()

# Passo 2: usa o cookie para obter o crumb
def _get_crumb_basic(self, timeout=30):
    if self._crumb is not None:
        return self._crumb  # cache hit
    self._get_cookie_basic(timeout)
    # GET https://query1.finance.yahoo.com/v1/test/getcrumb
    crumb_response = self._session.get(**get_args)
    self._crumb = crumb_response.text  # ← resposta RAW (plain text)
    # Valida: 429 = rate limit, '<html>' = falha
```

**Estratégia 2 — `csrf` (fallback):**

```python
# data.py:282-368
# Passo 1: obtém cookie via formulário de consentimento
def _get_cookie_csrf(self, timeout):
    # GET https://guce.yahoo.com/consent
    # Faz parse do HTML → extrai <input name="csrfToken">
    # POST https://consent.yahoo.com/v2/collectConsent?sessionId=...
    #   com dados: agree, consentUUID, sessionId, csrfToken
    # GET https://guce.yahoo.com/copyConsent?sessionId=...
    self._cookie = True

# Passo 2: usa query2 (em vez de query1)
def _get_crumb_csrf(self, timeout=30):
    if self._crumb is not None:
        return self._crumb
    self._get_cookie_csrf(timeout)
    # GET https://query2.finance.yahoo.com/v1/test/getcrumb
    # ↑ DIFERENÇA: query2, não query1
    r = self._session.get(url='https://query2.finance.yahoo.com/v1/test/getcrumb')
    self._crumb = r.text
```

#### 3.3.3 Diferenças entre as estratégias

| Aspecto | `basic` | `csrf` |
|---------|---------|--------|
| Cookie endpoint | `https://fc.yahoo.com` | `https://guce.yahoo.com/consent` + consentimento |
| Crumb endpoint | `query1.finance.yahoo.com/v1/test/getcrumb` | `query2.finance.yahoo.com/v1/test/getcrumb` |
| Cookie | A3 (automático) | CSRF token via formulário |
| Cache de cookie | Sim (arquivo via `cache.py`) | Sim |
| Quando usado | Default | Fallback quando `basic` falha |

#### 3.3.4 Toggle automático entre estratégias

```python
# data.py:370-391
def _get_cookie_and_crumb(self, timeout=30):
    with self._cookie_lock:
        if self._cookie_strategy == 'csrf':
            crumb = self._get_crumb_csrf()
            if crumb is None:
                # csrf falhou → troca para basic
                self._set_cookie_strategy('basic', have_lock=True)
                crumb = self._get_cookie_and_crumb_basic(timeout)
        else:
            crumb = self._get_cookie_and_crumb_basic(timeout)
            if crumb is None:
                # basic falhou → troca para csrf
                self._set_cookie_strategy('csrf', have_lock=True)
                crumb = self._get_crumb_csrf()
    return crumb, self._cookie_strategy
```

O toggle também ocorre em **runtime** (data.py:458-466): se uma request retorna
`>= 400`, a lib tenta a outra estratégia e refaz a request com o novo crumb.

#### 3.3.5 Injeção automática do crumb nas requests

```python
# data.py:412-473
def _make_request(self, url, request_method, ...):
    # IMPORTANTE: usuário NÃO pode passar 'crumb' manualmente
    if 'crumb' in params:
        raise YFException("Don't manually add 'crumb' to params")

    # Obtém crumb (com cache + fallback automático)
    crumb, strategy = self._get_cookie_and_crumb()
    crumbs = {'crumb': crumb} if crumb else {}

    # Injeta como query parameter em TODA request
    request_args = {
        'url': url,
        'params': {**params, **crumbs},  # ← crumb sempre adicionado
    }

    # Retry em erro de rede com exponential backoff
    for attempt in range(retries + 1):
        try:
            response = request_method(**request_args)
        except Exception as e:
            if is_transient(e) and attempt < retries:
                time.sleep(2 ** attempt)

    # Se 4xx, troca estratégia e tenta de novo
    if response.status_code >= 400:
        self._set_cookie_strategy('csrf' if strategy == 'basic' else 'basic')
        crumb, strategy = self._get_cookie_and_crumb(timeout)
        request_args['params']['crumb'] = crumb
        response = request_method(**request_args)
```

#### 3.3.6 Invalidação do crumb

```python
# data.py:111-126 — login cookies mudam → crumb deve ser renovado
def set_login_cookies(self, cookie_t, cookie_y):
    self._session.cookies.update({"T": cookie_t, "Y": cookie_y})
    self._crumb = None  # ← invalida crumb!

# data.py:153-179 — troca de estratégia → crumb deve ser renovado
def _set_cookie_strategy(self, strategy, ...):
    self._crumb = None  # ← invalida crumb!
```

#### 3.3.7 Cache do cookie

O cookie A3 é persistido em disco via `cache.py`:

```python
# data.py:182-223
_save_cookie_curlCffi()  # Salva cookie no cache de disco
_load_cookie_curlCffi()  # Carrega cookie do cache, verifica expiry
```

O cache evita uma chamada HTTP a `fc.yahoo.com` a cada inicialização. O cookie
expired é detectado por `expires > 2e9` (ms → s) e comparado com UTC now.

#### 3.3.8 Comparação com yahoo-finance2 (TypeScript) — Consent Flow Detalhado

A biblioteca `yahoo-finance2` (gadicc) implementa um fluxo de consentimento **mais completo**
que o yfinance. Enquanto o yfinance usa `guce.yahoo.com/consent` + `POST /v2/collectConsent`
(estratégia `csrf`), o yahoo-finance2 implementa um pipeline de **5 estágios** com até **5 retries**:

```
1. GET https://finance.yahoo.com/quote/AAPL
   Headers: Accept: text/html, redirect: manual
   ↓ (resposta 302 redirect)

2. GET https://guce.yahoo.com/... (redirect da Yahoo)
   ↓ (resposta 302 redirect)

3. GET https://guce.yahoo.com/collectConsent?sessionId=XXX
   → Parseia HTML: extrai <input type="hidden" name="..." value="...">
   → Campos: csrfToken, sessionId, originalDoneUrl, namespace
   ↓

4. POST https://guce.yahoo.com/collectConsent?sessionId=XXX
   Content-Type: application/x-www-form-urlencoded
   Body: {csrfToken}&{sessionId}&{originalDoneUrl}&namespace=yahoo&agree=agree&agree=agree
   ↓ (resposta 302 + Set-Cookie: CFC=...)

5. GET https://guce.yahoo.com/copyConsent?sessionId=XXX
   ↓ (resposta 302 redirect para finance.yahoo.com)
   ↓

6. RECURSÃO: repete #1 até #5 no redirect final
   (maxDepth = 5, evita loop infinito)
```

**Diferenças chave vs yfinance:**

| Aspecto | yfinance (Python) | yahoo-finance2 (TS) |
|---------|-------------------|---------------------|
| **Cookie inicial** | `GET https://fc.yahoo.com` (A3) | `GET https://finance.yahoo.com/quote/AAPL` (sessão moderna) |
| **Parse do consent** | Extrai só `csrfToken` | Extrai TODOS os `<input type="hidden">` dinamicamente |
| **Redirecionamento** | Assume caminho fixo | Segue redirect chain real com `manual` redirect |
| **Retries** | 1 tentativa por estratégia | Até 5 recursões no consent chain |
| **Armazenamento do crumb** | `self._crumb` (memória) + cookie A3 em cache de disco | Cookie jar com URL fake `http://config.yf2/` (getCrumb.ts:283) |
| **Endpoint do crumb** | `query1` (basic) ou `query2` (csrf) | **Sempre** `query1.finance.yahoo.com/v1/test/getcrumb` |
| **Headers** | Mínimos | Adiciona `Origin`, `Referer`, `accept-language`, `accept-encoding` |

**Detalhe importante:** O yahoo-finance2 usa um **CookieJar estendido** (`ExtendedCookieJar` em
`cookieJar.ts`) que adiciona o método `setFromSetCookieHeaders()` para processar headers
`Set-Cookie` em lote. O crumb é armazenado com uma **URL falsa** `http://config.yf2/` para
isolá-lo dos cookies de domínio real.

#### 3.3.9 Fluxo completo resumido

```
YfData._make_request(url, params)
    │
    ├─ params já contém 'crumb'?
    │   └─ Sim → YFException (usuário não deve adicionar manualmente)
    │
    ├─ _get_cookie_and_crumb()
    │   ├─ Estratégia atual = 'basic' ou 'csrf'
    │   ├─ _crumb existe em cache?
    │   │   └─ Sim → retorna direto (sem HTTP)
    │   ├─ Obtém cookie:
    │   │   ├─ basic:  GET fc.yahoo.com → cookie A3
    │   │   └─ csrf:   GET guce.yahoo.com → parse csrfToken → POST consent
    │   ├─ Salva cookie em cache de disco
    │   ├─ Obtém crumb:
    │   │   ├─ basic:  GET query1/v1/test/getcrumb
    │   │   └─ csrf:   GET query2/v1/test/getcrumb
    │   ├─ Valida: 429 → YFRateLimitError, '<html>' → None
    │   └─ Se None → troca estratégia e tenta de novo
    │
    ├─ {**params, 'crumb': crumb} → request HTTP
    │
    └─ Response >= 400?
        └─ Sim → troca estratégia, re-obtém crumb, refaz request
```

#### 3.3.9 Observações importantes

1. O crumb é um **texto plano** (`response.text`), não JSON — a resposta do
   endpoint `/v1/test/getcrumb` é uma string literal sem formatação.
2. Cada estratégia usa um **domínio diferente** para o crumb:
   - `basic` → `query1.finance.yahoo.com`
   - `csrf` → `query2.finance.yahoo.com`
3. Rate limiting (HTTP 429) é detectado tanto pelo status code quanto pelo
   conteúdo `"Too Many Requests"` no texto do crumb.
4. `set_login_cookies()` invalida o crumb porque o token CSRF é vinculado à
   sessão de login — um novo login requer um novo crumb.
5. O cookie A3 é cacheado em disco com timestamp de expiração, evitando
   chamadas repetidas a `fc.yahoo.com` em execuções subsequentes.

### 3.4 Auth e login tiers

**Observado:** `data.py:576-689` — classe `Auth`:
- `set_login_cookies(cookie_t, cookie_y)`: aceita cookies `T` e `Y` do browser
- `check_login()`: verifica via `_fetch_entitlement()` → endpoint subscriptions
- `subscription_tier()`: retorna `'gold'`, `'silver'`, `'bronze'`, `'free'` ou `None`

**Observado:** `data.py:614-636` — `_fetch_entitlement()` faz GET para
`/ws/obi-integration/v1/subscriptions` e verifica se `result.guid` existe.

### 3.4 Auth e login tiers

**Observado:** `data.py:576-689` — classe `Auth`:
- `set_login_cookies(cookie_t, cookie_y)`: aceita cookies `T` e `Y` do browser
- `check_login()`: verifica via `_fetch_entitlement()` → endpoint subscriptions
- `subscription_tier()`: retorna `'gold'`, `'silver'`, `'bronze'`, `'free'` ou `None`

**Observado:** `data.py:614-636` — `_fetch_entitlement()` faz GET para
`/ws/obi-integration/v1/subscriptions` e verifica se `result.guid` existe.

### 3.5 Search (`search.py`)

**Observado:** `search.py:84-98` — endpoint:
```
GET {_BASE_URL_}/v1/finance/search
Params: q, quotesCount, enableFuzzyQuery, newsCount, quotesQueryId, newsQueryId,
        listsCount, enableCb, enableNavLinks, enableResearchReports,
        enableCulturalAssets, recommendedCount
```
Retorna: `quotes`, `news`, `lists`, `researchReports`, `nav`

**Inferido:** `quotesQueryId="tss_match_phrase_query"` e
`newsQueryId="news_cie_vespa"` são IDs internos do Vespa (sistema de busca
do Yahoo).

### 3.6 Price History (`scrapers/history.py` — 3405 linhas)

**Observado:** `history.py:38-42` — método `history()`:
```
GET {_BASE_URL_}/v8/finance/chart/{ticker}?period1=...&period2=...&interval=...
```
- `period`: `1d`, `5d`, `1mo`, `3mo`, `6mo`, `1y`, `2y`, `5y`, `10y`, `ytd`, `max`
- `interval`: `1m`, `2m`, `5m`, `15m`, `30m`, `60m`, `90m`, `1h`, `1d`, `5d`, `1wk`, `1mo`, `3mo`

**Auto-adjust (`auto_adjust=True`):** `history.py:101-130` — após obter OHLCV + adjclose,
multiplica Open/High/Low/Close/Volume pelo fator `adjclose[i] / close[i]` para
cada linha. O adjclose já vem no payload do chart.

**Back-adjust (`back_adjust=True`):** `history.py:130-160` — divide todos os
preços pelo primeiro adjclose para normalizar (série começa em 1.0).

**Interval resample:** `history.py:160-200` — quando o intervalo solicitado
(`1wk`, `1mo`, `3mo`) não é suportado diretamente pela API, a lib baixa dados
de `1d` e faz resample interno: seleciona a última linha de cada semana/mês
como OHLC, soma volumes.

**Repair logic (`auto_adjust=True`):** `history.py:1000-1800` — mecanismo
sofisticado de reparação de preços para corrigir inconsistências causadas por
eventos corporativos mal ajustados. O reparo funciona em 3 estágios:

1. **Detecção de outliers de volume** (`history.py:1100-1200`):
   Compara volume de cada candle com a mediana móvel de 10 períodos. Candles
   com volume > 10× a mediana são candidatos a eventos (dividendos, splits).

2. **Detecção de gaps de preço** (`history.py:1200-1350`):
   Calcula a razão `close[i] / open[i+1]`. Gaps > 50% são candidatos a split.
   Gaps entre 1% e 50% são candidatos a dividendos.

3. **Correção de preços** (`history.py:1350-1700`):
   - Para **splits**: multiplica preços pré-split pelo fator do split.
   - Para **dividendos**: multiplica preços pré-dividendo por `1 + dividend_yield`.
   - Mantém integridade: valida se OHLC ajustado preserva a relação `O ≤ H ≥ L ≤ C`.

**Dividends & Splits metadata:**
```
GET {_BASE_URL_}/v8/finance/chart/{ticker}
  ?period1=...&period2=...&interval=1d&events=div,splits,capitalGains
```
O campo `chart.result[0].events` contém:
```
"events": {
  "dividends": {"1234567890": {"amount": 0.96, "date": 1234567890}},
  "splits":    {"1234567890": {"date": 1234567890, "numerator": 4, "denominator": 1}}
}
```

**Metadata fetch:** `history.py:1700-2000` — para obter timezone e exchange,
a lib faz uma chamada extra com `period=1d,range=1d` e extrai `meta`:
```python
meta = {
    "currency": "USD",
    "symbol": "AAPL",
    "exchangeName": "NMS",
    "fullExchangeName": "NASDAQ",
    "instrumentType": "EQUITY",
    "firstTradeDate": 345479400,
    "regularMarketTime": 1721851200,
    "gmtoffset": -14400,
    "timezone": "EDT",
    "exchangeTimezoneName": "America/New_York",
    "fiftyTwoWeekHigh": 237.23,
    "fiftyTwoWeekLow": 164.08,
    "fiftyDayAverage": 223.45,
    "twoHundredDayAverage": 210.12,
    "currentTradingPeriod": {
        "pre": {"timezone": "EDT", "start": 1721822400, "end": 1721845800, "gmtoffset": -14400},
        "regular": {"timezone": "EDT", "start": 1721845800, "end": 1721869200, "gmtoffset": -14400},
        "post": {"timezone": "EDT", "start": 1721869200, "end": 1721883600, "gmtoffset": -14400}
    }
}
```

**Timezone validation:** `history.py:720-780` — após obter os dados, a lib
valida o timezone do exchange vs. timezone dos timestamps retornados. Converte
timestamps Unix para datetime usando `exchangeTimezoneName` via `pytz`/`zoneinfo`.

**Tratamento de `includePrePost`:** quando `True`, inclui dados PRE/POST market
para intervalos intraday (1m, 2m, 5m, etc.). A API retorna `marketHours`
differentiator nos timestamps.

**_fix_columns:** `history.py:800-850` — normaliza nomes de colunas:
- `Open, High, Low, Close, Volume, Adj Close, Dividends, Stock Splits, Capital Gains`
- Capital Gains são mergeados com Dividends

### 3.7 Quote Summary (`scrapers/quote.py` — 945 linhas)

**Observado:** `quote.py:43` — endpoint:
```
GET {_BASE_URL_}/v10/finance/quoteSummary/{ticker}
Params: modules=assetProfile,financialData,defaultKeyStatistics,...
```

**Observado:** `const.py:128-162` — módulos válidos do `quoteSummary`:
`summaryProfile`, `summaryDetail`, `assetProfile`, `fundProfile`, `price`,
`quoteType`, `esgScores`, `incomeStatementHistory`,
`balanceSheetHistory`, `cashFlowStatementHistory`,
`defaultKeyStatistics`, `financialData`, `calendarEvents`,
`secFilings`, `upgradeDowngradeHistory`, `institutionOwnership`,
`fundOwnership`, `majorDirectHolders`, `majorHoldersBreakdown`,
`insiderTransactions`, `insiderHolders`, `netSharePurchaseActivity`,
`earnings`, `earningsHistory`, `earningsTrend`, `industryTrend`,
`indexTrend`, `sectorTrend`, `recommendationTrend`, `futuresChain`

#### 3.7.1 FastInfo (data descriptor proxy)

**Observado:** `quote.py:241-278` — `FastInfo` é um *data descriptor* (Python)
que intercepta acesso a atributos do Ticker e faz um único request ao chart
`v8/finance/chart` (NÃO ao quoteSummary) para obter um subconjunto mínimo de
dados fundamentalistas. É chamado de "fast" porque usa o endpoint de chart
(mais leve) em vez do quoteSummary (mais pesado).

Mecanismo:
```python
class FastInfo:
    def __getattr__(self, attr):
        # 1. GET /v8/finance/chart/{ticker}?period=1d&interval=1d
        # 2. Extrai meta do response: currency, exchangeName, timezone, etc.
        # 3. Armazena em cache (dicionário interno)
        # 4. Retorna o valor
        ...
    @property
    def valuation_measures(self):
        # Retorna dict com marketCap, enterpriseValue, trailingPE, forwardPE,
        # priceToBook, priceToSalesTrailing12Months
```

Propriedades expostas via FastInfo:
```python
# Metadados
"symbol", "currency", "exchangeName", "fullExchangeName", "instrumentType",
"firstTradeDate", "regularMarketTime", "gmtoffset", "timezone",
"exchangeTimezoneName", "exchangeTimezoneShortName",

# Preços
"regularMarketPrice", "regularMarketDayHigh", "regularMarketDayLow",
"regularMarketDayRange", "regularMarketVolume", "regularMarketPreviousClose",
"regularMarketOpen", "regularMarketChange", "regularMarketChangePercent",
"preMarketPrice", "preMarketChange", "preMarketChangePercent",
"postMarketPrice", "postMarketChange", "postMarketChangePercent",

# Médias
"fiftyTwoWeekHigh", "fiftyTwoWeekLow", "fiftyTwoWeekRange",
"fiftyDayAverage", "twoHundredDayAverage",

# Valuation
"marketCap", "enterpriseValue", "trailingPE", "forwardPE",
"priceToBook", "priceToSalesTrailing12Months",
"earningsPerShare", "bookValue", "revenue", "totalRevenue",
"debtToEquity", "profitMargins", "returnOnEquity", "returnOnAssets",

# Dividendos
"dividendRate", "dividendYield", "trailingAnnualDividendRate",
"trailingAnnualDividendYield", "payoutRatio",

# Outros
"beta", "shortRatio", "shortPercentOfFloat", "sharesOutstanding",
"heldPercentInstitutions", "heldPercentInsiders",
"impliedSharesOutstanding", "epsTrailingTwelveMonths",
"epsForward", "epsCurrentYear", "priceEpsilon",
"earningsQuarterlyGrowth", "revenueGrowth",
"averageDailyVolume3Month", "averageVolume", "averageVolume10days",
"sandP52WeekChange", "fiftyTwoWeekChangePercent"
```

#### 3.7.2 `_exchange_open_now()`

**Observado:** `quote.py:220-240` — verifica se o exchange está em horário
de negociação atualmente. Usa `exchangeTimezoneName` + hora atual para
determinar:
```python
def _exchange_open_now(ticker_data):
    # Pega timezone do exchange (ex: "America/New_York")
    # Verifica se hora atual está entre pre-market open e post-market close
    # Retorna bool + market state string
```

#### 3.7.3 Properties do QuoteScraper

Além do FastInfo, `quote.py:300-900` expõe dezenas de properties que chamam
`quoteSummary` com módulos específicos e transformam o retorno:

| Property | Módulo quoteSummary | Retorno |
|----------|---------------------|---------|
| `calendar` | `calendarEvents` | earnings date, ex-dividend date |
| `major_holders` | `majorHoldersBreakdown` | % held by insiders, institutions |
| `institutional_holders` | `institutionOwnership` | lista de holders com shares |
| `dividends` | `incomeStatementHistory` | histórico de dividendos |
| `splits` | `chart` events | stock splits |
| `actions` | `chart` events | dividends + splits + capitalGains |
| `shares` | `defaultKeyStatistics` | shares outstanding, float |
| `info` | todos os módulos | dict completo mergeado |
| `growth` | `financialData` | revenue growth, earnings growth |
| `quarterly_earnings` | `earningsHistory` | earnings por trimestre |
| `recommendations` | `recommendationTrend` | buy/hold/sell ratings |
| `earnings_estimate` | `earningsTrend` | EPS estimado por período |
| `revenue_estimate` | `earningsTrend` | receita estimada |
| `eps_trend` | `earningsTrend` | tendência do EPS |
| `insider_transactions` | `insiderTransactions` | transações de insider |
| `insider_purchases` | `insiderHolders` | compras de insider |
| `upgrades_downgrades` | `upgradeDowngradeHistory` | histórico de ratings |
| `sec_filings` | `secFilings` | SEC filings list |

### 3.8 WebSocket Live (`live.py`)

**Observado:** `live.py:16` — URL: `wss://streamer.finance.yahoo.com/?version=2`

**Observado:** `live.py:24-29` — decodificação:
1. Recebe mensagem JSON com campo `"message"` (base64)
2. Decodifica base64 → bytes
3. Parseia como protobuf `PricingData`
4. Converte para dict via `MessageToDict`

**Observado:** `live.py:75-92` — heartbeat: re-envia `{"subscribe": [...]}`
a cada 15 segundos.

### 3.9 Screener

**Observado:** `screener/query.py` — classes `EquityQuery`, `FundQuery`, `ETFQuery`
que montam queries JSON para o endpoint:
```
POST {_BASE_URL_}/v1/finance/screener/predefined/saved
```

**Observado:** `const.py:402-760` — mapeamentos de:
- `EQUITY_SCREENER_EQ_MAP`: exchanges, sectors, industries, peer groups
- `EQUITY_SCREENER_FIELDS`: campos de valuation, profitability, liquidity, etc.
- `FUND_SCREENER_FIELDS`, `ETF_SCREENER_FIELDS`

**19 queries pré-definidas** (`screener/screener.py:22-61`):

| Query | Tipo | Sort | Critério principal |
|-------|------|------|-------------------|
| `aggressive_small_caps` | Equity | eodvolume DESC | NMS/NYQ, EPS growth < 15 |
| `day_gainers` | Equity | percentchange DESC | change > 3%, mkt cap > 2B |
| `day_losers` | Equity | percentchange ASC | change < -2.5%, mkt cap > 2B |
| `growth_technology_stocks` | Equity | eodvolume DESC | revenue growth > 25%, sector=Technology |
| `most_actives` | Equity | dayvolume DESC | region=US, mkt cap > 2B |
| `most_shorted_stocks` | Equity | short_pct DESC | price > 1, avg vol > 200K |
| `small_cap_gainers` | Equity | eodvolume DESC | mkt cap < 2B, NMS/NYQ |
| `undervalued_growth_stocks` | Equity | eodvolume DESC | P/E 0-20, PEG < 1, EPS growth > 25 |
| `undervalued_large_caps` | Equity | eodvolume DESC | P/E 0-20, PEG < 1, mkt cap 10B-100B |
| `conservative_foreign_funds` | Fund | fundnetassets DESC | Foreign funds, rating 4-5 |
| `high_yield_bond` | Fund | fundnetassets DESC | High Yield Bond, rating 4-5 |
| `portfolio_anchors` | Fund | fundnetassets DESC | Large Blend, rating 4-5 |
| `solid_large_growth_funds` | Fund | fundnetassets DESC | Large Growth, rating 4-5 |
| `solid_midcap_growth_funds` | Fund | fundnetassets DESC | Mid-Cap Growth, rating 4-5 |
| `top_mutual_funds` | Fund | percentchange DESC | price > 15, rating 4-5 |
| `top_etfs_us` | ETF | percentchange DESC | price > 10, rating 4-5, US |
| `top_performing_etfs` | ETF | expense_ratio ASC | US, rating 4-5, price > 10 |
| `technology_etfs` | ETF | expense_ratio ASC | US, category=Technology |
| `bond_etfs` | ETF | expense_ratio ASC | US, bond categories |

**Operadores:** `and`, `or`, `eq`, `gt`, `lt`, `gte`, `lte`, `btwn`, `is-in`

### 3.10 Ticker e TickerBase (`ticker.py` / `base.py`)

**Inicialização do Ticker** (`base.py:54-125`):
```python
Ticker("AAPL")
  ├── Normaliza ticker para uppercase
  ├── Suporta ISIN → conversão automática via cache.get_isin_cache()
  ├── Suporta tupla (symbol, MIC) → ex: ("OR", "XPAR")
  │     └── MIC → Yahoo suffix via _MIC_TO_YAHOO_SUFFIX (const.py)
  ├── YfData singleton (sessão compartilhada)
  ├── Instancia scrapers (lazy):
  │     ├── Analysis, Holders, Quote, Fundamentals
  │     └── PriceHistory = None (lazy-load)
  └── self._fast_info = None (lazy)
```

**Resolução de Timezone** (`base.py:138-169`):
1. Cache local (`self._tz`) → se válido, usa
2. Cache persistente (`cache.get_tz_cache()`) → lookup por ticker
3. API: `GET /v8/finance/chart/{ticker}?range=1d&interval=1d` → `meta.exchangeTimezoneName`
4. Fallback: `info['exchangeTimezoneName']` ou `info['timeZoneFullName']` (limitado a 2 tentativas globais)

**Option Chain** (`ticker.py:42-105`):
- Endpoint: `GET /v7/finance/options/{ticker}?date={timestamp}`
- Cache de expirations em `self._expirations` (dict date→timestamp)
- Retorna `namedtuple('Options', ['calls', 'puts', 'underlying'])`
- Options DataFrame: contractSymbol, strike, lastPrice, bid, ask, volume, openInterest, impliedVolatility, inTheMoney, currency

**News** (`base.py:591-631`):
- Endpoint: `POST https://finance.yahoo.com/xhr/ncp?queryRef={tab}&serviceKey=ncp_fin`
- Tabs: `"all"` → `queryRef=newsAll`, `"news"` → `latestNews`, `"press releases"` → `pressRelease`
- Payload: `{"serviceConfig": {"snippetCount": count, "s": [ticker]}}`
- Filtra ads: `[article for article in news if not article.get('ad', [])]`

**Earnings Dates** (`base.py:633-807`):
- **Método principal** (L645-737): Scraping HTML de `finance.yahoo.com/calendar/earnings?symbol={ticker}` via BeautifulSoup + `pd.read_html()`
- **Método alternativo** (L740-807): API `POST /v1/finance/visualization` — **depreciado desde Summer 2025** (Yahoo parou de atualizar)

### 3.11 tickers.py — Múltiplos Tickers

**Arquivo:** `tickers.py` (101 linhas)

- Wrapper que cria N instâncias de `Ticker`
- `download(period, interval, ...)` delega para `multi.download()` com todos os tickers
- `live()` cria `WebSocket` e subscreve todos os símbolos

### 3.12 multi.py — Download Paralelo

**Arquivo:** `multi.py` (301 linhas)

```python
def download(tickers, period, interval, ...):
    return _download_impl(_DownloadCtx(), ...)
```

**`_DownloadCtx`** (`multi.py:41-52`): estado isolado por chamada com `__slots__`:
- `dfs` — dict de DataFrames por símbolo
- `errors` — dict de erros por símbolo
- `tracebacks` — tracebacks completos
- `progress_bar` — barra de progresso opcional
- `lock` — threading.Lock para acesso concorrente

**Paralelismo** (`multi.py:157-167`):
- Usa `multitasking` para threads paralelas
- `threads = min(len(tickers), cpu_count * 2)` se `threads=True`
- DEBUG logging habilitado → serializa (`threads=False`) para evitar interleave

**Error handling** (`multi.py:267-301`):
```python
try:
    data = tkr.history(...)
    with ctx.lock:
        ctx.dfs[sym] = data
        # Captura soft errors do PriceHistory
        if ph._last_error is not None:
            ctx.errors[sym] = ph._last_error
except Exception as e:
    ctx.dfs[sym] = utils.empty_df()  # DataFrame vazio
    ctx.errors[sym] = repr(e)
```

### 3.13 lookup.py — Lookup de Ativos

**Arquivo:** `lookup.py` (220 linhas)

- Endpoint: `GET https://query1.finance.yahoo.com/v1/finance/lookup`
- Params: `query`, `type`, `start`, `count`, `formatted`, `fetchPricingData`, `lang`, `region`
- Tipos: `all`, `equity`, `mutualfund`, `etf`, `index`, `future`, `currency`, `cryptocurrency`
- Retorna `pd.DataFrame` indexado por `symbol`
- Cache interno por `(lookup_type, count)`

### 3.14 scrapers/fundamentals.py — Financials

**Arquivo:** `fundamentals.py` (204 linhas)

**Classe `Financials`** (`fundamentals.py:43-204`):
- Endpoint: `GET https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{symbol}`
- Tipos: `income` (→ `financials`), `balance-sheet`, `cash-flow`
- Frequências: `yearly` (→ `annual`), `quarterly`, `trailing`
- **Chunked fallback** para WSL2 NAT/proxy (`fundamentals.py:114`):
  ```python
  _CHUNK_KEYS = 60  # 60 keys por chunk para URL < ~2KB
  ```
  Flag sticky `self._data.fundamentals_use_chunked` evita timeout repetido.
  Se chunked também falha, reverte a flag e levanta exceção.

### 3.15 exceptions.py — Catálogo de Exceções

**Arquivo:** `exceptions.py` (53 linhas)

| Exceção | Herda de | Uso |
|---------|----------|-----|
| `YFException` | `Exception` | Base |
| `YFDataException` | `YFException` | Dados inválidos/indisponíveis |
| `YFNotImplementedError` | `NotImplementedError` | Feature não implementada |
| `YFTickerMissingError` | `YFException` | Ticker possivelmente delisted |
| `YFTzMissingError` | `YFTickerMissingError` | Timezone não encontrado |
| `YFPricesMissingError` | `YFTickerMissingError` | Dados de preço ausentes |
| `YFEarningsDateMissing` | `YFTickerMissingError` | Earnings dates não encontrados |
| `YFInvalidPeriodError` | `YFException` | Período inválido |
| `YFRateLimitError` | `YFException` | HTTP 429 — rate limited |

---

## 4. Frontend JavaScript (Yahoo Finance Web) (Yahoo Finance Web)

### 4.1 Protobuf Schemas (`_staticFinProtobuf.mjs`)

Arquivo: `_staticFinProtobuf.4ac0aa7cd811394598dc.mjs` (2685 linhas)
Compilado com protobufjs. Contém 3 namespaces:

#### 4.1.1 Namespace `quotefeeder`

**Enums:**

| Enum | Valores |
|------|---------|
| `QuoteType` | `NONE(0)`, `ALTSYMBOL(5)`, `HEARTBEAT(7)`, `EQUITY(8)`, `INDEX(9)`, `MUTUALFUND(11)`, `MONEYMARKET(12)`, `OPTION(13)`, `CURRENCY(14)`, `WARRANT(15)`, `BOND(17)`, `FUTURE(18)`, `ETF(20)`, `COMMODITY(23)`, `ECNQUOTE(28)`, `CRYPTOCURRENCY(41)`, `INDICATOR(42)`, `CUL_IDX(43)`, `CUL_SUB_IDX(44)`, `CUL_ASSET(45)`, `PRIVATE_COMPANY(46)`, `INDUSTRY(1000)` |
| `MarketHours` | `PRE_MARKET(0)`, `REGULAR_MARKET(1)`, `POST_MARKET(2)`, `EXTENDED_HOURS_MARKET(3)`, `OVERNIGHT_MARKET(4)` |
| `OptionType` | `CALL(0)`, `PUT(1)` |

**Message `PricingData`** (45 campos, field numbers 1-45):

| # | Campo | Tipo | Descrição |
|---|-------|------|-----------|
| 1 | `id` | string | Símbolo do ativo |
| 2 | `price` | float | Preço atual |
| 3 | `time` | sint64 | Timestamp Unix (ms) |
| 4 | `currency` | string | Moeda |
| 5 | `exchange` | string | Exchange |
| 6 | `quoteType` | int32 | Enum QuoteType |
| 7 | `marketHours` | int32 | Enum MarketHours |
| 8 | `changePercent` | float | Variação percentual |
| 9 | `dayVolume` | sint64 | Volume do dia |
| 10 | `dayHigh` | float | Máxima do dia |
| 11 | `dayLow` | float | Mínima do dia |
| 12 | `change` | float | Variação absoluta |
| 13 | `shortName` | string | Nome curto |
| 14 | `expireDate` | sint64 | Data de expiração (options) |
| 15 | `openPrice` | float | Preço de abertura |
| 16 | `previousClose` | float | Fechamento anterior |
| 17 | `strikePrice` | float | Preço de strike |
| 18 | `underlyingSymbol` | string | Símbolo do subjacente |
| 19 | `openInterest` | sint64 | Open interest |
| 20 | `optionsType` | sint64 | Tipo de opção |
| 21 | `miniOption` | sint64 | Mini option flag |
| 22 | `lastSize` | sint64 | Tamanho do último trade |
| 23 | `bid` | float | Bid |
| 24 | `bidSize` | sint64 | Tamanho do bid |
| 25 | `ask` | float | Ask |
| 26 | `askSize` | sint64 | Tamanho do ask |
| 27 | `priceHint` | sint64 | Casas decimais |
| 28 | `vol_24hr` | sint64 | Volume 24h (crypto) |
| 29 | `volAllCurrencies` | sint64 | Volume total (crypto) |
| 30 | `fromcurrency` | string | Moeda de origem (crypto) |
| 31 | `lastMarket` | string | Último market |
| 32 | `circulatingSupply` | double | Supply circulante (crypto) |
| 33 | `marketcap` | double | Market cap |
| 34 | `components` | string | Componentes do índice |
| 35 | `indices` | string[] | Índices que contêm o ativo |
| 36 | `cmcRank` | sint64 | CoinMarketCap rank |
| 37 | `underlyingShortname` | string | Nome curto do subjacente |
| 38 | `fiftyTwoWeekChange` | float | Variação 52 semanas |
| 39 | `fiftyTwoWeekChangePercent` | float | Variação % 52 semanas |
| 40 | `latestAmountRaised` | float | Último valor captado |
| 41 | `latestFundingDate` | sint64 | Data do último funding |
| 42 | `latestShareClass` | string | Classe de ação |
| 43 | `latestImpliedValuation` | float | Valuation implícita |
| 44 | `ytdReturn` | float | Retorno YTD |
| 45 | `qtdReturn` | float | Retorno QTD |

**Message `StaticData`** (8 campos):

| # | Campo | Tipo |
|---|-------|------|
| 1 | `id` | string |
| 2 | `displayName` | string |
| 3 | `currency` | string |
| 4 | `exchange` | string |
| 5 | `openPrice` | float |
| 6 | `closePrice` | float |
| 7 | `fiftytwoWkMovingAvgPrice` | float |
| 8 | `twohundredDataMovingAvgPrice` | float |

**Message `PriceUpdate`**: wrapper com `pricingData` (PricingData)

**Message `StaticUpdate`**: wrapper com `staticData` (StaticData)

#### 4.1.2 Namespace `earningsignals`

**Message `EarningSignals`** (6 campos obrigatórios):

| # | Campo | Tipo | Descrição |
|---|-------|------|-----------|
| 1 | `symbol` | string (required) | Símbolo |
| 2 | `dateTimeInMillis` | sint64 (required) | Timestamp |
| 3 | `epsEstimate` | double | EPS estimado |
| 4 | `epsActual` | double | EPS real |
| 5 | `epsSurprise` | double | Surpresa de EPS |
| 6 | `epsSurprisePercent` | double | Surpresa % |

#### 4.1.3 Namespace `polymarket`

**Enums:**
- `Side`: `SIDE_UNSPECIFIED(0)`, `BUY(1)`, `SELL(2)`
- `EventType`: `EVENT_TYPE_UNSPECIFIED(0)`, `BOOK(1)`, `PRICE_CHANGE(2)`, `TICK_SIZE_CHANGE(3)`, `LAST_TRADE_PRICE(4)`

**Messages (campos em snake_case no protobuf):**
- `Order`: `price` (string), `size` (string)
- `EventMessage`: `id`, `ticker`, `slug`, `title`, `description`
- `BookEvent`: `event_type`, `asset_id`, `market`, `timestamp`, `hash`, `bids[]`, `asks[]`
- `PriceChange`: `asset_id`, `price`, `size`, `side`, `hash`, `best_bid`, `best_ask`
- `PriceChangeEvent`: `event_type`, `market`, `price_changes[]`, `timestamp`
- `TickSizeChangeEvent`: `event_type`, `asset_id`, `market`, `old_tick_size`, `new_tick_size`, `timestamp`
- `LastTradePriceEvent`: `event_type`, `asset_id`, `fee_rate_bps`, `market`, `price`, `side`, `size`, `timestamp`
- `MarketEvent`: `event_type` + oneof: `bookEvent`, `priceChangeEvent`, `tickSizeChangeEvent`, `lastTradePriceEvent`

**Snake → camel mapping (runtime):** O worker aplica uma transformação
recursiva via função `o()` que mapeia os campos snake_case do protobuf para
camelCase usando o dicionário: `event_type→eventType`, `asset_id→assetId`,
`best_bid→bestBid`, `best_ask→bestAsk`, `price_changes→priceChanges`,
`old_tick_size→oldTickSize`, `new_tick_size→newTickSize`,
`fee_rate_bps→feeRateBps`. A transformação é aplicada recursivamente em
arrays aninhados de `priceChanges`.

### 4.2 Streamer Infrastructure

#### 4.2.1 WebSocket Connection (`streamer.worker.mjs`)

**Arquitetura:**
```
Browser Main Thread
    |
    +--> MessageChannel (port)
    |
    +--> Streamer Worker (streamer.worker.mjs)
            |
            +--> WebSocket connection
            |       wss://streamer.finance.yahoo.com/?version=2
            |       (or streamer-stage for staging)
            |
            +--> protobufjs (importScripts CDN)
            |       https://cdn.jsdelivr.net/npm/protobufjs@7.1.2/...
            |
            +--> Protobuf schema (importScripts)
                    https://s.yimg.com/uc/finance/webcore/js/_staticFinProtobuf...
```

**Observado** (`streamer.worker.f3908d5612a4e787ca3a.worker.mjs`):

```javascript
// Connection class hierarchy
class s { // BaseConnection
    constructor(protobuf, sendFn)
    symbolList = []
    batchedUnsubscriptions = []
    sendConnection = debounce(sendFn, 1000)
    unsubscribeFromConnection = debounce(sendUnsub, 1000)
}

// Quote streamer
class d extends s { // QuoteStreamer
    constructor(protobuf, messagePort, pfMessagePort, sendFn, useFormattedSeeding=false)
    // 3º arg: pfMessagePort → comunicação direta com Portfolio Worker

    handleWebSocketUpdate(rawData) {
        const {PricingData} = protobuf.roots.default.quotefeeder;
        let r = PricingData.decode(e);
        r = PricingData.toObject(r, {enums: String});
        // Maps fields:
        //   "id" -> "symbol"
        //   "dayVolume" -> "volume"
        //   "dayHigh" -> "high"
        //   "dayLow" -> "low"
        //   "marketcap" -> "marketCap"
        //   "marketHours" -> "marketState"
        //   "openPrice" -> "regularMarketOpen"
        //   etc.
    }
}
```

**Tipos de streamer:**
- `quote` (class `d`): decodifica `PricingData` para dados de cotação
- `earnings` (class `n`): decodifica `EarningSignals`
- `polymarket` (class `a`): decodifica `MarketEvent` e subtipos

**Polymarket field mapping** (snake_case do protobuf → camelCase interno):
```javascript
const fieldMap = {
    event_type: "eventType",       asset_id: "assetId",
    best_bid: "bestBid",           best_ask: "bestAsk",
    price_changes: "priceChanges", old_tick_size: "oldTickSize",
    new_tick_size: "newTickSize",  fee_rate_bps: "feeRateBps"
};
```
A transformação é recursiva: `o()` percorre todo o objeto decodificado e
aplica o mapping, inclusive em arrays aninhados de `priceChanges`.

**Filtro de subscrição:** O PolymarketStreamer filtra símbolos com sufixo
`_PM`. O EarningsStreamer filtra com `_earnings` (case-insensitive,
`indexOf("_earnings") > -1`).

**Protocolo de mensagem WebSocket:**
- Subscribe: `JSON.stringify({subscribe: ["AAPL", "MSFT"]})`
- Unsubscribe: `JSON.stringify({unsubscribe: ["AAPL"]})`
- Mensagem recebida: `{"type": "pricing"|"earnings"|"polymarket", "message": "<base64>"}`

**Mapeamento de fields** (do worker):

| Campo Protobuf | Campo mapeado | Contexto |
|----------------|---------------|----------|
| `id` | `symbol` | Identificador |
| `dayVolume` | `volume` | Volume |
| `dayHigh` | `high` | Máxima |
| `dayLow` | `low` | Mínima |
| `marketcap` | `marketCap` | Market cap |
| `marketHours` | `marketState` | Estado do mercado |
| `openPrice` | `regularMarketOpen` | Abertura |
| `fromcurrency` | `fromCurrency` | Crypto |
| `vol_24hr` | `volume24Hr` | Volume 24h |
| `volAllCurrencies` | `volumeAllCurrencies` | Volume total |

**Campo seeding extra (não-ProtoBuf):** `toCurrency` é solicitado no seeding
REST (`v7/finance/quote`) mas não existe no schema Protobuf `PricingData`.
Provavelmente é um campo calculado ou retornado apenas pelo REST.

**Market hours mapping:**
- `PRE_MARKET` → prefix `preMarket`, valor `PRE`
- `REGULAR_MARKET` → prefix `regularMarket`, valor `REGULAR`
- `POST_MARKET` → prefix `postMarket`, valor `POST`
- `EXTENDED_HOURS_MARKET` → prefix `extendedMarket`, valor `EXTENDED`
- `OVERNIGHT_MARKET` → prefix `overnightMarket`, valor `OVERNIGHT`

**Reconnection logic:**
```javascript
// Max 10 retries
if (this.retries > 10)
    throw new Error("retries exceeded");
// Exponential backoff on ECONNREFUSED or non-1000 close code
```

**Seeding de dados:** O `QuoteStreamer` faz fallback para REST
(`query1.finance.yahoo.com/v7/finance/quote`) para preencher dados de
timezone quando o WebSocket não fornece. O seeding ocorre apenas para
símbolos que ainda não possuem `exchangeTimezoneName` (filtro explícito).

**Campos solicitados no seeding:**
`currency`, `fromCurrency`, `toCurrency`, `exchangeTimezoneName`,
`exchangeTimezoneShortName`, `gmtOffSetMilliseconds`, `regularMarketChange`,
`regularMarketChangePercent`, `regularMarketPrice`, `regularMarketTime`,
`preMarketChange`, `preMarketChangePercent`, `preMarketPrice`, `preMarketTime`,
`priceHint`, `postMarketChange`, `postMarketChangePercent`, `postMarketPrice`,
`postMarketTime`, `extendedMarketChange`, `extendedMarketChangePercent`,
`extendedMarketPrice`, `extendedMarketTime`, `overnightMarketChange`,
`overnightMarketChangePercent`, `overnightMarketPrice`, `overnightMarketTime`

> `toCurrency` é um campo não documentado anteriormente.

O parâmetro `&formatted=` é controlado por `useFormattedSeeding` (5º argumento
do construtor, default `false`), passado pelo main thread como `formattedSeeding`.

**Comunicação direta Streamer ↔ Portfolio Worker:**
O QuoteStreamer (`class d`) recebe um `pfMessagePort` como 3º argumento do
construtor. Toda atualição de `quoteData` é enviada simultaneamente para:
1. `this.messagePort` → Main thread (UI)
2. `this.pfMessagePort` → Portfolio Worker (cálculos)

O `pfMessagePort` é conectado via comando `init-qpf` no message handler do
worker. Isso significa que Portfolio Worker e Streamer Worker se comunicam
**diretamente**, sem passar pelo main thread.

#### 4.2.2 UI Web Component (`streamer.6dd62afba71e23928463.mjs` — 56 KB)

Este bundle contém dois módulos principais:

**Module 1386 — `FinStreamer` Web Component:**
```javascript
class FinStreamer extends HTMLElement {
    static get observedAttributes() {
        return ["data-symbol", "data-field", "data-stream"];
    }
    connectedCallback() { /* IntersectionObserver */ }
    disconnectedCallback() { /* cleanup subscription */ }
    attributeChangedCallback(name, oldVal, newVal) { /* resubscribe */ }
}
```

Comportamento detalhado:
- **IntersectionObserver**: elemento só se inscreve no streamer quando está
  visível na viewport. Ao sair da tela, faz unsubscribe automático.
- **`data-symbol`**: símbolo do ativo (ex: `"AAPL"`)
- **`data-field`**: campo a exibir (ex: `"regularMarketPrice"`)
- **`data-stream`**: se `"true"`, ativa atualização em tempo real via WebSocket
- **Eventos emitidos**:
  - `finWebCore_priceChange` — com `{symbol, oldValue, newValue, changePercent}`
  - `finWebCore_streamerDataUpdated` — quando dados do streamer chegam
  - `finWebCore_streamerStatus` — conectado/desconectado/reconectando
- **Animação de preço**: usa CSS transitions com cores `--finc-positive` (verde),
  `--finc-negative` (vermelho), `--finc-neutral` (cinza). O componente pisca
  brevemente na cor correspondente à direção da mudança.

**Module 477 — Inline Web Worker Creator:**
```javascript
// Cria o worker streamer inlining o código do streamer.worker.mjs
// Usa Blob URL para evitar fetch externo
const workerCode = `...conteúdo do worker...`;
const blob = new Blob([workerCode], { type: "application/javascript" });
const workerUrl = URL.createObjectURL(blob);
const worker = new Worker(workerUrl);
```

**CSS Tokens System:**
O bundle define um sistema de tokens CSS via custom properties:
```css
--finc-positive: #1a8c41;     /* Verde Yahoo Finance */
--finc-negative: #c0392b;    /* Vermelho Yahoo Finance */
--finc-neutral: #666666;     /* Cinza */
--finc-positive-bg: rgba(26, 140, 65, 0.08);
--finc-negative-bg: rgba(192, 57, 43, 0.08);
--finc-price-font-size: 20px;
--finc-price-font-weight: 700;
```

### 4.3 Portfolio Worker

**Comunicação inter-worker:** O Portfolio Worker recebe atualizações de
cotações em tempo real **diretamente do Streamer Worker** via um
`MessagePort` dedicado (conectado pelo comando `init-qpf` no handler do
streamer worker). Isso permite que os cálculos de portfolio sejam
atualizados sem passar pelo main thread, reduzindo latência.

**Endpoint REST usado:**
```
GET https://query2.finance.yahoo.com/v7/finance/desktop/portfolio
Params: formatted=false, fields=quoteType,regularMarketPrice,...
        &crumb=...&userId=...&includeBetaVersion=1&lotCount=10
        &userIdType=guid&lang=en-US&region=US
```

**Campos solicitados pelo portfolio:**
```javascript
const a = ["quoteType","regularMarketPrice","regularMarketChange",
           "regularMarketChangePercent","currency"];
const r = ["annualGainPercentage","currentMarketValue","dailyGain",
           "purchasedMarketValue","totalGain"];
const s = [...r, "dailyPercentGain", "totalPercentGain"];
```

**Fórmulas de cálculo** (extraídas do worker):

| Fórmula | Cálculo real |
|---------|--------------|
| `currentMarketValue` | `quantity * price / exchangeRate` |
| `dailyGain` | `quantity * change / exchangeRate` |
| `totalGain` | `quantity * (price - purchasePrice) / exchangeRate` |
| `totalPercentGain` | `(totalGain / abs(marketValue - totalGain)) * 100` |
| `dailyPercentGain` | `(dailyGain / abs(marketValue - dailyGain)) * 100` |
| `purchasedMarketValue` | `abs(quantity) * purchasePrice / exchangeRate` |
| `annualGain` | `(price/purchasePrice)^(365/daysHeld) - 1` |

**Polling:** REST a cada 30s (streaming ativo) ou 15s (sem streaming).

### 4.4 Search & Screener (`finSearch.modern.js`)

**Observado:**

Endpoints REST:
```javascript
const o = {
    stage: ["https://iquery-stage.finance.yahoo.com"],
    prod: ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]
};
const n = "/v1/finance/search";           // Search
const i = "/v1/finance/trending";         // Trending
const r = "/v1/finance/stockstories/top-weekly-high-quality-tickers"; // Top picks
const l = "/v1/finance/screener/predefined/saved"; // Screener
```

**Modos de busca:**
- `all` (default): quotes + news + nav + lists
- `researchReports`: quotes + news + nav + research + lists
- `quote`: apenas quotes

**Configuração de query por modo:**
```javascript
const E = {
    all: {
        quotesCount: 6, newsCount: 4,
        quotesQueryId: "tss_match_phrase_query",
        multiQuoteQueryId: "multi_quote_single_token_query",
        newsQueryId: "news_cie_vespa",
        enableFuzzyQuery: false,
        // ...
    },
    researchReports: { quotesCount: 6, newsCount: 3, listsCount: 2, ... },
    quote: { quotesCount: 8, enableNews: false, ... }
};
```

**Categorias de seções da busca:**
```javascript
const S = {
    quotes: { title: "SYMBOLS" },
    news: { title: "NEWS" },
    lists: { title: "LISTS" },
    researchReports: { title: "RELATED_RESEARCH" },
    recommend: { title: "TRENDING" },
    stockStory: { title: "STOCKSTORY_TOP_PICKS" },
    cryptoCoinbase: { title: "TOP_CRYPTO_FROM_COINBASE" },
    cryptoTrending: { title: "TRENDING_CRYPTO" },
    screenerFieldResults: { title: "HOLDERS" }
};
```

### 4.5 Quote Summary (`quoteSummary.68a66e32992e50724401.js` — 143 KB)

**Observado:** bundle que implementa os módulos do quoteSummary como
componentes customizados. Usa `v10/finance/quoteSummary` via REST.

**Componentes customizados detectados:**
- `fin-marketnotice`: exibe avisos de mercado (ex-dividend, ex-date, etc.)
- `fin-prepost`: exibe preços pre/post market com indicador de mudança
- `fin-chart-marker`: marcadores de eventos no chart (dividendos, splits)
- `fin-data-table`: tabela de dados fundamentalistas com formatação condicional

**Sistema de formatação (WeakMap cache):**
```javascript
// Todos os formatadores são cacheados via WeakMap para performance
const currencyFormatterCache = new WeakMap();
const numberFormatterCache = new WeakMap();
const percentFormatterCache = new WeakMap();

function getCurrencyFormatter(locale, currency) {
    if (!currencyFormatterCache.has(locale)) {
        currencyFormatterCache.set(locale, new Map());
    }
    const localeCache = currencyFormatterCache.get(locale);
    if (!localeCache.has(currency)) {
        localeCache.set(currency,
            new Intl.NumberFormat(locale, {
                style: "currency", currency,
                minimumFractionDigits: 2, maximumFractionDigits: 6
            })
        );
    }
    return localeCache.get(currency);
}
```

**Timezone helpers:**
```javascript
// Offset em minutos (ex: -240 para EDT)
function getTimezoneOffset(shortName) {
    const map = {
        "EDT": -240, "EST": -300,
        "CDT": -300, "CST": -360,
        "MDT": -360, "MST": -420,
        "PDT": -420, "PST": -480,
        "GMT": 0, "UTC": 0,
        "BST": 60, "CET": 60, "CEST": 120
    };
    return map[shortName] ?? 0;
}
```

**Custom Elements polyfill:** o bundle inclui polyfill para navegadores que
não suportam Custom Elements v1 (IE11 legacy).

### 4.7 HTML Page Analysis — Homepage Runtime Data

Duas páginas foram analisadas: a página de quote (`finance.yahoo.com/quote/AAPL`) e
a página inicial (`finance.yahoo.com`). A homepage é construída com SvelteKit e
contém configuração runtime inline, asset manifests com hashes modern/legacy,
múltiplos `data-sveltekit-fetched` com respostas reais das APIs, e o crumb exposto.

#### 4.7.1 Homepage (`finance.yahoo.com` — 1.5 MB)

**Crumb exposto:** `NsdJHpXH.Nl` (confirmado em `YAHOO.context.user.crumb` e
na resposta do `v1/test/getcrumb` via `data-sveltekit-fetched`).

**Servidores internos descobertos:**
- `ypf-gateway.finance.yahoo.com` — YPF Gateway (API gateway interno)
- `yfc-server-query.finance.yahoo.com` — Community server query
- `yfc-media.finance.yahoo.com` — Community media assets

**Endpoints chamados em tempo real** (confirmados via `data-sveltekit-fetched`):

| Endpoint | Propósito | Resposta inclui |
|----------|-----------|-----------------|
| `GET /xhr/config?name=services` | Mapeamento de hosts internos | 6 servidores (query1, query2, ypf-gateway, yfc-server, yfc-media, etc.) |
| `GET /xhr/config?name=pages` | Configuração de páginas | Ads, newsletters, módulos habilitados por página |
| `GET /xhr/config?name=header` | Header global | Links, dropdowns, user menu config |
| `GET /xhr/config?name=ads` | Posições de anúncios | DFP slots, ad unit paths |
| `GET /xhr/cds?*` | Content Delivery Service | Dados editoriais (homepage, subnav, footerTopics, partnerDropdown) |
| `GET /v6/finance/markettime` | Status do mercado | Aberto/fechado, timezone atual |
| `GET /v7/finance/spark` | Sparklines multi-symbol | Sparkline data para múltiplos tickers |
| `GET /v7/finance/quote` | Cotações rápidas | Múltiplas chamadas com diferentes símbolos |
| `GET /v6/finance/quote/marketSummary` | Resumo de mercado | Índices e setores |
| `GET /v1/finance/trending/US` | Trending tickers | Tickers mais buscados |
| `GET /ws/obi-integration/v1/premiumTiersMeta` | Tiers de assinatura | Mapeamento feature → tier mínimo |
| `GET /xhr/member-profile` | Perfil do usuário | Dock config, watchlist info |

**Formato `data-sveltekit-fetched`:**
```html
<script data-sveltekit-fetched data-url="/v6/finance/markettime?...">
  {"type":"data","data":{...},"status":200}
</script>
```
- Elemento `<script>` com atributo `data-sveltekit-fetched`
- `data-url` contém o endpoint chamado (com params reais)
- Conteúdo JSON: `{"type":"data","data":<response body>,"status":<http status>}`

#### 4.7.2 Quote page (`finance.yahoo.com/quote/AAPL`)

A página de quote contém:

**Inline quote data (script `root.App.main`):**
```javascript
root.App.main = {
    context: {
        dispatcher: {
            stores: {
                QuoteStore: {
                    AAPL: {
                        symbol: "AAPL",
                        regularMarketPrice: 232.45,
                        regularMarketChange: 1.23,
                        regularMarketChangePercent: 0.53,
                        regularMarketVolume: 48567234,
                        trendingScore: 8.5,
                        shortName: "Apple Inc.",
                        longName: "Apple Inc.",
                        quoteType: "EQUITY",
                        market: "us_market",
                        marketState: "REGULAR",
                        exchange: "NMS",
                        exchangeTimezoneShortName: "EDT",
                        gmtOffSetMilliseconds: -14400000,
                        // ...
                    }
                }
            }
        }
    }
};
```

**Schema JSON-LD:**
```json
{
    "@context": "https://schema.org",
    "@type": ["WebApplication", "WebSite"],
    "name": "Yahoo Finance",
    "url": "https://finance.yahoo.com",
    "applicationCategory": "FinanceApplication",
    "operatingSystem": "All"
}
```

**Outros scripts carregados:**
- `https://s.yimg.com/uc/finance/webcore/js/_staticFinProtobuf.*.mjs`
- `https://s.yimg.com/uc/finance/webcore/js/streamer.6dd62afba71e23928463.mjs`
- `https://s.yimg.com/uc/finance/webcore/js/quoteSummary.68a66e32992e50724401.js`
- `https://s.yimg.com/uc/finance/webcore/js/marketSummary.ed61671e0327b67d6b94.js`
- `https://s.yimg.com/uc/finance/webcore/js/finSearch.modern.js`
- Google Analytics / Floodlight tags

### 4.8 Market Summary (`marketSummary.ed61671e0327b67d6b94.js` — 191 KB)

**Observado:** bundle contendo pipeline de renderização de sparklines e
charts do Market Summary.

**Pipeline de fetch (`fetchChartData`):**
```javascript
function fetchChartData(params) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `https://query1.finance.yahoo.com/v8/finance/chart/${params.symbol}` +
        `?period1=${params.period1}&period2=${params.period2}` +
        `&interval=${params.interval}&events=div,splits`);
    xhr.withCredentials = true;
    xhr.onload = () => {
        const data = JSON.parse(xhr.responseText);
        // Extrai timestamps e close prices
        const timestamps = data.chart.result[0].timestamp;
        const closes = data.chart.result[0].indicators.quote[0].close;
        renderSparkline(timestamps, closes, params.canvas);
    };
    xhr.send();
}
```

**DateRange enum:** `"1D"`, `"5D"`, `"1M"`, `"3M"`, `"6M"`, `"1Y"`, `"2Y"`, `"5Y"`, `"MAX"`.

**D3 v7 functions usadas:**
```javascript
// Scales
d3.scaleLinear, d3.scaleTime, d3.scaleUtc
// Extent
d3.extent(timestamps), d3.extent(closes)
// Bisector
d3.bisectLeft, d3.bisectRight
// Ticks
d3.ticks(min, max, count), d3.tickStep
// Format
d3.timeFormat("%b %d"), d3.format(".2f")
```

**Sparkline rendering (função `S1`):**
1. Cria canvas element (off-screen)
2. Aplica D3 linear scales: x = `scaleLinear(timestamps, [0, width])`,
   y = `scaleLinear(closes, [height, 0])`
3. Desenha path via `CanvasRenderingContext2D`
4. Adiciona tooltip na posição do mouse via bisector
5. Retorna o canvas como data URL ou insere no DOM

**Svelte runtime:** o bundle contém funções do compilador Svelte (schedule,
flush, effect, etc.), indicando que componentes Svelte são compilados para
cada entry point e incluídos neste bundle. Features detectadas:
- `schedule_update`, `flush`, `effect`, `render_effect`, `teardown`
- `template` (html tagged template literal), `add_location`
- `bind`, `class`, `style` directives pré-compiladas

### 4.9 YAHOO.context — Configuração Runtime

**Extraído do HTML inline `<script>` da página Yahoo Finance.**

O objeto `window.YAHOO.context` é injetado inline no `<head>` de toda página.
Contém a configuração completa do runtime do frontend.

**Estrutura principal observada:**
```javascript
YAHOO.context = {
    authed: "0",                    // Não autenticado
    site: "finance",
    device: "desktop",
    ecma: "modern",                 // Capacidade JS
    environment: "prod",
    colo: "bf1",                    // Datacenter (Ashburn?)
    browser: "chrome",
    lang: "en-US",
    region: "US",
    usercountry: "BR",              // País real do usuário (via IP)
    tz: "America/Maceio",
    gdpr: false,                    // Fora da UE
    gucJurisdiction: "BR",
    network: "broadband",
    bot: "0",
    time: 1784889456354,            // Timestamp servidor (ms)
    clientVersion: "0.1.13840.1784852480",
    theme: "auto",
    user: {
        age: -2147483648,           // INT32_MIN — desconhecido
        crumb: "cyTGwg2dwqw",       // ← CRUMB exposto diretamente!
        firstName: null,
        gender: "",
        year: 0
    },
    searchCrumb: "cyTGwg2dwqw",     // Mesmo valor do crumb
    consent: { /* 10+ flags de consentimento */ },
    bucket: [                       // A/B test buckets ativos
        "yfrun-screeners-nls-prod",
        "ay-growthcode-test",
        "yf-article-chat-release",
        "yf-homepage-v2-nexus-gateway-test",
        "yf-web-bkt-pushly",
        "AlphaSpaceWordMark_AND_UpgradeToPremium",
        "disabled_modal",
        "cg-phase6a-external-treatment",
        "yfqsp-financials-1",
        "yfqsp-options-1",
        "finance-web-ga-test"
    ],
    feature: { /* 200+ feature flags */ }
};
```

**Crumb exposto no HTML:** Diferente do yfinance Python que obtém o crumb via
endpoint `/v1/test/getcrumb`, o frontend simplesmente lê de
`YAHOO.context.user.crumb` injetado inline. O `searchCrumb` é idêntico.

**Crumb observados em runtime:**
- `cyTGwg2dwqw` (página de quote, Jul 2026)
- `NsdJHpXH.Nl` (homepage, Jul 2026 — também confirmado via `/v1/test/getcrumb`)

O crumb é efêmero: varia por sessão e possivelmente por página. A homepage
confirmou que o valor em `YAHOO.context.user.crumb` corresponde exatamente
ao retorno do endpoint `/v1/test/getcrumb` (verificado via
`data-sveltekit-fetched`).

**Consent flags:**
```javascript
consent: {
    allowContentPersonalization: true,
    allowCrossDeviceMapping: true,
    allowFirstPartyAds: true,
    allowSellPersonalInfo: true,
    canEmbedThirdPartyContent: true,
    canSell: true,
    allowAds: true,
    rejectedAllConsent: false
}
```

**Feature flags (seleção):** O campo `feature` contém 200+ flags:

| Categoria | Exemplos |
|-----------|----------|
| QSP | `enableQSPChartEarnings`, `enableQSPAiAnalystSheet`, `enableQSPCryptoLogo`, `enableQSPStockPicks`, `enableQSPNewOptionsLeaf`, `enableQSPQuoteHeaderV2`, `enableQSPPriceInsightsAnomaly` |
| Charts | `enablePfStreaming`, `enableOvernight`, `enableTransparentChart`, `enableQSPChartNewShading`, `enableQSPChartRangeTooltips` |
| AI | `enableTickerAIInsights`, `enableQSPAiAnalystSheetChatVersionV11`, `enableDigDeeperArticleChat`, `enableAIHub`, `enableEarningsTranscriptAI` |
| Community | `enableQSPCommunityService`, `enableCommunityMuteUser`, `enableQSPCommunityFeedTabs` |
| Screeners | `enableEnhancedScreeners`, `enableScreenerCustomColumns`, `enableScreenersNaturalLanguageSearch`, `enableScreenersDownload`, `enableScreenerHeatMap` |
| Portfolio | `enableNeoBasicPFs`, `enableDockPortfolioControl`, `enablePfPremium`, `enablePfStreaming`, `enableImportCSVReview` |
| Premium | `enablePfPremium`, `enablePlus`, `enableSubsGoldTrial`, `enableAlphaSpaceCTA`, `enableAlphaSpaceL2` |
| Design | `enableNeoGreen`, `enableDarkMode`, `enableMetaLabDesignHeader`, `enableMetaLabDesignDock` |
| Ads | `enableGoogleAnalytics`, `enableAdRefresh20s`, `enableChartbeat`, `enableGA4CompositeId` |
| Other | `enableCrumbRefresh`, `enableFollow`, `enableRecentQuotes`, `enableMultiQuote`, `enableCurrencyConverter`, `enable24HourCrypto` |

> A flag `enableCrumbRefresh` confirma que o frontend tem mecanismo de refresh
> de crumb — funcionalidade não exposta no yfinance Python.

### 4.10 finWebCore — Asset Loading System

Sistema bootstrap principal que gerencia carregamento de todos os módulos JS.

**Inicialização:**
```javascript
window.finWebCore = function r(e) {
    return {
        crumb: n,
        lang: a,       // "en-US"
        region: u,     // "US"
        features: c,
        throttle: { "quote": 200 },  // 200ms throttle
        store: {},
        intl: u.toLowerCase(),
        strings: f,
        assets: prodAssets,
        addScriptTag(url, attrs, callback) { ... },
        addAsset(name, options) { ... },
        reset() { ... }
    }
}({...});
```

**Manifesto de assets (produção):**

| Asset | Modern (`.mjs`) | Legacy (`.js`) |
|-------|-----------------|-----------------|
| `_staticFinProtobuf` | `4ac0aa7cd811394598dc` | `4ac0aa7cd811394598dc` *(mesmo hash)* |
| `chart` | `4af97cf348f0fb4285bc` | `cc24a2b90efb8c04f483` |
| `cryptoTrade` | `90069b540b1d7f607ff2` | `417fa9618f3a8fea6d8d` |
| `finIcon` | `303dcbfc0a8c9e028f3e` | `c0a0f64c3dae0298f8c9` |
| `finPlaidLink` | `de3213e8aacc81c3802a` | `9b25afa3f1d4e6b4acaa` |
| `finPushly` | `afe07c4d239cd2c6071d` | `8986a27b38197560692c` |
| `marketSummary` | `18341e4515c27be02c47` | `ed61671e0327b67d6b94` |
| `portfolio` | `1a460d914f65dc3f7103` | `a3456cbda2b01102e175` |
| `quoteSummary` | `1be372cc8a25ac597f40` | `68a66e32992e50724401` |
| `streamer` | `6dd62afba71e23928463` | `26ed6a48afdaf9da9443` |
| Workers | `streamer.worker.f3908...` | `streamer.worker.b2e9...` |
| | `portfolio.worker.ce3e...` | `portfolio.worker.7882...` |

**CDN base:** `https://s.yimg.com/uc/finance/webcore/js/`

**Dependências externas (CDN):**
- Protobuf.js: `https://cdn.jsdelivr.net/npm/protobufjs@7.1.2/dist/minimal/protobuf.min.js`
- Benji (ads): `https://s.yimg.com/du/benji/benji-2.3.312.js`
- CMP: `https://consent.cmp.oath.com/version/7.0.2/cmp.js`
- Consent.js: `https://s.yimg.com/oa/consent.js`

### 4.11 Privacy & Consent Framework

Três frameworks de privacidade implementados via stubs no HTML:

**TCF v2** (Transparency and Consent Framework):
```javascript
window.__tcfapi(command, version, callback, parameter)
```
- Cria iframe `__tcfapiLocator` para cross-frame communication
- Suporta `ping`, `setGdprApplies`; enfileira comandos até CMP carregar

**GPP v1.1** (Global Privacy Platform):
```javascript
window.__gpp(command, callback, parameter)
```
- 12 APIs: `tcfeuv2`, `tcfcav1`, `uspv1`, `usnatv1`, `uscav1`, `usvav1`, etc.
- Status: `cmpStatus: "stub"`, `signalStatus: "not ready"`

**USP API** (CCPA):
```javascript
window.__uspapi(command, version, callback, parameter)
```
- Implementação stub com enfileiramento

> São stubs que enfileiram comandos até `consent.cmp.oath.com/cmp.js` carregar.
> O yfinance Python não implementa nenhum framework de consent.

### 4.12 Runtime Endpoints (Homepage HTML)

Endpoints confirmados como ativos via análise da página inicial do Yahoo Finance.
Estes endpoints são chamados durante o carregamento da homepage e seus dados
são serializados inline via `data-sveltekit-fetched`.

#### 4.12.1 XHR Config Service

Base: `GET /xhr/config?name={configName}`

| Config | Conteúdo |
|--------|----------|
| `services` | Mapeamento de hosts: `query1`, `query2`, `ypf-gateway`, `yfc-server-query`, `yfc-media`, `fc.yahoo.com` |
| `pages` | Config de páginas: `[goldHomepage, filogold, news, profile, research, scout, analysis]` + ads + newsletters |
| `header` | Header global: links, dropdown labels, user menu itens |
| `ads` | DFP (Google Ad Manager) slots: `[leaderboard, medrec, footer, skin, mobile_leaderboard, mobile_medrec]` |

#### 4.12.2 CDS (Content Delivery Service)

Base: `GET /xhr/cds?{query}`

Serviço que entrega conteúdo editorial estruturado para a página:
- `editorialHomepage` — artigos e cards da homepage
- `subnav` — links de subnavegação
- `partnerDropdown` — parceiros
- `footerTopics` — tópicos do footer

Resposta típica: JSON com `{data: {modules: [{type, title, items}]}}`.

#### 4.12.3 PremiumTiersMeta

**Endpoint:** `GET /ws/obi-integration/v1/premiumTiersMeta`

**Propósito:** Mapeamento de quais features do Yahoo Finance exigem qual tier
mínimo de assinatura. Usado pelo frontend para mostrar/ocultar elementos de UI.

**Resposta (formato inferido):**
```json
{
  "tiers": [
    {"id": 0, "name": "free"},
    {"id": 4, "name": "bronze"},
    {"id": 5, "name": "silver"},
    {"id": 6, "name": "gold"}
  ],
  "featureTierMap": {
    "workspace": 6,
    "communityInsights": 4,
    "premiumScreeners": 6,
    "advancedChart": 5,
    "aiAnalyst": 6,
    "portfolioAnalytics": 5,
    "marketDepth": 6,
    "level2Data": 6
  }
}
```

#### 4.12.4 YPF Gateway

**Base:** `ypf-gateway.finance.yahoo.com`

Gateway de API interno descoberto via `xhr/config?name=services`. Provavelmente
faz proxy para microserviços internos não expostos diretamente ao público.

#### 4.12.5 Community Service

- **Query:** `yfc-server-query.finance.yahoo.com`
- **Media:** `yfc-media.finance.yahoo.com`

Serviço de comunidade do Yahoo Finance (comentários, posts, interações sociais
em ativos financeiros). O frontend tem feature flags específicas:
`enableQSPCommunityService`, `enableCommunityMuteUser`, `enableQSPCommunityFeedTabs`.

---

## 5. Fluxos End-to-End

### 5.1 Fluxo de Streaming (Quote)

```
Browser UI (fin-streamer element)
    |
    | IntersectionObserver detecta elemento visível
    | Lê atributos data-symbol="AAPL" data-field="regularMarketPrice"
    |
    v
Streamer Main Thread (streamer.6dd62afba71e23928463.mjs)
    |
    | Cria MessageChannel, envia cmd:"init" para worker
    |
    v
Streamer Worker (streamer.worker.f3908d5612a4e787ca3a.worker.mjs)
    |
    | 1. importScripts protobufjs + _staticFinProtobuf
    | 2. Conecta WebSocket a wss://streamer.finance.yahoo.com/?version=2
    | 3. Envia: {"subscribe": ["AAPL", "MSFT", ...]}
    |
    v
Yahoo Finance Server
    |
    | Envia frame WebSocket: {"type":"pricing","message":"<base64>"}
    |
    v
Worker decode pipeline:
    1. base64 -> Uint8Array (via atob + charCodeAt)
    2. PricingData.decode(bytes)
    3. PricingData.toObject(result, {enums: String})
    4. Mapeia fields (id->symbol, dayVolume->volume, etc.)
    5. PostMessage para main thread: {subscriberType:"quote", quoteData:{...}}
    |
    v
Browser UI atualiza o elemento <fin-streamer>
```

### 5.2 Fluxo de Portfolio

```
Portfolio Worker (portfolio.worker.mjs)
    |
    | Recebe cmd:"init" com MessagePort
    |
    v
    | GET query2.finance.yahoo.com/v7/finance/desktop/portfolio
    |   ?formatted=false&fields=quoteType,regularMarketPrice,...
    |   &crumb=...&userId=...&includeBetaVersion=1&lotCount=10
    |
    v
    | Parse response: finance.result[0].portfolios[]
    |   Cada portfolio: pfId, baseCurrency, cashPosition, positions[{symbol, lots}]
    |
    v
    | Calcula para cada lot:
    |   currentMarketValue = qty * price / rate
    |   dailyGain = qty * change / rate
    |   totalGain = qty * (price - purchasePrice) / rate
    |   annualGain = (price/purchasePrice)^(365/daysHeld) - 1
    |
    v
    | Aggrega por portfolio e total
    |
    v
    | Envia subscribe para Main Thread → Streamer Worker
    | Streamer Worker envia quoteData diretamente via pfMessagePort (init-qpf)
    | ──── Direct inter-worker communication (sem passar pelo main thread) ────
    |
    v
    | Recebe atualizações em tempo real via onStreamerMessage
    | Recalcula a cada 500ms (debounced)
    |
    v
    | PostMessage para main thread: resultados calculados
```

### 5.3 Fluxo de Search

```
Browser
    |
    | Input do usuário: "AAPL"
    |
    v
finSearch.modern.js
    |
    | GET query1.finance.yahoo.com/v1/finance/search
    |   ?q=AAPL
    |   &quotesCount=6&newsCount=4
    |   &quotesQueryId=tss_match_phrase_query
    |   &newsQueryId=news_cie_vespa
    |   &enableFuzzyQuery=false
    |   &enableCb=true&enableNavLinks=true
    |   &enableCulturalAssets=true&enableLogoUrl=true
    |   &enableLists=false
    |
    v
Resposta JSON
    {
      "quotes": [{"symbol":"AAPL","shortname":"Apple Inc.",...}],
      "news": [...],
      "lists": [],
      "nav": [{"title":"Finance","url":"https://finance.yahoo.com"}],
      "researchReports": [],
      "totalCount": 1
    }
    |
    v
Renderiza seções (quotes, news, nav)
```

### 5.4 Fluxo de Price History (yfinance)

```
Python: Ticker("AAPL").history(period="1y")
    |
    v
TickerBase.history()
    |
    v
PriceHistory.history()
    |
    | GET query2.finance.yahoo.com/v8/finance/chart/AAPL
    |   ?period1=...&period2=...&interval=1d
    |   &includePrePost=false&events=div,splits,capitalGains
    |
    v
Resposta JSON chart
    {
      "chart": {
        "result": [{
          "meta": {"currency":"USD","exchangeName":"NMS",...},
          "timestamp": [...],
          "indicators": {
            "quote": [{"open":[...],"high":[...],"low":[...],"close":[...],"volume":[...]}],
            "adjclose": [{"adjclose":[...]}]
          },
          "events": {"dividends":{...},"splits":{...}}
        }]
      }
    }
    |
    v
Converte para pandas DataFrame com colunas:
    Open, High, Low, Close, Volume, Dividends, Stock Splits
```

---

## 6. Mapa Completo da Arquitetura

### 6.1 Diagrama de Camadas (Python yfinance)

```
┌──────────────────────────────────────────────────────────────────┐
│                    USER / CLIENT LAYER                           │
│                                                                  │
│  Ticker("AAPL")   Tickers(["AAPL","MSFT"])   Search("Apple")    │
│  Screener("day_gainers")   Market("US")       Calendars()       │
│  Sector("technology")      Industry("semiconductors")           │
└────────────────────────┬─────────────────────────────────────────┘
                         │
┌────────────────────────v─────────────────────────────────────────┐
│                   BUSINESS LOGIC LAYER                           │
│                                                                  │
│  TickerBase (base.py)    │   Ticker (ticker.py)                  │
│    ├── _lazy_load_price_history()                                 │
│    ├── _get_ticker_tz() ──→ cache.get_tz_cache()                │
│    ├── get_news() ──────→ POST /xhr/ncp                         │
│    ├── get_earnings_dates()                                      │
│    │     ├── [main]  _get_earnings_dates_using_scrape()          │
│    │     │           └── GET /calendar/earnings (HTML scrape)    │
│    │     └── [depr]  _get_earnings_dates_using_screener()        │
│    │                 └── POST /v1/finance/visualization          │
│    ├── get_isin() ──→ Business Insider AJAX                     │
│    └── get_funds_data() ──→ FundsData(quoteSummary)             │
│                                                                  │
│  Tickers (tickers.py) ──→ multi.download()                      │
│  multi.py ──→ _DownloadCtx ──→ multitasking (thread pool)       │
│  Screener (screener.py) ──→ POST /v1/finance/screener           │
│  Calendars (calendars.py) ──→ POST /v1/finance/visualization    │
│  Market (domain/market.py) ──→ GET /v6/finance/quote/marketSummary│
│  Sector (domain/sector.py) ──→ GET /v1/finance/sectors/{key}    │
│  Industry (domain/industry.py) ──→ GET /v1/finance/industries/{k}│
└────────────────────────┬─────────────────────────────────────────┘
                         │
┌────────────────────────v─────────────────────────────────────────┐
│                   DATA ACCESS LAYER                              │
│                                                                  │
│  YfData (data.py) ── singleton ── thread-safe                   │
│    ├── _http.py ── HTTP backend (curl_cffi / requests)          │
│    ├── cache.py ── TzCache (SQLite via peewee) + CookieCache    │
│    └── Auth class ── login T/Y cookies + subscription tiers     │
│                                                                  │
│  Scrapers:                                                       │
│    quote.py ── v10/quoteSummary + v7/quote + fundamentals-timeseries│
│    history.py ── v8/finance/chart                                │
│    fundamentals.py ── ws/fundamentals-timeseries                 │
│    holders.py ── v10/quoteSummary (7 modules)                    │
│    analysis.py ── v10/quoteSummary modules                       │
│    funds.py ── v10/quoteSummary modules                          │
└────────────────────────┬─────────────────────────────────────────┘
                         │
┌────────────────────────v─────────────────────────────────────────┐
│                   AUTH / TRANSPORT LAYER                         │
│                                                                  │
│  Cookie/Crumb System ── dual strategy (basic / csrf)            │
│    ├── GET https://fc.yahoo.com                                  │
│    ├── GET guce.yahoo.com/consent + POST consent/v2/collectConsent│
│    └── GET {query1|query2}/v1/test/getcrumb                     │
│                                                                  │
│  WebSocket (live.py) ── wss://streamer.finance.yahoo.com        │
│    └── protobuf decode: PricingData.ParseFromString()            │
│                                                                  │
│  HTTP: YfData.get() / .post() / .cache_get()                    │
│    └── Injeção automática de crumb + retry + toggle estratégia  │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Diagrama de Camadas (Frontend JS)

```
┌──────────────────────────────────────────────────────────────────┐
│                   BROWSER MAIN THREAD                            │
│                                                                  │
│  YAHOO.context (config inline) ── crumb, lang, region, features │
│  finWebCore ── asset loader (22 modules)                        │
│                                                                  │
│  Web Components:                                                 │
│    <fin-streamer> ── data-symbol, data-field, data-stream        │
│      ├── IntersectionObserver (lazy subscribe)                   │
│      ├── finWebCore_* events (priceChange, streamerDataUpdated)  │
│      └── CSS tokens (--finc-positive, --finc-negative)          │
│                                                                  │
│    <fin-marketnotice> ── avisos de mercado                       │
│    <fin-prepost> ── preços pre/post market                       │
│    <fin-chart-marker> ── eventos no chart                        │
│                                                                  │
│  Privacy Stubs: __tcfapi, __gpp, __uspapi                       │
└────────────────────────┬─────────────────────────────────────────┘
                         │ MessageChannel (port)
┌────────────────────────v─────────────────────────────────────────┐
│                   WEB WORKERS (separate threads)                 │
│                                                                  │
│  Streamer Worker (streamer.worker.*.mjs)                         │
│    ├── importScripts protobufjs@7.1.2 (CDN)                      │
│    ├── importScripts _staticFinProtobuf (schema CDN)             │
│    ├── WebSocket → wss://streamer.finance.yahoo.com              │
│    ├── class s (BaseConnection)                                  │
│    ├── class d (QuoteStreamer) ── PricingData decode+transform   │
│    ├── class n (EarningsStreamer) ── EarningSignals decode       │
│    ├── class a (PolymarketStreamer) ── MarketEvent decode        │
│    └── Seed via GET /v7/finance/quote (batched 30 symbols)       │
│                                                                  │
│  Portfolio Worker (portfolio.worker.*.mjs)                       │
│    ├── REST → GET /v7/finance/desktop/portfolio (30s polling)    │
│    ├── Fórmulas: currentMarketValue, dailyGain, totalGain,       │
│    │   annualGainPercentage (^365/days - 1)                      │
│    ├── Currency conversion via {ccy}=X symbols                   │
│    ├── Options: quantity × 100                                   │
│    └── MessagePort direto do Streamer Worker (init-qpf)          │
│        └── Recebe quoteData sem passar pelo main thread          │
└──────────────────────────────────────────────────────────────────┘
                         │ WebSocket (raw)
┌────────────────────────v─────────────────────────────────────────┐
│                   YAHOO FINANCE SERVERS                           │
│                                                                  │
│  REST APIs: query1.finance.yahoo.com (v1-v10)                    │
│             query2.finance.yahoo.com (v1-v10)                   │
│             finance.yahoo.com (xhr, calendar, cds)               │
│             ypf-gateway.finance.yahoo.com (YPF gateway)          │
│             yfc-server-query.finance.yahoo.com (community)       │
│  CDN:       s.yimg.com/uc/finance/webcore/js/ (assets)          │
│             s.yimg.com/du/benji/ (ads)                           │
│  WebSocket: streamer.finance.yahoo.com (protobuf)                │
│             streamer-stage.finance.yahoo.com (staging)           │
└──────────────────────────────────────────────────────────────────┘
```

### 6.3 Tabela Consolidada de Endpoints (36 endpoints)

| # | URL | Método | Versão | Usado por | Confirmado Runtime | Descrição |
|---|-----|--------|--------|-----------|-------------------|-----------|
| 1 | `/v1/test/getcrumb` | GET | v1 | yfinance, frontend | ✅ HTML | Obtém crumb CSRF (query1 ou query2) |
| 2 | `/v6/finance/quote/marketSummary` | GET | v6 | `domain/market.py` | ✅ HTML | Market summary por região |
| 3 | `/v6/finance/markettime` | GET | v6 | `domain/market.py` | ✅ HTML | Status do mercado (aberto/fechado) |
| 4 | `/v7/finance/quote` | GET | v7 | streamer worker (seed) | ✅ HTML | Quotes rápidas para seeding |
| 5 | `/v7/finance/options/{ticker}` | GET | v7 | yfinance, frontend | — | Option chain |
| 6 | `/v7/finance/desktop/portfolio` | GET | v7 | portfolio worker | — | Portfolio positions/lots (requer login) |
| 7 | `/v7/finance/spark` | GET | v7 | frontend | ✅ HTML | Sparkline multi-symbol (1-3mo) |
| 8 | `/v8/finance/chart/{ticker}` | GET | v8 | yfinance, frontend | — | Price history OHLCV + events + timezone |
| 9 | `/v10/finance/quoteSummary/{ticker}` | GET | v10 | yfinance, frontend | — | Dados fundamentalistas (30+ módulos) |
| 10 | `/v1/finance/search` | GET | v1 | yfinance, frontend | — | Busca de símbolos |
| 11 | `/v1/finance/trending/{region}` | GET | v1 | frontend | ✅ HTML | Trending symbols |
| 12 | `/v1/finance/lookup` | GET | v1 | yfinance | — | Lookup por tipo (8 tipos) |
| 13 | `/v1/finance/sectors/{key}` | GET | v1 | `domain/sector.py` | — | Dados de setor |
| 14 | `/v1/finance/industries/{key}` | GET | v1 | `domain/industry.py` | — | Dados de indústria |
| 15 | `/v1/finance/stockstories/top-weekly-...` | GET | v1 | frontend | — | Top picks semanais |
| 16 | `/v1/finance/screener` | POST | v1 | yfinance | — | Screener customizado |
| 17 | `/v1/finance/screener/predefined/saved` | GET/POST | v1 | yfinance, frontend | — | Screener pré-definido (19 queries) |
| 18 | `/v1/finance/visualization` | POST | v1 | yfinance (calendars + deprecated earnings) | — | Earnings dates + calendários |
| 19 | `/ws/fundamentals-timeseries/v1/finance/timeseries/{symbol}` | GET | v1 | yfinance | — | Financials time series |
| 20 | `/ws/company-fundamentals/v1/finance/price-insights` | GET | v1 | frontend | — | Price insights |
| 21 | `/ws/screeners/v1/finance/calendar-events` | GET | v1 | frontend | — | Calendar events |
| 22 | `/ws/obi-integration/v1/subscriptions` | GET | v1 | yfinance (Auth) | — | Subscription/tier info |
| 23 | `/xhr/ncp` | POST | — | yfinance | — | News feed (3 tabs: all, news, press releases) |
| 24 | `/calendar/earnings` | GET | — | yfinance | — | Scraping HTML de earnings calendar |
| 25 | `wss://streamer.finance.yahoo.com/?version=2` | WS | — | yfinance, frontend | — | Streaming cotações (protobuf) |
| 26 | `wss://streamer-stage.finance.yahoo.com/?version=2` | WS | — | frontend | — | Staging streaming |
| 27 | `https://fc.yahoo.com` | GET | — | yfinance | — | Cookie fetch (A3) |
| 28 | `https://guce.yahoo.com/consent` | GET | — | yfinance | — | Página consentimento GDPR |
| 29 | `https://consent.yahoo.com/v2/collectConsent` | POST | v2 | yfinance | — | Coleta de consentimento |
| 30 | `https://markets.businessinsider.com/ajax/SearchController_Suggest` | GET | — | yfinance | — | ISIN lookup (experimental) |
| 31 | `/xhr/config?name={name}` | GET | — | frontend (homepage) | ✅ HTML | Config de serviços/páginas/header/ads |
| 32 | `/xhr/cds?*` | GET | — | frontend (homepage) | ✅ HTML | Content Delivery Service (editorial) |
| 33 | `/ws/obi-integration/v1/premiumTiersMeta` | GET | v1 | frontend (homepage) | ✅ HTML | Mapeamento feature → tier mínimo |
| 34 | `/xhr/member-profile` | GET | — | frontend (homepage) | ✅ HTML | Perfil do usuário (dock config) |
| 35 | `ypf-gateway.finance.yahoo.com/*` | * | — | frontend (homepage) | ✅ config | YPF Gateway (proxy interno) |
| 36 | `yfc-server-query.finance.yahoo.com/*` | * | — | frontend (homepage) | ✅ config | Community service query |

**Legenda:** ✅ HTML = chamada confirmada via `data-sveltekit-fetched` na homepage.
✅ config = descoberto via `xhr/config?name=services`.

---

## 7. Protocol Map (Protobuf)

### 7.1 Python (`pricing.proto` → `pricing_pb2.py`)

```
Package: (root)
File:    pricing.proto (37 lines, proto3)
Compiled:pricing_pb2.py (34 lines, serialized descriptor)

Message: PricingData (33 fields)
  Fields 1-33: id, price, time, currency, exchange, quote_type,
               market_hours, change_percent, day_volume, day_high,
               day_low, change, short_name, expire_date, open_price,
               previous_close, strike_price, underlying_symbol,
               open_interest, options_type, mini_option, last_size,
               bid, bid_size, ask, ask_size, price_hint, vol_24hr,
               vol_all_currencies, from_currency, last_market,
               circulating_supply, market_cap

Used by: live.py (WebSocket → PricingData.ParseFromString)
```

### 7.2 Frontend JS (`_staticFinProtobuf.*.mjs` → protobufjs)

```
Root:    protobuf.roots.default
Library: protobufjs@7.1.2 (CDN: jsdelivr)

Namespaces:
┌─ quotefeeder ───────────────────────────┐
│  PricingData (45 fields — 33+12 extras) │
│  StaticData (8 fields)                  │
│  PriceUpdate (wrapper)                  │
│  StaticUpdate (wrapper)                 │
│  Enums: QuoteType (22 values),          │
│         MarketHours (5 values),         │
│         OptionType (CALL/PUT)           │
├─ earningsignals ────────────────────────┤
│  EarningSignals (6 fields, 2 required)  │
├─ polymarket ────────────────────────────┤
│  Enums: Side (3), EventType (5)         │
│  Messages: Order, EventMessage,         │
│            BookEvent, PriceChange,       │
│            PriceChangeEvent,             │
│            TickSizeChangeEvent,          │
│            LastTradePriceEvent,          │
│            MarketEvent (top-level)       │
└──────────────────────────────────────────┘

Campos extras no frontend (34-45):
  components, indices[], cmcRank,
  underlyingShortname, fiftyTwoWeekChange,
  fiftyTwoWeekChangePercent, latestAmountRaised,
  latestFundingDate, latestShareClass,
  latestImpliedValuation, ytdReturn, qtdReturn
```

#### 7.2.1 Nota: yahoo-finance2 usa parser protobuf customizado

Diferente do frontend Yahoo (que usa `protobufjs@7.1.2`), a biblioteca `yahoo-finance2`
(streamer.ts:221-284) implementa um **parser protobuf próprio, sem dependências externas**:

- **Wire types suportados**: Varint (0), Fixed64 (1), LengthDelimited (2), Fixed32 (5)
- **Varint 64-bit seguro**: usa `BigInt` para ler varints de até 10 bytes
- **ZigZag decoding**: `decodeZigZag64()` para campos sint64 (usado no timestamp do pricing)
- **UTF-8 heuristic**: `decodeUtf8IfTextLike()` — heuristic de printable text para evitar falsos strings em bytes binários
- **Extensível**: sistema de `registerMarketMessageDecoder()` permite adicionar decoders para novos tipos de mensagem sem modificar o dispatcher

**Mapping de campos pricing (streamer.ts:301-370):**
| Field # | Significado | Tipo protobuf | Observação |
|---------|-------------|---------------|------------|
| 1 | symbol (ex: "AAPL") | string | — |
| 2 | price | float32 (fixed32) | — |
| 3 | timestampMs | sint64 (zig-zag) | Decodificado via `decodeZigZag64()` |
| 5 | marketCode (ex: "NMS") | string | — |
| 6 | unknown (observado: 8) | varint | Possível market state / quote type |
| 7 | unknown (observado: 0) | varint | — |
| 8 | changePercent | float32 (fixed32) | — |
| 12 | change | float32 (fixed32) | — |
| 27 | priceHint | varint | Precisão decimal |

**Diferença crítica:** O schema do yahoo-finance2 tem **menos campos** que o frontend Yahoo
(45 campos no PricingData vs. ~10 no yahoo-finance2). O yahoo-finance2 mapeia apenas os campos
observados empiricamente, enquanto o frontend tem o schema completo via protobufjs.

---

## 8. Glossário

| Termo | Definição |
|-------|-----------|
| **Crumb** | Token CSRF usado como query param em requisições Yahoo Finance |
| **Protobuf** | Protocol Buffers — formato de serialização binária usado no streaming |
| **quotefeeder** | Namespace Protobuf para dados de cotação em tempo real |
| **Polymarket** | Mercado de previsão descentralizado integrado ao Yahoo Finance |
| **OBI** | Order Book Integration — sistema de subscriptions/tiers |
| **Tier** | Nível de assinatura (bronze/silver/gold) que desbloqueia features |
| **FastInfo** | Data descriptor Python que obtém dados via chart (mais rápido que quoteSummary) |
| **Vespa** | Sistema de busca do Yahoo (Vespa.ai) usado no search |
| **MIC** | Market Identifier Code — código ISO de identificação de exchange |
| **JA3/JA4** | TLS fingerprinting — curl_cffi permite impersonar browser Chrome |
| **Svelte** | Framework JS reativo usado nos componentes de UI do Yahoo Finance |
| **IntersectionObserver** | API browser que detecta visibilidade de elementos para lazy subscribe |
| **WeakMap** | Estrutura JS para cache de objetos com garbage collection automática |
| **SbeTick** | Simple Binary Encoding — formato de tick usado no protobuf |
| **YpcStreaming** | Mensagem top-level do protobuf de streaming (Yahoo Pricing Client) |
| **NCP** | News Content Pipeline — endpoint de feed de notícias |
| **CMP** | Consent Management Platform — framework de consentimento GDPR/CCPA |

---

## 9. Gap Analysis: Backend vs. Frontend

### 9.1 Campos Protobuf Ausentes no Python

O schema Python (`pricing.proto`) tem 33 campos. O frontend JS tem 45.
Campos 34-45 são **silenciosamente descartados** pelo backend:

| Campo (Frontend) | Tipo | Utilidade | Impacto |
|------------------|------|-----------|---------|
| `components` | string | Componentes de índice | Baixo |
| `indices` | string[] | Índices que incluem o ativo | Médio |
| `fiftyTwoWeekChange` | float | Variação 52 semanas | Alto |
| `fiftyTwoWeekChangePercent` | float | % variação 52 semanas | Alto |
| `ytdReturn` | float | Retorno YTD | Alto |
| `qtdReturn` | float | Retorno QTD | Médio |
| `cmcRank` | sint64 | Ranking CoinMarketCap | Baixo (nicho) |

### 9.2 Schemas Completamente Ausentes no Python

| Schema | Namespace | Campos | Importância |
|--------|-----------|--------|-------------|
| `StaticData` | quotefeeder | 8 | Média — dados de referência estáticos |
| `EarningSignals` | earningsignals | 6 | **Alta** — EPS real-time |
| `MarketEvent` + 7 submessages | polymarket | ~8 | Média — mercados de previsão |

### 9.3 Funcionalidades Frontend sem Equivalente Python

| Feature | Componente Frontend | Gap |
|---------|-------------------|-----|
| Earnings real-time | `EarningsSubscriber` | Sem suporte para sufixo `_earnings` |
| Polymarket streaming | `PolymarketSubscriber` | Sem suporte para sufixo `_PM` |
| Portfolio calculation | `portfolio.worker.mjs` | Sem equivalente |
| Quote seeding via v7 | `seedQuoteData()` | yfinance não seeda dados no streaming |
| MarketHours prefix | Streamer Worker | Frontend prefixa campos (regularMarketPrice, preMarketPrice) |
| Crumb refresh | `enableCrumbRefresh` flag | yfinance não renova crumb ativamente |
| Runtime config (`/xhr/config`) | Homepage SvelteKit | yfinance não usa config service — endpoints hardcoded |
| CDS editorial content | Homepage SvelteKit | yfinance não consome conteúdo editorial |
| PremiumTiersMeta | Homepage SvelteKit | yfinance não tem lógica de feature gating por tier |
| Community service | Homepage SvelteKit | yfinance não tem suporte a comunidade |
| Inter-worker communication | Streamer ↔ Portfolio | Sem equivalente — yfinance não tem workers |
| `toCurrency` field | Seeding REST | Não existe no schema protobuf do yfinance |

---

## 10. Riscos e considerações

### 10.1 Estabilidade da análise

| Risco | Probabilidade | Impacto |
|-------|---------------|---------|
| Yahoo altera schemas Protobuf | Média | Quebra de decodificação |
| Yahoo altera endpoints REST | Alta | Falha de funcionalidade |
| Yahoo atualiza TLS fingerprint | Média | curl_cffi pode ser bloqueado |
| Rate limiting | Média | Bloqueio de IP |
| Cookies expiram | Alta | Perda de autenticação |

### 10.2 Uso Responsável

- **Terms of Service:** API Yahoo Finance não é oficialmente pública
- **Rate Limiting:** HTTP 429 → `YFRateLimitError`
- **Login Cookies:** T/Y são efêmeros; yfinance verifica via subscriptions
- **Licença:** yfinance Apache 2.0, dados Yahoo Finance são proprietários
- **Endpoints internos:** `/xhr/config`, `/xhr/cds`, `ypf-gateway` e `yfc-*` são
  endpoints internos descobertos por engenharia reversa — podem mudar ou ser
  desativados sem aviso, e seu uso pode violar ToS

### 10.3 Limitações conhecidas

1. **Campos Protobuf 34-45** não decodificados pelo Python
2. **Earnings signals** e **Polymarket** transmitidos via WS mas ignorados
3. **Portfolio API** (`/v7/finance/desktop/portfolio`) sem equivalente
4. **Caching session (requests_cache)** é **proibido** (exception no init)
5. **ISIN lookup** via Business Insider — experimental
6. **Crumb refresh** — yfinance não renova crumb ativamente (frontend tem `enableCrumbRefresh`)
7. **Runtime config** — `/xhr/config` não é usado pelo yfinance; endpoints são hardcoded em `const.py`
8. **PremiumTiersMeta** — endpoint de tiers descoberto mas sem uso conhecido no yfinance
9. **CDS editorial** — conteúdo editorial servido via `/xhr/cds` não é consumível programaticamente

---

## 11. Apêndices

### A. Comandos de reprodução

```python
# Instalação yfinance
pip install yfinance

# Teste básico
import yfinance as yf
aapl = yf.Ticker("AAPL")
hist = aapl.history(period="1mo")
print(hist.head())

# Search
search = yf.Search("Apple")
print(search.quotes)

# WebSocket
ws = yf.WebSocket()
ws.subscribe(["AAPL"])
ws.listen(print)

# Auth
auth = yf.Auth()
auth.set_login_cookies("your_T_cookie", "your_Y_cookie")
print(auth.subscription_tier())
```

### B. Estrutura de diretórios (yfinance)

```
yfinance/
├── __init__.py           # Entry points públicos
├── base.py               # TickerBase
├── cache.py              # Cache de cookies/tz
├── calendars.py          # Calendário de eventos
├── config.py             # Config singleton
├── const.py              # Constantes, endpoints, field maps
├── data.py               # YfData singleton + Auth
├── exceptions.py         # Exceções customizadas
├── live.py               # WebSocket sync/async
├── lookup.py             # Lookup utility
├── multi.py              # Download multi-ticker
├── pricing.proto         # Fonte .proto
├── pricing_pb2.py        # Protobuf compilado Python
├── search.py             # Search REST
├── shared.py             # Shared utilities
├── ticker.py             # Ticker (extends TickerBase)
├── tickers.py            # Tickers collection
├── utils.py              # Utilitários (logging, pandas helpers)
├── version.py            # Versão
├── _http.py              # HTTP backend (curl_cffi/requests)
├── domain/
│   ├── domain.py         # Domain base
│   ├── industry.py       # Industry
│   ├── market.py         # Market + MarketRegion
│   └── sector.py         # Sector
├── scrapers/
│   ├── analysis.py       # Análise/recommendations
│   ├── fundamentals.py   # Dados fundamentalistas
│   ├── funds.py          # Fundos
│   ├── history.py        # Price history (OHLCV)
│   ├── holders.py        # Holders/institutional
│   └── quote.py          # Quote summary + FastInfo
└── screener/
    ├── query.py          # Query builder (Equity, Fund, ETF)
    └── screener.py       # Screener interface
```

### C. Mapeamento Protobuf -> JSON (campo a campo)

```python
# Mapeamento usado pelo frontend JS para PricingData
FIELD_MAP = {
    "id": "symbol",
    "dayVolume": "volume",
    "dayHigh": "high",
    "dayLow": "low",
    "marketcap": "marketCap",
    "marketHours": "marketState",
    "openPrice": "regularMarketOpen",
    "fromcurrency": "fromCurrency",
    "vol_24hr": "volume24Hr",
    "volAllCurrencies": "volumeAllCurrencies",
}

# Prefixos por market hours
MARKET_HOURS_PREFIX = {
    "PRE_MARKET": ("preMarket", "PRE"),
    "REGULAR_MARKET": ("regularMarket", "REGULAR"),
    "POST_MARKET": ("postMarket", "POST"),
    "EXTENDED_HOURS_MARKET": ("extendedMarket", "EXTENDED"),
    "OVERNIGHT_MARKET": ("overnightMarket", "OVERNIGHT"),
}

# Fields que vão para summaryDetail (vs. price)
SUMMARY_DETAIL_FIELDS = {"ask", "askSize", "bid", "bidSize",
                         "dayLow", "dayHigh", "expireDate"}
PRICE_FIELDS = {"change", "changePercent", "previousClose", "price"}
```

### D. Gap Analysis: yfinance vs Frontend JS

| Funcionalidade | yfinance | Frontend JS | Gap |
|----------------|----------|-------------|-----|
| Streaming quote | Sim (live.py) | Sim (worker) | Mesmo protocolo |
| Streaming earnings | Não | Sim | yfinance não expõe |
| Streaming polymarket | Não | Sim | yfinance não expõe |
| Portfolio tracking | Não | Sim | Worker dedicado |
| Search | Sim | Sim | Mesmo endpoint |
| Screener | Sim | Sim | Mesmo endpoint |
| Auth/Tiers | Sim | Parcial | Frontend usa cookies browser |
| Options chain | Sim | Parcial | v7/finance/options |
| Price history | Sim | Sim | v8/finance/chart |
| UI components | Não | Sim (fin-streamer) | Web Components |

### E. Observações sobre a classe `d` (QuoteStreamer)

A classe `d` no streamer worker implementa:

1. **Decodificação protobuf**: `PricingData.decode()` + `toObject()`
2. **Mapeamento de fields**: `id` → `symbol`, etc.
3. **Normalização de preços**: arredonda com `priceHint` casas decimais
4. **Separação price vs summaryDetail**: baseada em conjuntos
5. **Seeding via REST**: fallback para `v7/finance/quote` preencher timezone
6. **Cache de quoteData**: mantém dicionário atualizado incrementalmente

```
quoteData[symbol] = {
    price: { regularMarketPrice, regularMarketChange, ... },
    summaryDetail: { bid, ask, bidSize, askSize, dayLow, dayHigh, ... }
}
```

### F. Constantes de endpoint no frontend

```javascript
// finSearch.modern.js
const o = {
    stage: ["https://iquery-stage.finance.yahoo.com"],
    prod: ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]
};
const n = "/v1/finance/search";
const i = "/v1/finance/trending";
const r = "/v1/finance/stockstories/top-weekly-high-quality-tickers";
const l = "/v1/finance/screener/predefined/saved";
```

---

## 11. Camada de Bot Detection (Bot Manager)

### 11.1 Visão Geral

O Yahoo Finance emprega um **script de bot detection / anti-bot** (apelidado internamente de "Bot Manager")
que é carregado em **todas as páginas** do Yahoo Finance. Ele atua como uma camada de segurança
transparente que monitora, fingerprint e reporta comportamento de navegadores para detectar
acessos automatizados (scrapers, bots, headless browsers).

**Identificação do bundle analisado:**
- Versão: `v4.29.33.28049`
- Atualização: `2026-07-24T07:35:43.192Z`
- Formato: JS altamente obfuscado (string array + XOR encryption + rotation)

**Arquitetura geral:**
```
Página → Bot Manager → Hooking de APIs nativas → Coleta de fingerprints
                                           → Monitoramento de DOM
                                           → Monitoramento de rede (fetch/XHR/WS)
                                           → Monitoramento de ads (Prebid.js)
                                           ↓
                                    Telemetry (/beacon/...)
```

### 11.2 API Hooking (Principais APIs Monitoradas)

O script faz **patcher/replacement** de APIs nativas do navegador para monitorar uso:

| API Nativa | Hook | Propósito |
|------------|------|-----------|
| `EventTarget.prototype.addEventListener` | Proxy | Monitorar registro de event listeners |
| `setTimeout` | Wrapper | Medir latência de timers (detecta time manipulation) |
| `setInterval` | Wrapper | Medir latência de intervals |
| `requestAnimationFrame` | Wrapper | Medir FPS (detecta headless) |
| `clearTimeout` / `clearInterval` | Wrapper | Rastrear cancelamentos |
| `XMLHttpRequest` | Prototype patch | Interceptar requisições XHR |
| `fetch` | Proxy | Interceptar requisições fetch |
| `WebSocket` | Constructor patch | Interceptar conexões WebSocket |
| `window.open` | Proxy | Detectar popups |
| `MutationObserver` | Prototype patch | Monitorar manipulação de DOM |
| `Object.defineProperty` | Proxy | Detectar property access |
| `Error` / `Error.captureStackTrace` | Hooks | Capturar stack traces de erros |
| `Performance` (`performance.now`, `performance.getEntries`) | Leitura | Coleta de timing metrics |

**Técnica de hooking:** O script cria **proxies transparentes** que:
1. Chamam a função original (comportamento inalterado)
2. Logam metadados da chamada (arguments, caller, timestamp)
3. Reportam ao servidor via beacon quando aplicável

### 11.3 Fingerprinting (Coleta de Impressão Digital)

O módulo de fingerprinting (implementado como classe construtora de objeto de telemetria)
coleta os seguintes atributos do navegador:

| Categoria | Dados Coletados | Uso |
|-----------|-----------------|-----|
| **User Agent** | String completa do `navigator.userAgent` | Identificação de browser/OS |
| **Browser Parse** | Chrome / Firefox / Safari / Edge / iOS Safari | Fingerprint do browser |
| **Mobile Detection** | `navigator.maxTouchPoints`, `orientation`, mobile flag | Detectar dispositivo |
| **Screen** | `screen.width`, `screen.height`, `screen.colorDepth` | Resolução do monitor |
| **Timezone** | `Intl.DateTimeFormat().resolvedOptions().timeZone` | Fuso horário real |
| **Language** | `navigator.languages`, `navigator.language` | Idioma do sistema |
| **Platform** | `navigator.platform` | SO (Win32, MacIntel, Linux x86_64) |
| **Canvas** | Canvas 2D `toDataURL()` (imagem renderizada com texto/shapes) | Canvas fingerprinting |
| **WebGL** | `canvas.getContext('webgl')` → renderer info | WebGL fingerprinting |
| **Audio** | OscillatorNode → AnalyserNode → fingerprint | Audio fingerprinting |
| **Battery** | `navigator.getBattery()` → level, charging, chargingTime | Battery status API |
| **Hardware** | `navigator.hardwareConcurrency` (CPU cores) | Núcleos de CPU |
| **Memory** | `navigator.deviceMemory` (GB, se disponível) | RAM do dispositivo |
| **Plugins** | `navigator.plugins` (nomes/MIME types) | Plugins instalados |
| **Feature Detection** | `Proxy`, `WeakSet`, `WeakMap`, `WebAssembly`, `WebGL`, `WebGL2` | Capacidades do browser |
| **Random Seed** | UUID v4 gerado (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`) | Identificador único de sessão |

**Canvas fingerprinting detalhado:**
```javascript
// Lógica equivalente:
const canvas = document.createElement('canvas');
canvas.width = 240;
canvas.height = 60;
const ctx = canvas.getContext('2d');
ctx.textBaseline = 'top';
ctx.font = '14px Arial';
ctx.fillStyle = '#f60';
ctx.fillRect(125, 1, 62, 20);
ctx.fillStyle = '#069';
ctx.fillText('Cwm fjordbank glyphs vext quiz, 😃', 2, 15);
ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
ctx.fillText('Cwm fjordbank glyphs vext quiz, 😃', 4, 17);
return canvas.toDataURL(); // data:image/png;base64,...
```

**Audio fingerprinting detalhado:**
```javascript
// Lógica equivalente:
const audioCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
const osc = audioCtx.createOscillator();
osc.type = 'sawtooth';
osc.frequency.value = 200;
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 256;
osc.connect(analyser);
analyser.connect(audioCtx.destination);
osc.start(0);
audioCtx.startRendering().then(buffer => {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    // data → hash → fingerprint
});
```

### 11.4 Telemetry e Beacon

Os dados coletados são enviados para servidores do Yahoo via **beacon requests**.

**Endpoint de beacon:**
```
POST /beacon/{hash}
```
Exemplo real: `/beacon/139a6e79e45d768f3da9`

**Mecanismo de envio:**
- Prioriza `XMLHttpRequest` síncrono (bloqueante)
- Fallback: criação de `<img>` com `src` = beacon URL (GET)
- Fallback 2: `Blob` + `URL.createObjectURL` com fetch

**Formato dos dados (payload do beacon):**
```javascript
{
    t: timestamp,
    v: "4.29.33.28049",          // versão do script
    fs: "8d79f105f",             // apiVersionSuffix
    si: "uuid-da-sessao",
    bt: "TP",                    // browser type (TP=?
    bp: {                         // browser profile completo
        ua: "Mozilla/5.0 ...",
        br: 5,                    // browser ID (1=Edge, 2=Edge?, 3=iOS, 4=Safari, 5=Chrome, 6=Firefox)
        mo: false,                // mobile
        sw: 1920,                 // screen width
        sh: 1080,                 // screen height
        cd: 24,                   // color depth
        tz: "America/New_York",   // timezone
        ln: "en-US",              // language
        pl: "Win32",              // platform
        ca: "data:image/png...",  // canvas fingerprint (hash)
        au: "0.12345...",         // audio fingerprint (hash)
        wg: "Google Inc.",        // WebGL vendor
        wr: "ANGLE (NVIDIA...)",  // WebGL renderer
        bl: true,                 // battery level
        hc: 8,                    // hardware concurrency
        dm: 8,                    // device memory (GB)
        fg: "0x1FF"              // feature flags bitmask
    },
    ev: [                         // eventos observados
        { t: "fetch", u: "https://query1.finance.yahoo.com/...", ts: 1234567890 },
        { t: "xhr", u: "/v8/finance/chart/...", ts: 1234567890 },
        { t: "ws", u: "wss://streamer.finance.yahoo.com/...", ts: 1234567890 }
    ],
    er: [                         // erros capturados
        { msg: "...", stack: "...", ts: 1234567890 }
    ]
}
```

### 11.5 Rate Limiting

O beacon possui **rate limiting interno** para evitar sobrecarga:

| Limite | Valor | Ação |
|--------|-------|------|
| `Qb` (bytes totais enviados) | > 2 MB (`0x200000`) | Para de enviar (`Lc = true`) |
| `Rb` (mensagens totais) | > 50 (`0x32`) | Para de enviar |
| `ma` (eventos de intervalo) | > 32 (`0x20`) | Para de enviar |

Quando o rate limit é atingido (`Lc = true`), o script para completamente de reportar
telemetria até o próximo recarregamento da página.

### 11.6 Consent Management (TCF / GPP / USP)

O script integra-se com frameworks de consentimento de cookies/privacy:

| Framework | Objeto Global | Padrão |
|-----------|---------------|--------|
| **TCF v2** (Transparency & Consent Framework) | `window.__tcfapi` | IAB Europe |
| **GPP** (Global Privacy Platform) | `window.__gpp` | IAB Tech Lab |
| **USP** (US Privacy) | `window.__uspapi` | IAB US |

O script **stuba/cria** estes objetos se não existirem, adicionando callbacks
que reportam o status de consentimento como parte do fingerprint.

```javascript
// Lógica equivalente do stub TCF:
window.__tcfapi = function(command, version, callback, parameter) {
    if (command === 'addEventListener') {
        callback({
            gdprApplies: true,
            cmpStatus: 'loaded',
            eventStatus: 'tcloaded',
            tcString: '...',
            isServiceSpecific: true,
            useNonStandardStacks: false,
            purposeOneTreatment: false,
            publisherCC: 'US',
            ...vendorData
        }, true);
    }
};
```

### 11.7 Ad Monitoring (Prebid.js)

O script monitora o ecossistema de anúncios via **Prebid.js** (biblioteca de header bidding):

**Módulo de Criativos (`dX`):**
- Hook no `pbjs.adServers.dfp.buildVideoUrl`
- Monitora `pbjs.que.push` para capturar comandos assíncronos
- Extrai `adUnit`, `adServer`, `bidder`, `sizes`, `mediaType`
- Reporta erros de criativos (creative load failures)

**Módulo de Leilão (`eG`):**
- Escuta eventos do Prebid:
  - `bidWon` → creative ID, bidder, CPM, currency, adUnit
  - `bidResponse` → bidder, CPM, timeToRespond
  - `bidTimeout` → bidder, adUnit
- Coleta métricas de leilão (tempo de resposta, win rate)

### 11.8 Outras Proteções

| Proteção | Implementação |
|----------|---------------|
| **Iframe Detection** | Verifica `window.parent !== window.top` (páginas em iframe são suspeitas) |
| **DevTools Detection** | Mede `performance.now()` vs timer jitter (DevTools abertos criam jitter) |
| **WebDriver Detection** | Verifica `navigator.webdriver` (Selenium/Playwright) |
| **Headless Detection** | Verifica `navigator.plugins.length === 0`, `chrome.runtime` inexistente |
| **CSP Inspection** | Lê `document.querySelector('meta[http-equiv=Content-Security-Policy]')` |
| **Automation Flags** | `window.__nightmare`, `window._phantom`, `window.callPhantom`, `window.__webdriver_evaluate` |
| **Geolocation** | `navigator.geolocation` (permissão real x fake) |
| **Memory/GC** | Mede timing de `performance.memory.usedJSHeapSize` vs alocações |

### 11.9 Implicações para Scraping

**Impacto no yfinance (Python):**
- **Baixo**: yfinance faz chamadas REST diretas sem executar JavaScript
- O Bot Manager só roda em ambiente de navegador (frontend)
- O crumb (`/v1/test/getcrumb`) é obtido via requisição HTTP simples, sem passar pelo Bot Manager

**Impacto em scrapers baseados em navegador (Selenium/Playwright):**
- **Alto**: O Bot Manager detecta headless browsers via múltiplos vetores
- Necessário: patches de `navigator.webdriver`, `navigator.plugins`, `chrome.runtime`, canvas consistency
- O beacon reporta fingerprints suspeitos → Yahoo pode bloquear IP ou servir dados falsos

**Relação com o streamer WebSocket:**
- O Bot Manager monitora **todas** as conexões WebSocket
- A conexão `wss://streamer.finance.yahoo.com/v2/prices?sid=...` só é interceptada no frontend
- O yfinance (Python) conecta-se diretamente ao WebSocket sem passar pelo Bot Manager

**Mitigação conhecida (yfinance):**
- Usa `curl_cffi` com impersonação TLS `chrome124` para parecer Chrome real em TLS handshake
- O crumb é obtido via sessão HTTP com cookies adequados
- Rate limiting no IP: ~200 req/min antes de bloqueio

---

## 12. Análise Comparativa: yahoo-finance2 (TypeScript)

### 12.1 Visão Geral

A biblioteca `yahoo-finance2` (gadicc, 769 stars) é uma implementação **TypeScript/Deno** da API
não-documentada do Yahoo Finance. Difere do yfinance (Python) em arquitetura, runtime e
abrangência. Esta seção documenta os achados da engenharia reversa do seu código-fonte
(branch `dev`, src/).

### 12.2 Stack Tecnológica

| Aspecto | yahoo-finance2 | yfinance |
|---------|----------------|----------|
| **Runtime** | Deno (cross-compila para Node/Bun/Cloudflare Workers) | Python 3.8+ |
| **HTTP** | `globalThis.fetch` + `tough-cookie` | `requests` / `curl_cffi` |
| **Queue** | Fila interna com `concurrency: 4`, `interval` configurável | Nenhuma (controle via threading) |
| **Validação** | JSON Schema runtime + type coercion | Mínima (pandas dtype inference) |
| **Build** | `deno.json` → npm package | `setup.py` / pyproject.toml |
| **Testes** | Jest | pytest |

### 12.3 Queue System (`queue.ts`)

Cada instância de `YahooFinance` mantém uma **fila de requisições** dedicada via
`WeakMap<object, Queue>`:

```typescript
interface QueueOptions {
  concurrency?: number;  // default: 4
  interval?: number;     // delay mínimo entre requests (ms)
}

class Queue {
  _running = 0;          // contador de requests ativos
  _queue: Job[] = [];    // fila de promises pendentes
  _lastRun = 0;          // timestamp do último request
  _timer = null;         // setTimeout para respeitar interval
}
```

**Funcionamento:**
- `concurrency = 4` → no máximo 4 requests simultâneos
- `interval > 0` → delay de `último + interval - agora` ms entre inícios
- Implementação puramente baseada em Promises (sem lib externa)
- Cada instância tem fila independente (via WeakMap)
- Configurável via `new YahooFinance({ queue: { concurrency: 10 } })`

### 12.4 quoteCombine — Debounce de Chamadas Quote (`other/quoteCombine.ts`)

Padrão **debounce + merge** que não existe no yfinance:

1. Múltiplas chamadas `quoteCombine("AAPL")`, `quoteCombine("MSFT")` no mesmo tick
2. Acumula símbolos por 50ms (default) em um `Map<slug, {symbols, timeout}>`
3. Após 50ms sem novas chamadas, executa **uma única** requisição `quote({symbols: ["AAPL", "MSFT", ...]})`
4. Distribui cada resultado de volta ao respectivo caller

**Parâmetros configuráveis:**
```typescript
const defaultOptions: QuoteCombineOptions = {
  maxSymbolsPerRequest: 100,  // quebra em múltiplos requests se exceder
  debounceTime: 50,            // ms de espera antes de disparar
};
```

### 12.5 timeseries.json — Catálogo de Chaves Financeiras (`lib/timeseries.json`)

Arquivo JSON de 15KB com **todas as chaves de dados financeiros** disponíveis via
`/ws/fundamentals-timeseries/v1/finance/timeseries/{symbol}`, organizadas em 3 módulos:

**Módulo `financials` (Demonstração de Resultados):**
- 130+ chaves: `TotalRevenue`, `GrossProfit`, `OperatingIncome`, `EBIT`, `EBITDA`,
  `NetIncome`, `BasicEPS`, `DilutedEPS`, `DividendPerShare`, `ResearchAndDevelopment`,
  `SellingGeneralAndAdministration`, `InterestExpense`, `TaxProvision`, etc.

**Módulo `balance-sheet` (Balanço Patrimonial):**
- 150+ chaves: `TotalAssets`, `TotalLiabilitiesNetMinorityInterest`, `StockholdersEquity`,
  `TotalDebt`, `NetDebt`, `WorkingCapital`, `TangibleBookValue`, `CashAndCashEquivalents`,
  `AccountsReceivable`, `Inventory`, `Goodwill`, `NetPPE`, `LongTermDebt`, etc.

**Módulo `cash-flow` (Fluxo de Caixa):**
- 110+ chaves: `FreeCashFlow`, `OperatingCashFlow`, `CapitalExpenditure`,
  `DepreciationAndAmortization`, `StockBasedCompensation`, `RepurchaseOfCapitalStock`,
  `IssuanceOfDebt`, `RepaymentOfDebt`, `CashDividendsPaid`, etc.

**Uso no módulo `fundamentalsTimeSeries`:**
```typescript
// O parâmetro type é construído dinamicamente:
// "annual|quarterly|trailing" + cada chave do timeseries.json
// Ex: "annualTotalRevenue,annualNetIncome,annualOperatingIncome"
// GET /ws/fundamentals-timeseries/v1/finance/timeseries/AAPL
//   ?type=annualTotalRevenue,annualNetIncome&period1=...&period2=...
```

### 12.6 Runtime Detection (`runtime-detect.ts`)

Detecta automaticamente o ambiente de execução:

| Ambiente | Detecção | Suporte |
|----------|----------|---------|
| **Deno** | `typeof Deno !== 'undefined'` | Completo |
| **Node.js** | `typeof process?.versions?.node` | Completo |
| **Bun** | `typeof Bun !== 'undefined'` (via process.versions) | Completo |
| **Cloudflare Workers** | `typeof caches !== 'undefined'` e `globalThis.navigator` | Parcial |

### 12.7 MCP Server (`src/mcp/`)

Implementa um servidor **Model Context Protocol** (MCP) que expõe ferramentas do Yahoo Finance
para agentes de IA:

- `getQuote` — wrapper do módulo quote
- `searchStocks` — wrapper do módulo search
- `getChartData` — wrapper do módulo chart
- `getTrending` — wrapper do módulo trendingSymbols

### 12.8 Mapa de Módulos vs. Endpoints

| Módulo yahoo-finance2 | Endpoint Yahoo | Presente no nosso doc? |
|-----------------------|----------------|------------------------|
| `quote()` | `GET /v7/finance/quote` | Sim (§3.2.1) |
| `search()` | `GET /v1/finance/search` | Sim (§3.2.3) |
| `chart()` | `GET /v8/finance/chart/{symbol}` | Sim (§3.2.2) |
| `historical()` | → mapeia para `chart()` (legacy `/v7/finance/download/`) | Sim (§4.5) |
| `quoteSummary()` | `GET /v10/finance/quoteSummary/{symbol}` | Sim (§3.2.1) |
| `options()` | `GET /v7/finance/options/{symbol}` | Sim (§4.11) |
| `insights()` | `GET /ws/insights/v2/finance/insights` | Sim (§4.7) |
| `screener()` | `POST /v1/finance/screener/predefined/saved` | Sim (§3.2.4) |
| `recommendationsBySymbol()` | `GET /v6/finance/recommendationsbysymbol/{symbols}` | Sim (§4.8) |
| `trendingSymbols()` | `GET /v1/finance/trending/{region}` | Sim (§3.3.1) |
| `fundamentalsTimeSeries()` | `GET /ws/fundamentals-timeseries/v1/finance/timeseries/{symbol}` | Sim (§4.12) |
| `streamer()` | Protobuf WebSocket (custom parser) | Sim (§3.8, §7) |
| `quoteCombine()` | **N/A** (utility: debounce wrapper sobre quote) | Novo |
| `autoc()` | **DEPRECATED** (endpoint removido) | — |
| `dailyGainers/Losers()` | **DEPRECATED** → mapeia para `screener("day_gainers")` | — |

### 12.9 Resumo de Contribuições Únicas

Funcionalidades do yahoo-finance2 **não presentes** no yfinance:

1. **Consent flow completo** com 5 estágios e parse dinâmico de hidden inputs (§3.3.8)
2. **Cookie jar com URL fake** (`http://config.yf2/`) para isolar crumb (§3.3.8)
3. **Queue system** com concurrency control (pode evitar rate limit) (§12.3)
4. **quoteCombine** — debounce de chamadas quote em lote único (§12.4)
5. **timeseries.json** — catálogo completo de chaves de dados financeiros (§12.5)
6. **Runtime detection** para Deno/Node/Bun/Cloudflare (§12.6)
7. **MCP Server** para integração com LLMs/agentes de IA (§12.7)
8. **JSON Schema runtime validation** com type coercion automática ({raw, fmt} → Date/Number)
9. **Custom protobuf parser** sem dependências externas (vs. protobufjs no frontend) (§7.2.1)
10. **Extensible decoder registry** para novos tipos de mensagem WebSocket

### 12.10 yahooFinanceFetch — Motor HTTP Central (`lib/yahooFinanceFetch.ts`)

Arquivo de **238 linhas** que implementa o mecanismo central de requisições HTTP
para toda a biblioteca. Nenhum módulo faz fetch diretamente — todos passam por aqui.

**Responsabilidades:**

1. **Gerenciamento de fila**: cada instância YahooFinance tem uma fila `WeakMap<object, Queue>`
2. **Injeção de crumb**: obtém crumb via `getCrumb()` e adiciona `?crumb=X` aos params
3. **Gerenciamento de cookies**: serializa cookie do `cookieJar` antes do fetch,
   processa `Set-Cookie` headers após a resposta
4. **Substituição de variáveis de URL**: `${YF_QUERY_HOST}` → aleatório entre `query1`/`query2.finance.yahoo.com`
5. **Parsing de erros Yahoo**: detecta `{finance: {error: {code, description}}}` 
   e mapeia para classes de erro específicas
6. **Suporte a fetch customizado**: aceita `moduleOpts.fetch` e `moduleOpts.fetchOptions`

**Fluxo completo de uma chamada:**
```typescript
async function yahooFinanceFetch(
  urlBase: string,
  params: Record<string, string> = {},
  moduleOpts: YahooFinanceFetchModuleOptions = {},
  func = "json",        // "json" | "text" | "csv"
  needsCrumb = false,
): Promise<unknown>
```

1. Obtém/instancia Queue da instância (WeakMap)
2. Aplica opções de fila (concurrency, interval)
3. Se `needsCrumb`, chama `getCrumb()` para obter crumb atual
4. Constrói URL com `substituteVariables()` + `URLSearchParams`
5. Serializa cookie do jar e adiciona header `Cookie`
6. Executa fetch via `queue.add(() => fetchFunc(url, fetchOptions))`
7. Processa `Set-Cookie` headers na resposta
8. Faz parse do JSON e verifica erro no formato Yahoo
9. Retorna resultado ou lança erro específico

### 12.11 moduleExec — Orquestrador de Módulos (`lib/moduleExec.ts`)

Arquivo de **254 linhas** que implementa o padrão de execução de todos os módulos
(quote, search, chart, quoteSummary, etc.). Cada módulo chama `moduleExec()` com
sua configuração específica.

**Pipeline de execução:**

```
Validar Options → Merge (defaults + runtime + overrides) → Transform → Fetch → Transform Result → Validate + Coerce
```

**Interface:**
```typescript
async function moduleExec(opts: ModuleExecOptions): Promise<unknown>

interface ModuleExecOptions {
  moduleName: string;
  query: {
    assertSymbol?: string;         // valida se 1o arg é string
    url: string;                    // URL base do endpoint
    definitions: JSONSchema.definitions;
    schemaKey: string;             // schema para validar options
    defaults: any;                 // valores padrão do módulo
    runtime?: any;                 // params gerados em runtime
    overrides: any;                // params fornecidos pelo usuário
    transformWith?: TransformFunc; // transforma antes do fetch
    fetchType?: string;            // 'json' | 'text' | 'csv'
    needsCrumb: boolean;           // requer crumb?
  };
  result: {
    definitions: JSONSchema.definitions;
    schemaKey: string;             // schema para validar resultado
    transformWith?: TransformFunc; // transforma antes da validação
  };
  moduleOptions?: ModuleOptions;
}
```

**Particularidades:**
- Se `validateOptions: false`, pula validação de options (útil para debugging)
- Se `validateResult: false`, pula validação do resultado e retorna raw
- `transformWith` no query: usado para converter datas (`"2020-01-01"` → UNIX epoch)
- `transformWith` no result: usado para extrair campo específico (ex: `result.returnField`)
- Coerção de tipos: `{raw: 123, fmt: "123.45"}` → `new Date(raw * 1000)` ou `Number(raw)`

### 12.12 moduleCommon — Tipos Compartilhados (`lib/moduleCommon.ts`)

Arquivo de **46 linhas** que define as interfaces base para todos os módulos:

```typescript
export interface ModuleOptions extends YahooFinanceFetchModuleOptions {
  validateOptions?: boolean;   // default: true
  validateResult?: boolean;    // default: true
}

export interface ModuleThis {
  [key: string]: any;
  _moduleExec: any;            // referência para moduleExec
}

export type ModuleError = Error;
```

**Herança:** `ModuleOptions` estende `YahooFinanceFetchModuleOptions`, que inclui:
- `devel?: { id, t, onFinish }` — opções de cache para testes
- `fetch?: Fetch` — função fetch alternativa para esta chamada
- `fetchOptions?: RequestInit` — headers/opções para esta chamada
- `queue?: QueueOptions` — override de fila para esta chamada

### 12.13 CLI Interface (`lib/cli.ts`)

Arquivo de **338 linhas** que implementa uma interface de linha de comando completa
para a biblioteca.

**Uso:**
```bash
yahoo-finance <module> [args...]
yahoo-finance [module] --stdin     # pipe via stdin
echo '{"query":"AAPL"}' | yahoo-finance quote --stdin
```

**Funcionalidades:**
- Auto-decode de argumentos: JSON (`{...}` ou `[...]`), números (`/^[0-9.]+$/`), strings
- Suporte a `--stdin`: lê payload JSON do stdin (com `query`, `args`, `module` fields)
- Modo conveniência: `{query, queryOptions, moduleOptions}` via stdin
- Help automático: `yahoo-finance --help` ou `-h`
- Version: `yahoo-finance --version` ou `-v`
- Exit codes: `0` (OK), `1` (runtime error), `2` (usage error)
- Output format: `console.dir` com cores se terminal, `JSON.stringify` se pipe
- Validação de módulo: verifica se o nome do módulo existe

**Exemplo de stdin avançado:**
```json
{"module": "quoteSummary", "args": ["AAPL", {"modules": ["assetProfile"]}]}
```

### 12.14 Error Handling (`lib/errors.ts`, `lib/notices.ts`, `lib/headers.ts`)

#### 12.14.1 Classes de Erro (`errors.ts`)

55 linhas, **5 classes de erro** com nomes padronizados:

| Classe | Propósito | Lançado quando |
|--------|-----------|----------------|
| `BadRequestError` | Yahoo retornou HTTP 400 | Parâmetros inválidos |
| `HTTPError` | Yahoo retornou status não-OK | Rede/API indisponível |
| `InvalidOptionsError` | Opções inválidas passadas ao módulo | Schema validation fail |
| `NoEnvironmentError` | `yahooFinanceFetch` sem `this._env` | Erro de configuração interna |
| `FailedYahooValidationError` | Resultado não passou na validação | Yahoo mudou formato do response |

**Mecanismo de mapeamento dinâmico:**
```typescript
// Em yahooFinanceFetch.ts:
const errorName = errorObj.code.replace(/ /g, "") + "Error";
const ErrorClass = errors[errorName] || Error;
throw new ErrorClass(errorObj.description);
```

Isso permite que erros do Yahoo (ex: `"Bad Request"`) sejam mapeados
automaticamente para classes como `BadRequestError`.

#### 12.14.2 Notice System (`notices.ts`)

Sistema de **avisos one-shot** com supressão configurável:

| ID | Texto | Nível |
|----|-------|-------|
| `yahooSurvey` | Convite para survey de feedback | `info` (once) |
| `ripHistorical` | Aviso de deprecated do `historical()` | `warn` (once) |

- Avisos com `onceOnly: true` são mostrados apenas uma vez por instância
- Supressão via `new YahooFinance({ suppressNotices: ['ripHistorical'] })`
- Método `.suppress(ids)` para supressão programática

#### 12.14.3 Headers Utility (`headers.ts`)

Wrapper cross-runtime para extrair `Set-Cookie` headers:
```typescript
export function getSetCookieHeaders(headers: Headers): string[]
```
Usa `Reflect.get(headers, "getSetCookie")` para compatibilidade
Node.js/Deno/Bun (cada runtime implementa `getSetCookie` diferentemente).

### 12.15 Infrastructure Libraries

#### 12.15.1 jsonSafe.ts — JSON Serialization Segura

Implementa `stringifyJsonSafe()` que lida com casos problemáticos:
- `BigInt` → string
- Circular references → `"[Circular]"`
- `undefined` → `null`
- `NaN` / `Infinity` → `null`

Usado pelo CLI (`cli.ts:176`) para serializar resultados antes de stdout.

#### 12.15.2 deepmerge.ts — Deep Merge

Utilitário de merge profundo para objetos, usado para combinar
`defaults + runtime + overrides` no moduleExec. Suporta:
- Merge recursivo de objetos aninhados
- Arrays são substituídos (não concatenados)
- Tratamento especial para `undefined` (não sobrescreve)

#### 12.15.3 runtimeGlobal.ts — Referência Global

Mantém uma referência global `globalThis._yahooFinance` para:
- Acesso à instância ativa em qualquer lugar do código
- Útil para módulos que precisam acessar config sem injeção explícita
- Cleanup via `delete globalThis._yahooFinance` no destructor

#### 12.15.4 versions.ts — Version Tracking

Gerencia a versão da biblioteca e compatibilidade:
```typescript
export const YAHOO_FINANCE2_VERSION = "x.y.z";
```
Usado para:
- `yahoo-finance --version`
- Logging e debugging
- Version check em validação de schemas

### 12.16 Options & Validation Subsystems

#### 12.16.1 Options (`lib/options/`)

| Arquivo | Propósito |
|---------|-----------|
| `options.ts` | Interface `YahooFinanceOptions` com todas as opções da biblioteca |
| `options.schema.json` | JSON Schema para validação das opções |
| `defaults.ts` | Valores padrão de todas as opções |
| `logger.ts` | Interface `Logger` com `info`, `warn`, `error`, `debug`, `dir` |

**YahooFinanceOptions (principais campos):**
```typescript
interface YahooFinanceOptions {
  queue?: { concurrency: number; interval: number };
  validation?: { allowAdditionalProps: boolean; logErrors: boolean };
  cookieJar?: CookieJar;
  fetch?: Fetch;
  fetchOptions?: RequestInit;
  YF_QUERY_HOST?: string;           // "query1" | "query2"
  logger?: Logger;
  suppressNotices?: string[];
  env?: "production" | "development";
}
```

#### 12.16.2 Validation (`lib/validate/`)

| Arquivo | Propósito |
|---------|-----------|
| `index.ts` | Validação JSON Schema + type coercion |
| `types/` | Tipos TypeScript para JSON Schema |

**Funcionalidades do sistema de validação:**
- Suporte a schemas JSON Schema completos (definitions, $ref)
- Coerção automática de tipos Yahoo → nativos:
  - `{raw: number, fmt: string}` → `Date` (raw é timestamp UNIX)
  - `{raw: number, fmt: string}` → `Number` (raw é valor numérico)
  - Strings são automaticamente trimadas
- `allowAdditionalProps`: controla se propriedades não documentadas são permitidas
- `logErrors`: logging detalhado de falhas de validação
- Usado tanto para validar **options** de entrada quanto **resultados** de saída

### 12.17 MCP HTTP Transport (`mcp/http.ts`, `mcp/mod.ts`)

#### 12.17.1 http.ts — Transporte HTTP para MCP (241 linhas)

Implementa dois handlers HTTP para o servidor MCP:

**Web Standard Handler** (Deno/Cloudflare Workers/Bun):
```typescript
createYahooFinanceMcpWebHandler(options: YahooFinanceMcpHttpOptions): 
  (request: Request) => Promise<Response>
```

**Node.js Handler** (Express/Next.js/etc):
```typescript
createYahooFinanceMcpNodeHandler(options: YahooFinanceMcpHttpOptions):
  (req: IncomingMessage, res: ServerResponse) => Promise<void>
```

**Funcionalidades de segurança:**
| Recurso | Configuração | Default |
|---------|-------------|---------|
| Path filtering | `options.path` | `/mcp` |
| Host validation | `options.allowedHosts` | `["127.0.0.1", "localhost", "::1"]` |
| Origin validation | `options.allowedOrigins` | Desligado |
| Bearer token auth | `options.bearerToken` | Desligado |

**Implementação:**
- Usa `@modelcontextprotocol/sdk` para transport (`StreamableHTTPServerTransport`,
  `WebStandardStreamableHTTPServerTransport`)
- Valida headers (Host, Origin, Authorization) antes de processar
- Timing-safe comparison para bearer token
- Cria servidor MCP fresco por request, fecha após completar
- Suporta JSON-RPC sobre HTTP

#### 12.17.2 mod.ts — Entry Point Público

Re-exporta todos os símbolos públicos do módulo MCP:
```typescript
export {
  createYahooFinanceMcpServer,       // server.ts
  createYahooFinanceMcpNodeHandler,  // http.ts
  createYahooFinanceMcpWebHandler,   // http.ts
  getYahooFinanceMcpToolNames,       // server.ts
};
```

### 12.18 Mapa Arquivos vs. Funcionalidades (Atualizado)

| Arquivo | Linhas | Função | Documentado antes? |
|---------|--------|--------|--------------------|
| `lib/queue.ts` | ~80 | Fila de requisições com concurrency | Sim (§12.3) |
| `lib/getCrumb.ts` | ~100 | Obtenção de crumb via consent flow | Sim (§3.3.8) |
| `lib/cookieJar.ts` | ~150 | Cookie jar com URL fake | Sim (§3.3.8) |
| `lib/runtime-detect.ts` | ~40 | Detecção de runtime | Sim (§12.6) |
| `lib/timeseries.json` | 15KB | Catálogo de chaves financeiras | Sim (§12.5) |
| `lib/validateAndCoerceTypes.ts` | ~200 | Validação + coerção de tipos | Mencionado (§12.9.8) |
| `lib/yahooFinanceFetch.ts` | 238 | Motor HTTP central | **Novo** |
| `lib/moduleExec.ts` | 254 | Orquestrador de módulos | **Novo** |
| `lib/moduleCommon.ts` | 46 | Tipos compartilhados | **Novo** |
| `lib/cli.ts` | 338 | Interface CLI | **Novo** |
| `lib/errors.ts` | 55 | 5 classes de erro | **Novo** |
| `lib/notices.ts` | 73 | Sistema de avisos one-shot | **Novo** |
| `lib/headers.ts` | 4 | Extração Set-Cookie | **Novo** |
| `lib/jsonSafe.ts` | ~40 | JSON serialization segura | **Novo** |
| `lib/deepmerge.ts` | ~30 | Deep merge utility | **Novo** |
| `lib/runtimeGlobal.ts` | ~20 | Referência global | **Novo** |
| `lib/versions.ts` | ~15 | Version tracking | **Novo** |
| `lib/options/` | 4 files | Subsistema de opções | **Novo** |
| `lib/validate/` | 3+ files | Subsistema de validação | **Novo** |
| `other/quoteCombine.ts` | ~100 | Debounce de chamadas quote | Sim (§12.4) |
| `mcp/server.ts` | ~150 | Servidor MCP base | Sim (§12.7) |
| `mcp/http.ts` | 241 | Transporte HTTP MCP | **Novo** |
| `mcp/mod.ts` | 11 | Entry point MCP | **Novo** |

### 12.19 Resumo de Contribuições Únicas (Atualizado)

Funcionalidades do yahoo-finance2 **não presentes** no yfinance:

1. **Consent flow completo** com 5 estágios e parse dinâmico de hidden inputs (§3.3.8)
2. **Cookie jar com URL fake** (`http://config.yf2/`) para isolar crumb (§3.3.8)
3. **Queue system** com concurrency control (pode evitar rate limit) (§12.3)
4. **quoteCombine** — debounce de chamadas quote em lote único (§12.4)
5. **timeseries.json** — catálogo completo de chaves de dados financeiros (§12.5)
6. **Runtime detection** para Deno/Node/Bun/Cloudflare (§12.6)
7. **MCP Server** para integração com LLMs/agentes de IA (§12.7)
8. **JSON Schema runtime validation** com type coercion automática ({raw, fmt} → Date/Number)
9. **Custom protobuf parser** sem dependências externas (vs. protobufjs no frontend) (§7.2.1)
10. **Extensible decoder registry** para novos tipos de mensagem WebSocket
11. **Motor HTTP centralizado** (`yahooFinanceFetch.ts`) — fila + crumb + cookies + error handling (Novo §12.10)
12. **Orquestrador de módulos** (`moduleExec.ts`) — pipeline validar→merge→transform→fetch→validar (Novo §12.11)
13. **CLI completa** (`cli.ts`) — argumentos, stdin pipe, auto-decode (Novo §12.13)
14. **Sistema de erros tipados** — 5 classes de erro com mapeamento dinâmico (Novo §12.14)
15. **Sistema de notices** — avisos one-shot com supressão (Novo §12.14)
16. **MCP HTTP Transport** — handlers Node.js + Web Standard com segurança (Novo §12.17)
17. **Subsistema de validação** — JSON Schema runtime com coerção de tipos Yahoo (Novo §12.16)

---

## 13. Validação Empírica: Página Real de Cotação (INTC)

> Em 24-Jul-2026, a página `finance.yahoo.com/quote/INTC/` foi capturada e analisada
> para validar todas as descobertas anteriores. A página contém **21+ respostas de API
> reais** embutidas via `data-sveltekit-fetched`, o `YAHOO.context` com crumb válido,
> e o asset manifesto completo dos bundles JS. Esta seção documenta os achados
> **não cobertos** nas seções anteriores.

### 13.1 Asset Manifest Completo

A página carrega os seguintes bundles (hashes SHA256 reais):

| Bundle | Hash | Função |
|--------|------|--------|
| `_app/immutable/start-3be41574.js` | `sha256-vLWfKBzRl6HjLPfXJGCwV6Uf2TYFwCylSX3/RNDOP14` | SvelteKit entry point |
| `_app/immutable/pages/quote/_page-5a1f2cf7.js` | `sha256-+U14gBCekcdJWxh7Yn6QItuY9VHNIl/yf6/8tfwkCtk` | Quote page component |
| `_app/immutable/pages/quote/_page-5a1f2cf7.css` | `sha256-Hf7G5FK3s3xW10EFX8hBmBLP9POajmVekMTHfWmYVqA` | Quote page styles |
| `_app/immutable/chunks/quoteSummary-3c4acb1f.js` | `sha256-NK28HQ0YPN1m7VkHrK/8pwBQpV5FuMIpFSpRMmRXsCc` | QuoteSummary module |
| `_app/immutable/chunks/streamer-3f84c2ea.js` | `sha256-mUWi5wNpMZyIF7vP7x5e/YTQWL78JMlSSqxfG3As4ag` | Streamer module |
| `_app/immutable/chunks/portfolio-ff596cbd.js` | `sha256-xI2efGpn+0bKXJMWWL1jsvq+1J3MsBr8r2lZ6Zz28nQ` | Portfolio module |
| `_app/immutable/chunks/chart-1598fbed.js` | `sha256-1PRLKVLjyfN3GtE9ndHiyBw4TgKMN7CQ7jXggqFvjj4` | Chart module |
| `_app/immutable/chunks/ticker-22fffcab.js` | `sha256-VOJuK5sRQ+kkV3vMrTqgqPNh9OJqRgNCCfH3c0NQosg` | Ticker module |
| `_app/immutable/chunks/sparkLine-8d58c6f5.js` | `sha256-+6XHbI3fLR2vBv0k/qm+DLpgsbMZ3ncCMNpYb31FCjo` | SparkLine module |
| `_app/immutable/chunks/historical-ff6d42dc.js` | `sha256-iE2OqQymMX3YxpN7pMFx/ekX+Qy7AB04pVXmhSRQHmk` | Historical data module |
| `_app/immutable/chunks/optionContracts-67597504.js` | `sha256-jMGu+MF7dPjQxV86nFG7tkDLDk4iMFwMyZt0t/qcRBE` | Options contracts module |
| `_app/immutable/chunks/trending-22fe2cfa.js` | `sha256-rxmRgM0AGMiMMrQ43qJQ+0LDDNceb2t+PYo5nMLW8Fk` | Trending module |
| `_app/immutable/chunks/sentiment-051bdd49.js` | `sha256-71fFnIRnGhB3nOKRzqL5r9aV5PloYb/DhFEFjY6w/9Q` | Sentiment module |
| `_app/immutable/chunks/calendarEvents-1098e19a.js` | `sha256-TQGMHhx3vR8C71GG9HVyk6QN0B0FqlgMjp0r4QZ6d78` | Calendar events module |
| `_app/immutable/chunks/priceInsights-74ae477b.js` | `sha256-5oG7/Zl+1I5PCMJICz4xfEw0t6Prh38QZqRHI8V7ag8` | Price Insights module |
| `_app/immutable/chunks/earningsEvent-641e29c7.js` | `sha256-YCJPq/Ngu0qBwBWFufHbjg9f/sMHY7kJpsE/UR5lAvA` | Earnings event module |
| `_app/immutable/chunks/recommender-f59e6cdf.js` | `sha256-r3LJJi+8EQT1ESi67vNhEIkqWqKTYkLz6Tmx0rx0R6s` | Stock recommender module |
| `_app/immutable/chunks/screener-4a54a35b.js` | `sha256-/qFYdQnN7vq3QqBKTktAE3whWMDWNLs/mPlWhqIAMU0` | Screener module |
| `_app/immutable/chunks/fundamentalsTimeseries-5b9d2a9a.js` | `sha256-/4vNQnXQtrV60HqWRMAUKOqcR3WAT4kMl2v3wH2kJnY` | Fundamentals timeseries module |
| `_app/immutable/chunks/marketSummary-4ecf21d7.js` | `sha256-By7+LMMk5RRJLJWclcFQfnPBBYWDQtHUBBQw90lpxOg` | Market summary module |
| `_app/immutable/chunks/globalNavigation-29d1e4b4.js` | `sha256-7BjVtF1+UDnGpG9LHKFL/0j+n8LDZkAkxChxOss+QXE` | Global navigation module |
| `_app/immutable/chunks/headerNav-0c73cdf9.js` | `sha256-UfZLYhR/HKZ6XbEpEBGYVq9wFmxqBC7tcZ+crlyAolA` | Header nav module |
| `_app/immutable/chunks/dock-6545b91e.js` | `sha256-kWzHBEHIr5nF9/3mSfkQAcxSMFfC3S9w6IlAwcLyYBo` | Dock/portfolio module |
| `_app/immutable/chunks/memberProfile-47c4a609.js` | `sha256-x+08RSP/W0+J7SdFn3Q3ySogZQbKwCj4+PAYM7nX4ng` | Member profile module |
| `_app/immutable/chunks/cds-bc7155f8.js` | `sha256-3sEj63GiiAQEdQOsUOz2s6WtSOhUZGYLRS/+6KZEq0g` | Content delivery service module |
| `_app/immutable/chunks/streamer.worker-6af639a2.js` | `sha256-RnsRsM77lTQm8nH72HYFHh75pdMbFnI7UxH2TrxYhfA` | Streamer Web Worker |
| `_app/immutable/chunks/portfolio.worker-0b54885d.js` | `sha256-8M1vQ7X1h5QqOQn9O0DJQwHJrOGLpmGmbIqOXAyJhdk` | Portfolio Web Worker |
| `_app/immutable/chunks/staticFinProtobuf-71f6b8f5.js` | `sha256-vOHAHhBMHg/mqz8y0hYQXPfQB8/76jbt7l4U8n9O4mQ` | Protobuf schemas |

**Total: 28 bundles** (incluindo CSS e workers), confirmando a arquitetura modular
com lazy-loading por feature.

### 13.2 YAHOO.context — Runtime Config

O objeto `YAHOO.context` é injetado inline no HTML como:
```html
<script>YAHOO.context = {...</script>
```

Campos confirmados na página real:

| Campo | Valor | Significado |
|-------|-------|-------------|
| `user.crumb` | `"cyTGwg2dwqw"` | Crumb de autenticação — **mesmo valor em todas as 21+ chamadas de API** |
| `clientVersion` | `"0.1.13842.1784856985"` | Versão do frontend SvelteKit |
| `colo` | `"bf1"` | Datacenter/colo de origem |
| `region` | `"US"` | Regição configurada (mesmo para usuário BR) |
| `usercountry` | `"BR"` | País real do usuário (geolocalização) |
| `bottype` | *(presente mas vazio)* | Campo para classificação de bot (DataDome/Akamai) |
| `responsive` | `"enabled"` | Design responsivo ativo |
| `theme` | `"light"` | Tema claro |
| `canLi` | `true` | Pode fazer login |
| `isLoggedIn` | `false` | Usuário anônimo |
| `subscriber` | `0` | Não assinante Yahoo |
| `premiumTier` | `0` | Tier gratuito |
| `ld` | *(500+ keys)* | LaunchDarkly feature flags |

### 13.3 Endpoints Reais (data-sveltekit-fetched)

A página contém **21+ elementos** `<script data-sveltekit-fetched>` com respostas JSON
de APIs reais. Todos usam **crumb `cyTGwg2dwqw`** e `protocol: "uid"`.

| # | Endpoint | Método | Propósito |
|---|----------|--------|-----------|
| 1 | `/v7/finance/quote?symbols=INTC&crumb=cyTGwg2dwqw` | GET | Quote data principal |
| 2 | `/v10/finance/quoteSummary/INTC?modules=...&crumb=cyTGwg2dwqw` | GET | Quote summary com 12+ módulos |
| 3 | `/v1/finance/trending/US?crumb=cyTGwg2dwqw` | GET | Trending symbols |
| 4 | `/v7/finance/spark?symbols=INTC&range=...&crumb=cyTGwg2dwqw` | GET | Sparkline chart data |
| 5 | `/v1/finance/screener/predefined/saved?crumb=cyTGwg2dwqw` | GET | Screener pré-definido |
| 6 | `/v6/finance/markettime?crumb=cyTGwg2dwqw` | GET | Market time status |
| 7 | `/ws/fundamentals-timeseries/v1/finance/timeseries/INTC?crumb=cyTGwg2dwqw` | GET | Timeseries financeiros |
| 8 | `/ws/insights/v2/finance/insights?crumb=cyTGwg2dwqw` | GET | Price insights (IA) |
| 9 | `/ws/company-fundamentals/v1/finance/price-insights?crumb=cyTGwg2dwqw` | GET | Company fundamentals insights |
| 10 | `/ws/screeners/v1/finance/calendar-events?crumb=cyTGwg2dwqw` | GET | Calendar events |
| 11 | `/xhr/cds?schemaId=yfinance:globalNavDynamicLinks&crumb=cyTGwg2dwqw` | GET | Content delivery: nav links |
| 12 | `/xhr/cds?schemaId=yfinance:partnerDropdownFooter&crumb=cyTGwg2dwqw` | GET | Content delivery: footer partners |
| 13 | `/xhr/cds?schemaId=yfinance:featureEngagementCampaigns&crumb=cyTGwg2dwqw` | GET | Content delivery: marketing campaigns |
| 14 | `/xhr/cds?schemaId=yfinance:partnerDropdown&crumb=cyTGwg2dwqw` | GET | Content delivery: partner dropdown |
| 15 | `/xhr/member-profile?crumb=cyTGwg2dwqw` | GET | Member profile (Dock config) |
| 16 | `/xhr/header/nav?crumb=cyTGwg2dwqw` | GET | Header navigation (centenas de links) |
| 17 | `/xhr/earnings-event?crumb=cyTGwg2dwqw` | GET | Earnings event data |
| 18 | `/xhr/stock-recommender?symbol=INTC&crumb=cyTGwg2dwqw` | GET | Stock recommendations (Vespa) |
| 19 | `/ws/obi-integration/v1/premiumTiersMeta?crumb=cyTGwg2dwqw` | GET | Premium tiers metadata |
| 20 | `nexus-gateway-prod.media.yahoo.com/v1/stream/...` | GET | Content stream (images/video) |
| 21 | `/xhr/config?name=services,ads,header&crumb=cyTGwg2dwqw` | GET | Config bundles |

**Observação importante**: Nenhum endpoint usa `.json` sufixo. Todos usam
`crumb=<token>` como parâmetro de autenticação. O protocolo `"uid"` confirma
autenticação via cookie `GUC` + crumb.

### 13.4 Premium Tier Mappings

Confirmados na página real via `YAHOO.context.premiumTiersMeta`:

| Funcionalidade | Tiers |
|----------------|-------|
| `workspace` | `[6]` (Dashboard — tier mais alto) |
| `stockPicks` | `[5,6]` |
| `fairValue` | `[5,6]` |
| `adLite` | `[3,4,5,6]` (menos anúncios) |
| `advancedChart` | `[6]` |
| `level2Quotes` | `[6]` (Nasdaq Level 2) |
| `alerts` | `[6]` |

Tier mapping: `0=gratuito`, `1-2=basic`, `3-4=premium`, `5-6=premium+`

### 13.5 TCF/GPP/USP Stubs

O HTML contém stubs de consentimento embutidos diretamente (não via bundle externo):
- **TCF** (Transparency & Consent Framework): `__tcfapi` stub com `addEventListener`, `removeEventListener`, `ping`
- **GPP** (Global Privacy Platform): `__gpp` stub com `ping`, `addEventListener`, `removeEventListener`, `hasSection`
- **USP** (US Privacy): `__uspapi` stub com `ping`, `addEventListener`, `removeEventListener`

Todos os stubs são carregados sincronamente antes dos bundles SvelteKit,
garantindo que a CMP (Consent Management Platform) esteja disponível antes
de qualquer carregamento de anúncio ou tracker.

### 13.6 Ad Positions

Config de anúncios inline no HTML:
```
/22888152279/us/yfin/quote/dt/
```

Slots de anúncio na página de quote:
| Slot | Posição | Descrição |
|------|---------|-----------|
| `E2E` | Topo | Leaderboard billboard |
| `DCKTOP` | Acima do quote header | Desktop top anchor |
| `DCKMID` | Meio da página | Desktop mid-article |
| `BTM-CENTER` | Rodapé | Bottom center |
| `TRADENOW` | Sidebar | Trade now call-to-action |

### 13.7 SvelteKit Confirmado

A página usa SvelteKit (`__sveltekit` no DOM, `data-sveltekit-fetched` para
respostas de API, hash-based `_app/immutable/` asset paths com content hashing).
Nenhum framework adicional (React/Vue) foi detectado — todo o frontend é SvelteKit.

**Mecanismo de data-sveltekit-fetched:**
```html
<script data-sveltekit-fetched>
  {"data":{...},"status":200,"statusText":"","headers":{...}}
</script>
```

Cada `<script>` contém uma resposta HTTP completa serializada: `data`, `status`,
`statusText`, `headers`. SvelteKit hidrata a página a partir destes dados sem
refazer as chamadas de API.

### 13.8 Feature Flags (LaunchDarkly)

O `YAHOO.context.ld` contém ~150+ feature flags via LaunchDarkly. As mais relevantes:

| Flag | Provável propósito |
|------|--------------------|
| `enableCrumbRefresh` | Refresh automático de crumb expirado |
| `enablePfStreaming` | Portfolio streaming via WebSocket |
| `enableAlphaspaceL2` | Level 2 data para Alphaspace |
| `enablePriceInsights` | Price Insights com IA |
| `enableEarningsEvent` | Earnings event module |
| `enableCalendarEvents` | Calendar events module |
| `enableDockCustomization` | Dock customization UI |
| `enableStockRecommender` | Stock recommender (Vespa) |
| `enableCdsDynamicLinks` | CDS dynamic nav links |
| `enableNexusGateway` | Nexus content stream gateway |

### 13.9 Novos Endpoints Não Documentados Anteriormente

#### 13.9.1 Price Insights (`/ws/company-fundamentals/v1/finance/price-insights`)

Retorna análise fundamentalista com **IA generativa** — campos confirmados na resposta:

```json
{
  "symbol": "INTC",
  "companyName": "Intel Corporation",
  "tldr": "Intel's Q2 2026 earnings showed...",
  "bottom_line": "Intel faces margin pressure from...",
  "observations": [{"title": "Revenue decline", "detail": "..."}],
  "themes": ["Semiconductor cycle", "AI competition"],
  "analystRating": "Hold",
  "priceTarget": {"avg": 45.00, "high": 62.00, "low": 28.00}
}
```

**Diferença do `/ws/insights/v2/finance/insights`** (já documentado em §4.7):
- Insights v2: foco em earnings estimativas, recomendação de analistas, dados financeiros históricos
- Price Insights v1: foco em **narrativa IA**, sumário executivo, temas de mercado, observações qualitativas

#### 13.9.2 Content Delivery Service (`/xhr/cds?schemaId=...`)

Serve conteúdo dinâmico estruturado com schemas específicos:

| Schema | Conteúdo |
|--------|----------|
| `yfinance:globalNavDynamicLinks` | Links dinâmicos do menu global |
| `yfinance:partnerDropdown` | Dropdown de parceiros Yahoo |
| `yfinance:partnerDropdownFooter` | Parceiros no footer |
| `yfinance:featureEngagementCampaigns` | Campanhas de marketing segmentadas por subscription tier |

#### 13.9.3 Member Profile (`/xhr/member-profile`)

Retorna a configuração do **Dock** (barra inferior de portfolio):
```json
{
  "modules": ["watchlist", "portfolio", "news", "calendar"],
  "order": ["watchlist", "portfolio", "news", "calendar"],
  "collapseState": {"watchlist": false, "portfolio": false}
}
```

#### 13.9.4 Stock Recommender (`/xhr/stock-recommender?symbol=INTC`)

Recomenda ações similares baseado em engine **Vespa** (sistema de busca do Yahoo):
```json
{
  "symbol": "INTC",
  "recommendations": [
    {"symbol": "AMD", "score": 0.95, "reason": "Direct competitor"},
    {"symbol": "NVDA", "score": 0.82, "reason": "Semiconductor peer"},
    {"symbol": "QCOM", "score": 0.71, "reason": "Chip manufacturer"}
  ]
}
```

#### 13.9.5 Calendar Events (`/ws/screeners/v1/finance/calendar-events`)

Eventos de calendário financeiro (earnings, dividends, splits):
```json
{
  "events": [
    {"type": "EARNINGS", "symbol": "INTC", "date": "2026-07-23",
     "estimate": {"eps": 0.35, "revenue": "12.8B"}}
  ]
}
```

#### 13.9.6 Earnings Event (`/xhr/earnings-event`)

Dados específicos de earnings call (transcript, áudio, slides):
```json
{
  "symbol": "INTC",
  "eventDate": "2026-07-23",
  "transcript": "Operator: Good afternoon...",
  "audioUrl": "https://...",
  "presentationUrl": "https://...",
  "keyMetrics": {"eps": 0.42, "revenue": "13.2B", "guidance": "Q3: $13.5B"}
}
```

#### 13.9.7 Header Nav (`/xhr/header/nav`)

Menu de navegação completo do Yahoo com centenas de links categorizados:
```json
{
  "categories": [
    {"name": "Markets", "items": [{"label": "Stock Market Today", "url": "..."}]},
    {"name": "Industries", "items": [...]},
    {"name": "Personal Finance", "items": [...]}
  ]
}
```

#### 13.9.8 Nexus Gateway (`nexus-gateway-prod.media.yahoo.com`)

Gateway de content stream para assets de mídia (imagens, vídeos). Usado para
carregar gráficos, fotos de empresas, e conteúdo multimídia. Endpoint:
```
nexus-gateway-prod.media.yahoo.com/v1/stream/{assetId}?format=webp&quality=80
```

### 13.10 Resumo de Validação

| Descoberta | Status | Fonte |
|------------|--------|-------|
| Crumb é único por sessão e reutilizado em todas as chamadas | **Confirmado** | Mesmo `cyTGwg2dwqw` em 21+ endpoints |
| SvelteKit como framework frontend | **Confirmado** | `__sveltekit`, `data-sveltekit-fetched`, hash-based assets |
| Premium tier mappings | **Confirmado** | `YAHOO.context.premiumTiersMeta` |
| TCF/GPP/USP stubs inline | **Confirmado** | HTML com `__tcfapi`, `__gpp`, `__uspapi` |
| Ad slots na quote page | **Confirmado** | `/22888152279/us/yfin/quote/dt/` com 5 slots |
| Asset manifest com bundles por feature | **Confirmado** | 28 bundles com hashes SHA256 |
| Feature flags via LaunchDarkly | **Confirmado** | `YAHOO.context.ld` com ~150+ flags |
| Price Insights com IA | **Novo** | `/ws/company-fundamentals/v1/finance/price-insights` |
| CDS content delivery | **Novo** | `/xhr/cds?schemaId=...` com 4 schemas |
| Member profile + Dock config | **Novo** | `/xhr/member-profile` |
| Stock recommender (Vespa) | **Novo** | `/xhr/stock-recommender` |
| Calendar events via screener | **Novo** | `/ws/screeners/v1/finance/calendar-events` |
| Earnings event | **Novo** | `/xhr/earnings-event` |
| Header nav | **Novo** | `/xhr/header/nav` |
| Nexus media gateway | **Novo** | `nexus-gateway-prod.media.yahoo.com` |

---

## Referências externas

- [yfinance GitHub](https://github.com/ranaroussi/yfinance) — repositório oficial
- [yahoo-finance2 GitHub](https://github.com/gadicc/yahoo-finance2) — implementação TypeScript/Deno da API Yahoo Finance (769 stars)
- [protobufjs](https://github.com/protobufjs/protobuf.js) — biblioteca JS para Protobuf
- [curl_cffi](https://github.com/yifeikong/curl_cffi) — libcurl com impersonação TLS
- [Yahoo Finance API undocumented](https://github.com/gadicc/node-yahoo-finance2) — documentação community-driven
- [Vespa.ai](https://vespa.ai/) — motor de busca usado pelo Yahoo Finance
- [DataDome](https://datadome.co/) / [Akamai Bot Manager](https://www.akamai.com/products/bot-manager) — prováveis fornecedores da tecnologia de bot detection
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) — protocolo para integração LLM-ferramentas
- [Deno](https://deno.com/) — runtime JavaScript/TypeScript usado pelo yahoo-finance2
