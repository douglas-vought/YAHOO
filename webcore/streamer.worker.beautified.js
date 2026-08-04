/*
  Beautified and annotated version of streamer.worker.hash.worker.js
  Focus: decode path, WebSocket wrapper, handler classes (Quote, Polymarket, Earnings)
*/

/* eslint-disable no-undef */
(function () {
  'use strict';

  // Utilities
  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function roundTo(value, digits) {
    if (isNaN(value)) return value;
    const s = Math.pow(10, digits);
    return Math.round(value * s) / s;
  }

  // Base Subscriber handler with common utilities
  class SubscriberBase {
    constructor(protobufRoot, sendConnectionFn) {
      this.symbolList = [];
      this.protobuf = protobufRoot; // protobuf root loaded at worker runtime
      this.retries = 0;
      this.useStaging = false;
      this.batchedUnsubscriptions = [];
      this.sendConnection = debounce(sendConnectionFn, 1000);
      this.unsubscribeFromConnection = debounce(() => {
        if (this.batchedUnsubscriptions.length > 0) {
          sendConnectionFn(JSON.stringify({ unsubscribe: this.batchedUnsubscriptions }));
          this.batchedUnsubscriptions = [];
        }
      }, 1000);
    }
    reset() {
      this.symbolList = [];
      this.batchedUnsubscriptions = [];
      this.retries = 0;
    }
  }

  // Earnings handler (decodes EarningSignals messages)
  class EarningsHandler extends SubscriberBase {
    constructor(protobufRoot, messagePort, sendConnectionFn) {
      super(protobufRoot, sendConnectionFn);
      this.messagePort = messagePort;
    }

    handleWebSocketUpdate(bytes) {
      try {
        const EarningSignals = this.protobuf.roots.default.earningsignals.EarningSignals;
        let decoded = EarningSignals.decode(bytes);
        decoded = EarningSignals.toObject(decoded, { enums: String });
        const rows = Array.isArray(decoded) ? decoded : [decoded];
        const output = {};
        rows.forEach((row) => {
          const symbol = row?.symbol;
          if (symbol) output[symbol] = { ...row };
        });
        this.messagePort.postMessage({ subscriberType: 'earnings', earningsData: output });
      } catch (err) {
        console.error('> Error from Finance Earnings Streamer:', err);
      }
    }

    subscribe(msg) {
      const symbols = (msg.symbols || []).filter((s) => s.toLowerCase().includes('_earnings'));
      this.symbolList = Array.from(new Set([...this.symbolList, ...symbols]));
      this.sendConnection(JSON.stringify({ subscribe: this.symbolList }));
    }

    unsubscribe(msg) {
      const symbols = msg.symbols || [];
      const keep = this.symbolList.filter((s) => !symbols.includes(s));
      const removed = this.symbolList.filter((s) => symbols.includes(s));
      this.symbolList = keep;
      if (removed.length > 0) {
        this.batchedUnsubscriptions.push(...removed);
        this.unsubscribeFromConnection();
      }
    }
  }

  // Helper: snake_case -> camelCase mapping (recursive)
  const snakeToCamelMap = {
    event_type: 'eventType',
    asset_id: 'assetId',
    best_bid: 'bestBid',
    best_ask: 'bestAsk',
    price_changes: 'priceChanges',
  };

  function transformSnakeToCamel(obj) {
    if (Array.isArray(obj)) return obj.map(transformSnakeToCamel);
    if (obj && typeof obj === 'object') {
      const entries = Object.entries(obj).map(([k, v]) => {
        const nk = snakeToCamelMap[k] || k;
        return [nk, transformSnakeToCamel(v)];
      });
      return Object.fromEntries(entries);
    }
    return obj;
  }

  // Polymarket Handler (MarketEvent)
  class PolymarketHandler extends SubscriberBase {
    constructor(protobufRoot, messagePort, sendConnectionFn) {
      super(protobufRoot, sendConnectionFn);
      this.messagePort = messagePort;
    }

    handleWebSocketUpdate(bytes) {
      try {
        const MarketEvent = this.protobuf.roots.default.polymarket.MarketEvent;
        let decoded = MarketEvent.decode(bytes);
        decoded = MarketEvent.toObject(decoded, { enums: String });
        const rows = Array.isArray(decoded) ? decoded : [decoded];
        const out = {};
        rows.forEach((r) => {
          const { event_type, price_changes, asset_id } = r || {};
          // pick symbols affected and map back to subscribed symbolList entries
          // then transform snake_case -> camelCase for payload
          const candidates = (price_changes || []).map((pc) => pc.asset_id).filter(Boolean);
          const keys = candidates.length ? candidates : [asset_id].filter(Boolean);
          keys.forEach((k) => {
            const s = this.symbolList.find((sym) => sym.startsWith(k));
            if (s) out[s] = transformSnakeToCamel(r);
          });
        });
        this.messagePort.postMessage({ subscriberType: 'polymarket', polymarketData: out });
      } catch (err) {
        console.error('> Error from Finance Polymarket Streamer:', err);
      }
    }

    subscribe(msg) {
      const symbols = (msg.symbols || []).filter((s) => s.endsWith('_PM'));
      this.symbolList = Array.from(new Set([...this.symbolList, ...symbols]));
      this.sendConnection(JSON.stringify({ subscribe: this.symbolList }));
    }

    unsubscribe(msg) {
      const symbols = msg.symbols || [];
      const keep = this.symbolList.filter((s) => !symbols.includes(s));
      const removed = this.symbolList.filter((s) => symbols.includes(s));
      this.symbolList = keep;
      if (removed.length > 0) {
        this.batchedUnsubscriptions.push(...removed);
        this.unsubscribeFromConnection();
      }
    }
  }

  // Quote Handler (PricingData)
  class QuoteHandler extends SubscriberBase {
    constructor(protobufRoot, messagePort, pfMessagePort, seedFn, useFormattedSeeding) {
      super(protobufRoot, seedFn);
      this.messagePort = messagePort; // main UI
      this.pfMessagePort = pfMessagePort; // portfolio worker
      this.crumb = '';
      this.fieldList = [];
      this.quoteData = {}; // symbol -> aggregated data
      this.useFormattedSeeding = !!useFormattedSeeding;
    }

    handleWebSocketUpdate(bytes) {
      try {
        const PricingData = this.protobuf.roots.default.quotefeeder.PricingData;
        let decoded = PricingData.decode(bytes);
        decoded = PricingData.toObject(decoded, { enums: String });
        const rows = Array.isArray(decoded) ? decoded : [decoded];
        rows.forEach((item) => {
          const symbol = item?.id;
          if (!symbol) return;
          const normalized = this._normalizePricing(item);
          this.quoteData[symbol] = { ...this.quoteData[symbol], ...normalized.price, ...normalized };
        });
        this.messagePort.postMessage({ subscriberType: 'quote', quoteData: this.quoteData });
        this.pfMessagePort.postMessage({ quoteData: this.quoteData });
      } catch (err) {
        console.error('> Error from Finance Quote Streamer:', err);
      }
    }

    _normalizePricing(item) {
      // maps fields from proto to UI-friendly names, applies rounding and time conversion
      const fieldMap = {
        id: 'symbol',
        dayVolume: 'volume',
        dayHigh: 'high',
        dayLow: 'low',
        marketcap: 'marketCap',
        marketHours: 'marketState',
        openPrice: 'regularMarketOpen',
        fromcurrency: 'fromCurrency',
      };
      const rounding = ['change', 'changePercent', 'price'];
      const priceObj = {};
      const summaryObj = {};

      const marketStateMap = {
        PRE_MARKET: 'PRE',
        REGULAR_MARKET: 'REGULAR',
        POST_MARKET: 'POST',
        EXTENDED_HOURS_MARKET: 'EXTENDED',
        OVERNIGHT_MARKET: 'OVERNIGHT',
      };

      const marketHours = item.marketHours;
      const prefix = marketHours ? marketHours.toLowerCase() : '';
      const priceHint = item.priceHint || 2;

      for (const k in item) {
        if (!Object.prototype.hasOwnProperty.call(item, k)) continue;
        let val = item[k];
        if (val === null || val === '') continue;
        let mapped = fieldMap[k] || k;

        if (['previousClose', 'price', 'time', 'dayHigh', 'dayLow', 'volume', 'changePercent', 'change'].includes(mapped)) {
          if (rounding.includes(mapped) && !isNaN(val)) val = roundTo(val, priceHint);
          if (mapped === 'time') val = val / 1000; // ms -> s
          mapped = prefix ? prefix + mapped.charAt(0).toUpperCase() + mapped.slice(1) : mapped;
        }

        if (mapped in { ask: 1 }) {
          summaryObj[mapped] = val;
        } else {
          priceObj[mapped] = val;
        }
      }

      return { price: priceObj, summaryDetail: summaryObj };
    }

    // seedQuoteData: fetch REST v7/finance/quote for symbols missing exchangeTimezoneName
    seedQuoteData() {
      const missing = this.symbolList.filter((s) => !this.quoteData[s]?.exchangeTimezoneName);
      if (missing.length === 0 || !this.crumb) return;
      const chunks = [];
      for (let i = 0; i < missing.length; i += 30) chunks.push(missing.slice(i, i + 30));
      chunks.forEach((arr) => {
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?&symbols=${arr.join(',')}&fields=&crumb=${encodeURIComponent(this.crumb)}&formatted=${this.useFormattedSeeding}`;
        const xhr = new XMLHttpRequest();
        xhr.withCredentials = true;
        xhr.open('GET', url, true);
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
            try {
              const res = JSON.parse(xhr.responseText);
              this._handleQuoteResponse(null, res);
            } catch (err) {
              this._handleQuoteResponse({ status: 502, message: err.message });
            }
          } else {
            this._handleQuoteResponse({ status: xhr.status || 502, message: xhr.responseText });
          }
        };
        xhr.onerror = () => this._handleQuoteResponse({ status: xhr.status || 500, message: xhr.responseText });
        xhr.send();
      });
    }

    _handleQuoteResponse(err, data) {
      if (err) {
        console.error('> Error from Finance Quote Streamer:', err);
        return;
      }
      const results = data.quoteResponse?.result || [];
      results.forEach((s) => {
        const symbol = s.symbol;
        this.quoteData[symbol] = { ...this.quoteData[symbol], ...s };
      });
      this.messagePort.postMessage({ subscriberType: 'quote', quoteData: this.quoteData });
      this.pfMessagePort.postMessage({ quoteData: this.quoteData });
    }

    subscribe(msg) {
      const { crumb = '', symbols = [], fields = [] } = msg || {};
      const before = this.symbolList.length;
      this.crumb = crumb;
      this.symbolList = Array.from(new Set(symbols));
      this.fieldList = fields;
      const added = this.symbolList.length - before > 0;
      if (this.symbolList.length > 0 && added) this.sendConnectionAndSeed(JSON.stringify({ subscribe: this.symbolList }), true);
    }

    update(info) {
      this.crumb = info.crumb || '';
      this.symbolList = info.symbols || [];
      this.fieldList = info.fields || [];
    }

    reset() {
      this.fieldList = [];
      this.symbolList = [];
    }

    sendConnectionAndSeed(msg, seed) {
      this.sendConnection(msg);
      if (seed) this.seedQuoteData();
    }
  }

  // WebSocket wrapper used by the worker to connect to streamer.finance.yahoo.com
  class WSConnection {
    constructor({ onMessage, useStaging = false }) {
      this.connection = null;
      this.retries = 0;
      this.useStaging = useStaging;
      this.onMessage = onMessage;
    }

    async init() {
      return new Promise((resolve, reject) => {
        const attempt = () => {
          if (this.retries > 10) return reject(new Error('streamer connection retries exceeded'));
          const url = this.useStaging ? 'wss://streamer-stage.finance.yahoo.com?version=2' : 'wss://streamer.finance.yahoo.com?version=2';
          this.connection = new WebSocket(url);
          this.connection.addEventListener('open', () => {
            this.retries = 0;
            resolve();
          });
          this.connection.addEventListener('message', this.onMessage);
          this.connection.addEventListener('error', (e) => {
            this.retries++;
            setTimeout(attempt, 1000);
          });
          this.connection.addEventListener('close', (e) => {
            if (e && e.code !== 1000) {
              this.retries++;
              setTimeout(attempt, 1000);
            }
          });
        };
        attempt();
      });
    }

    async send(payload) {
      if (this.connection && this.connection.readyState === WebSocket.OPEN) {
        this.connection.send(payload);
        return;
      }
      if (this.connection && this.connection.readyState === WebSocket.CONNECTING) {
        return new Promise((resolve) => {
          const onOpen = () => { this.connection.removeEventListener('open', onOpen); this.connection.send(payload); resolve(); };
          this.connection.addEventListener('open', onOpen);
        });
      }
      try {
        await this.init();
        this.connection.send(payload);
      } catch (err) {
        console.error('> finWebCore: streamer connection error, retries exceeded');
      }
    }

    close() {
      if (this.connection) {
        this.connection.close();
        this.connection = null;
      }
    }
  }

  // At worker startup, the bundle imports protobuf runtime via importScripts in the original.
  // For our beautified copy we expect protobuf present on self.protobuf or to be provided at runtime.

  // Decoder dispatch: called when WS receives a message
  function onWSMessage(event) {
    try {
      const payload = JSON.parse(event.data.toString());
      const bytes = (function (b64) { // base64 -> Uint8Array
        const raw = atob(b64);
        const len = raw.length;
        const arr = new Uint8Array(len);
        for (let i = 0; i < len; i++) arr[i] = raw.charCodeAt(i);
        return arr;
      })(payload.message);

      if (payload.type === 'earnings') handlerFactory('earnings').handleWebSocketUpdate(bytes);
      if (payload.type === 'pricing') handlerFactory('quote').handleWebSocketUpdate(bytes);
      if (payload.type === 'polymarket') handlerFactory('polymarket').handleWebSocketUpdate(bytes);
    } catch (err) {
      console.error('Error parsing WS message', err);
    }
  }

  // Worker message handler: receives initialization and subscribe/unsubscribe commands from main thread
  function onWorkerMessage(e) {
    const { data } = e;
    switch (data.cmd) {
      case 'init':
        // Initialize WSConnection and set up ports
        break;
      case 'init-qpf':
        // portfolio worker port init
        break;
      default:
        // subscribe/unsubscribe/destroy handled by ports
        break;
    }
  }

  addEventListener('message', async (e) => {
    const { data } = e;
    if (data.cmd === 'init') {
      // In the original bundle importScripts was used to load protobuf and other deps
      // Here we rely on runtime environment providing protobuf and necessary libs.
      const [port] = e.ports;
      port.onmessage = (ev) => {
        // handle commands coming from main thread (subscribe/unsubscribe/destroy)
        const t = ev.data;
        if (t.cmd === 'subscribe') {/* ... */}
      };

      // Create websocket connection and attach onWSMessage as message handler
      const conn = new WSConnection({ onMessage: onWSMessage, useStaging: data.useStagingStreamer ?? false });
      try {
        await conn.init();
        port.postMessage({ cmd: 'connected' });
      } catch (err) {
        port.postMessage({ cmd: 'error', message: 'Connection failed' });
      }
    }
  }, false);
})();
