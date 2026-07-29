/*! For license information please see streamer.worker.b2e9d70a74927f1418be.worker.js.LICENSE.txt */ ! function() {
    "use strict";

    function e(t) {
        return e = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(e) {
            return typeof e
        } : function(e) {
            return e && "function" == typeof Symbol && e.constructor === Symbol && e !== Symbol.prototype ? "symbol" : typeof e
        }, e(t)
    }

    function t(t, s, r) {
        return n = function(t, s) {
            if ("object" != e(t) || !t) return t;
            var r = t[Symbol.toPrimitive];
            if (void 0 !== r) {
                var n = r.call(t, "string");
                if ("object" != e(n)) return n;
                throw new TypeError("@@toPrimitive must return a primitive value.")
            }
            return String(t)
        }(s), (s = "symbol" == e(n) ? n : String(n)) in t ? Object.defineProperty(t, s, {
            value: r,
            enumerable: !0,
            configurable: !0,
            writable: !0
        }) : t[s] = r, t;
        var n
    }

    function s(e, t) {
        let s;
        return function() {
            for (var r = arguments.length, n = new Array(r), o = 0; o < r; o++) n[o] = arguments[o];
            clearTimeout(s), s = setTimeout((() => e(...n)), t)
        }
    }

    function r(e, t) {
        if (isNaN(e)) return e;
        const s = Math.pow(10, t);
        return +Math.round(e * s) / s
    }
    class n {
        constructor(e, t) {
            this.symbolList = [], this.protobuf = e, this.retries = 0, this.useStaging = !1, this.batchedUnsubscriptions = [], this.sendConnection = s(t, 1e3), this.unsubscribeFromConnection = s((() => {
                t(JSON.stringify({
                    unsubscribe: this.batchedUnsubscriptions
                })), this.batchedUnsubscriptions = []
            }), 1e3)
        }
        reset() {
            this.symbolList = [], this.batchedUnsubscriptions = [], this.retries = 0
        }
    }
    class o extends n {
        constructor(e, s, r) {
            super(e, r), t(this, "handleWebSocketUpdate", (e => {
                try {
                    const {
                        EarningSignals: t
                    } = this.protobuf.roots.default.earningsignals;
                    let s = t.decode(e);
                    s = t.toObject(s, {
                        enums: String
                    }), Array.isArray(s) || (s = [s]);
                    const r = {};
                    s.forEach((e => {
                        const {
                            symbol: t
                        } = e ?? {};
                        t && (r[t] = {
                            ...s[0]
                        })
                    })), this.messagePort.postMessage({
                        subscriberType: "earnings",
                        earningsData: r
                    })
                } catch (e) {
                    console.error("> Error from Finance Earnings Streamer:", e)
                }
            })), this.messagePort = s
        }
        subscribe(e) {
            const t = e.symbols.filter((e => e.toLowerCase().indexOf("_earnings") > -1));
            this.symbolList = [...new Set([...this.symbolList, ...t])], this.sendConnection(JSON.stringify({
                subscribe: this.symbolList
            }))
        }
        unsubscribe(e) {
            const {
                symbols: t
            } = e, s = new Set(t), r = [], n = [];
            this.symbolList.forEach((e => {
                s.has(e) ? n.push(e) : r.push(e)
            })), this.symbolList = n, r.length > 0 && (this.batchedUnsubscriptions.push(...r), this.unsubscribeFromConnection())
        }
    }
    const i = {
        event_type: "eventType",
        asset_id: "assetId",
        best_bid: "bestBid",
        best_ask: "bestAsk",
        price_changes: "priceChanges",
        old_tick_size: "oldTickSize",
        new_tick_size: "newTickSize",
        fee_rate_bps: "feeRateBps"
    };

    function a(e) {
        return Array.isArray(e) ? e.map(a) : null !== e && "object" == typeof e ? Object.fromEntries(Object.entries(e).map((e => {
            let [t, s] = e;
            return [i[t] || t, a(s)]
        }))) : e
    }
    class c extends n {
        constructor(e, s, r) {
            super(e, r), t(this, "handleWebSocketUpdate", (e => {
                try {
                    const {
                        MarketEvent: t
                    } = this.protobuf.roots.default.polymarket;
                    let s = t.decode(e);
                    s = t.toObject(s, {
                        enums: String
                    }), Array.isArray(s) || (s = [s]);
                    const r = {};
                    s.forEach((e => {
                        const {
                            event_type: t,
                            price_changes: s,
                            asset_id: n
                        } = e ?? {};
                        ("PRICE_CHANGE" === t ? (s || []).map((e => e.asset_id)).filter(Boolean) : [n].filter(Boolean)).forEach((t => {
                            const s = this.symbolList.find((e => e.startsWith(t)));
                            s && (r[s] = a(e))
                        }))
                    })), this.messagePort.postMessage({
                        subscriberType: "polymarket",
                        polymarketData: r
                    })
                } catch (e) {
                    console.error("> Error from Finance Polymarket Streamer:", e)
                }
            })), this.messagePort = s
        }
        subscribe(e) {
            const t = e.symbols.filter((e => e.endsWith("_PM")));
            this.symbolList = [...new Set([...this.symbolList, ...t])], this.sendConnection(JSON.stringify({
                subscribe: this.symbolList
            }))
        }
        unsubscribe(e) {
            const {
                symbols: t
            } = e, s = new Set(t), r = [], n = [];
            this.symbolList.forEach((e => {
                s.has(e) ? n.push(e) : r.push(e)
            })), this.symbolList = n, r.length > 0 && (this.batchedUnsubscriptions.push(...r), this.unsubscribeFromConnection())
        }
    }
    const u = {
            id: "symbol",
            dayVolume: "volume",
            dayHigh: "high",
            dayLow: "low",
            marketcap: "marketCap",
            marketHours: "marketState",
            openPrice: "regularMarketOpen",
            fromcurrency: "fromCurrency",
            vol_24hr: "volume24Hr",
            volAllCurrencies: "volumeAllCurrencies"
        },
        h = {
            ask: !0,
            askSize: !0,
            bid: !0,
            bidSize: !0,
            dayLow: !0,
            dayHigh: !0,
            expireDate: !0
        },
        l = {},
        b = {
            change: !0,
            changePercent: !0,
            previousClose: !0,
            price: !0
        },
        m = ["currency", "fromCurrency", "toCurrency", "exchangeTimezoneName", "exchangeTimezoneShortName", "gmtOffSetMilliseconds", "regularMarketChange", "regularMarketChangePercent", "regularMarketPrice", "regularMarketTime", "preMarketChange", "preMarketChangePercent", "preMarketPrice", "preMarketTime", "priceHint", "postMarketChange", "postMarketChangePercent", "postMarketPrice", "postMarketTime", "extendedMarketChange", "extendedMarketChangePercent", "extendedMarketPrice", "extendedMarketTime", "overnightMarketChange", "overnightMarketChangePercent", "overnightMarketPrice", "overnightMarketTime"];
    class d extends n {
        constructor(e, n, o, i) {
            let a = arguments.length > 4 && void 0 !== arguments[4] && arguments[4];
            super(e, i), t(this, "handleWebSocketUpdate", (e => {
                try {
                    const {
                        PricingData: t
                    } = this.protobuf.roots.default.quotefeeder;
                    let s = t.decode(e);
                    s = t.toObject(s, {
                        enums: String
                    }), Array.isArray(s) || (s = [s]), s.forEach((e => {
                        const {
                            id: t
                        } = e ?? {};
                        if (t) {
                            const s = function(e) {
                                const t = {},
                                    s = {},
                                    {
                                        marketHours: n
                                    } = e,
                                    o = e.priceHint || 2;
                                let i, a = "";
                                switch (n) {
                                    case "PRE_MARKET":
                                        a = "preMarket", i = "PRE";
                                        break;
                                    case "REGULAR_MARKET":
                                        a = "regularMarket", i = "REGULAR";
                                        break;
                                    case "POST_MARKET":
                                        a = "postMarket", i = "POST";
                                        break;
                                    case "EXTENDED_HOURS_MARKET":
                                        a = "extendedMarket", i = "EXTENDED";
                                        break;
                                    case "OVERNIGHT_MARKET":
                                        a = "overnightMarket", i = "OVERNIGHT"
                                }
                                for (const n in e)
                                    if (Object.prototype.hasOwnProperty.call(e, n)) {
                                        const c = u[n] || n;
                                        let m = e[n];
                                        if (null == m || "" === m) continue;
                                        let d = c;
                                        switch (c) {
                                            case "previousClose":
                                            case "price":
                                            case "time":
                                            case "dayHigh":
                                            case "dayLow":
                                            case "volume":
                                            case "changePercent":
                                            case "change":
                                                b[c] && !isNaN(m) && (m = r(m, o)), "time" === c && (m /= 1e3), d = a + c[0].toUpperCase() + c.substr(1);
                                                break;
                                            case "marketState":
                                                m = i
                                        }
                                        h[d] ? (s[d] = m, d !== c && (s[c] = m)) : l[d] || (t[d] = m, d !== c && (t[c] = m))
                                    } return {
                                    price: t,
                                    summaryDetail: s
                                }
                            }(e);
                            this.quoteData[t] = {
                                ...this.quoteData[t],
                                ...s.price,
                                ...s
                            }
                        }
                    })), this.messagePort.postMessage({
                        subscriberType: "quote",
                        quoteData: this.quoteData
                    }), this.pfMessagePort.postMessage({
                        quoteData: this.quoteData
                    })
                } catch (e) {
                    console.error("> Error from Finance Quote Streamer:", e)
                }
            })), t(this, "handleQuoteRequest", ((e, t) => {
                if (!e && t) {
                    const e = t.quoteResponse?.result;
                    if (!e) return;
                    for (let t = 0; t < e.length; t++) {
                        const s = e[t],
                            {
                                symbol: r
                            } = s;
                        this.quoteData[r] = {
                            ...this.quoteData[r],
                            ...s
                        }
                    }
                    this.messagePort.postMessage({
                        subscriberType: "quote",
                        quoteData: this.quoteData
                    }), this.pfMessagePort.postMessage({
                        quoteData: this.quoteData
                    })
                } else console.error("> Error from Finance Quote Streamer:", e)
            })), this.crumb = "", this.fieldList = [], this.quoteData = {}, this.useFormattedSeeding = a, this.messagePort = n, this.pfMessagePort = o, this.seedQuoteData = s(this.seedQuoteData.bind(this), 500)
        }
        seedQuoteData() {
            const e = this.symbolList.filter((e => !this.quoteData[e]?.exchangeTimezoneName));
            if (e.length > 0 && this.crumb) {
                e.sort();
                const t = [
                    []
                ];
                let s = 0;
                for (let r = 0; r < e.length; r++) this.quoteData[r]?.currency || t[s].push(e[r]), 30 === t[s].length && (s++, t[s] = []);
                t.forEach((e => {
                    ! function(e, t) {
                        let {
                            timeout: s = null,
                            callback: r
                        } = t;
                        const n = new XMLHttpRequest;
                        null !== s && (n.timeout = s), n.withCredentials = !0, n.open("GET", e, !0), n.onload = () => {
                            let e = n.responseText;
                            if (n.status >= 200 && n.status < 300 && e) {
                                if ("string" == typeof e) try {
                                    e = JSON.parse(e)
                                } catch (e) {
                                    return void r({
                                        status: 502,
                                        message: e.message
                                    })
                                }
                                r(null, e)
                            } else r({
                                status: n.status || 502,
                                message: n.responseText
                            })
                        }, n.onerror = () => {
                            r({
                                status: n.status || 500,
                                message: n.responseText
                            })
                        }, n.send()
                    }(`https://query1.finance.yahoo.com/v7/finance/quote?&symbols=${e.join(",")}&fields=${m.join(",")}&crumb=${this.crumb||""}&formatted=${this.useFormattedSeeding??!1}&region=US&lang=en-US`, {
                        callback: this.handleQuoteRequest
                    })
                }))
            }
        }
        subscribe(e) {
            const {
                crumb: t,
                symbols: s = [],
                fields: r = []
            } = e || {}, n = this.symbolList.length;
            this.update({
                crumb: t,
                symbols: Array.from(new Set(s)),
                fields: r
            });
            const o = this.symbolList.length - n > 0;
            this.symbolList.length > 0 && o && this.sendConnectionAndSeed(JSON.stringify({
                subscribe: this.symbolList
            }), !0)
        }
        unsubscribe(e) {
            const {
                crumb: t,
                symbols: s = [],
                fields: r = []
            } = e || {}, n = new Set(s), o = [], i = [];
            this.symbolList.forEach((e => {
                n.has(e) ? i.push(e) : o.push(e)
            })), this.update({
                crumb: t,
                symbols: i,
                fields: r
            }), o.length > 0 && (this.batchedUnsubscriptions.push(...o), this.unsubscribeFromConnection())
        }
        update(e) {
            let {
                crumb: t,
                symbols: s,
                fields: r
            } = e;
            this.crumb = t || "", this.symbolList = s, this.fieldList = r
        }
        reset() {
            this.fieldList = [], this.symbolList = []
        }
        sendConnectionAndSeed(e) {
            let t = arguments.length > 1 && void 0 !== arguments[1] && arguments[1];
            this.sendConnection(e), t && this.seedQuoteData()
        }
    }
    class p {
        constructor(e) {
            let {
                onMessage: t,
                useStaging: s = !1
            } = e;
            this.connection = null, this.retries = 0, this.useStaging = s, this.onMessage = t
        }
        async init() {
            return new Promise(((e, t) => {
                const s = () => {
                    if (this.retries > 10) return void t(new Error("finWebCore: streamer connection retries exceeded, a new request is required to establish a connection"));
                    const r = this.useStaging ? "wss://streamer-stage.finance.yahoo.com?version=2" : "wss://streamer.finance.yahoo.com?version=2";
                    this.connection = new WebSocket(r), this.connection.addEventListener("open", (() => {
                        this.retries = 0, e()
                    })), this.connection.addEventListener("error", (e => {
                        e && "ECONNREFUSED" === e.code && (this.retries++, s())
                    })), this.connection.addEventListener("close", (e => {
                        e && 1e3 !== e.code && (this.retries++, s())
                    })), this.connection.addEventListener("message", this.onMessage)
                };
                s()
            }))
        }
        async send(e) {
            if (this.connection && this.connection.readyState === WebSocket.OPEN) this.connection.send(e);
            else {
                if (this.connection && this.connection.readyState === WebSocket.CONNECTING) return new Promise((t => {
                    const s = () => {
                        this.connection?.send(e), this.connection?.removeEventListener("open", s), t()
                    };
                    this.connection.addEventListener("open", s)
                }));
                this.retries = 0;
                try {
                    await this.init(), this.connection.send(e)
                } catch {
                    console.error("> finWebCore: streamer connection error, retries exceeded")
                }
            }
        }
        close() {
            this.connection && (this.connection.close(), this.connection = null)
        }
    }
    try {
        "function" == typeof importScripts && (importScripts("https://cdn.jsdelivr.net/npm/protobufjs@7.1.2/dist/minimal/protobuf.min.js"), importScripts("https://s.yimg.com/uc/finance/webcore/js/_staticFinProtobuf.4ac0aa7cd811394598dc.js"))
    } catch (e) {
        console.error("> Finance Streamer: Importing protobuf failed.", e)
    }
    protobuf || console.error("> Finance Streamer: Protobuff library missing so cannot use streamer");
    let g = null,
        f = null,
        y = null,
        S = null,
        k = null,
        M = null,
        E = !1;

    function v() {
        let e = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : void 0;
        return e ? "earnings" === e ? (f || (f = new o(protobuf, S, C)), f) : "quote" === e ? (g || (g = new d(protobuf, S, k, C, E)), g) : "polymarket" === e ? (y || (y = new c(protobuf, S, C)), y) : void 0 : null
    }

    function C(e) {
        M && M.send(e)
    }

    function P(e) {
        const t = JSON.parse(e.data.toString()),
            s = function(e) {
                const t = atob(e),
                    s = t.length,
                    r = new Uint8Array(s);
                for (let e = 0; e < s; e++) r[e] = t.charCodeAt(e);
                return r
            }(t.message);
        "earnings" === t.type && v("earnings").handleWebSocketUpdate(s), "pricing" === t.type && v("quote").handleWebSocketUpdate(s), "polymarket" === t.type && v("polymarket").handleWebSocketUpdate(s)
    }

    function w(e) {
        const {
            data: t
        } = e, {
            subscriberType: s
        } = t;
        switch (t.cmd) {
            case "subscribe":
                v(s).subscribe(t);
                break;
            case "unsubscribe":
                v(s).unsubscribe(t);
                break;
            case "destroy":
                v("quote").reset(), v("earnings").reset(), v("polymarket").reset(), M && (M.close(), M = null)
        }
    }
    addEventListener("message", (async e => {
        const {
            data: t
        } = e;
        switch (t.cmd) {
            case "init":
                [S] = e.ports, S.onmessage = w, M = new p({
                    onMessage: P,
                    useStaging: t.useStagingStreamer ?? !1
                }), E = t.formattedSeeding ?? !1;
                try {
                    await M.init(), S.postMessage({
                        cmd: M.connection ? "connected" : "Connection failed"
                    })
                } catch {
                    S.postMessage({
                        cmd: "error",
                        message: "Connection failed"
                    })
                }
                break;
            case "init-qpf":
                [k] = e.ports, k.onmessage = () => {}, k.postMessage({
                    cmd: "Hello Portfolio worker from streamer worker"
                })
        }
    }), !1)
}();