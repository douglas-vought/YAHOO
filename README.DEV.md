# Development README — protobuf and streamer analysis

This document explains how to regenerate static JS/TS protobuf artifacts, how to use them to decode runtime messages, and what the beautified streamer files contain.

Files added in branch feat/add-proto-and-beautified-streamer:

- protos/quotefeeder.proto            (Protobuf schema generated from webcore/_staticFinProtobuf.js)
- dist/static_fin_protobuf.js         (runtime loader using protobufjs)
- dist/static_fin_protobuf.d.ts      (minimal TypeScript declaration)
- webcore/streamer.beautified.js     (beautified + annotated streamer main-thread glue)
- webcore/streamer.worker.beautified.js (beautified + annotated streamer worker)
- scripts/generate_protobuf.sh       (helper to generate static pbjs + d.ts)

Generate static artifacts (recommended)

1) Install dependencies:

   npm install --save-dev protobufjs

2) Generate static JS module + d.ts (produces dist/static_fin_protobuf.js and .d.ts):

   npx pbjs -t static-module -w commonjs -o dist/static_fin_protobuf.js protos/quotefeeder.proto
   npx pbts -o dist/static_fin_protobuf.d.ts dist/static_fin_protobuf.js

The generated static module will let you decode protobuf messages without requiring runtime .proto loading.

Quick decode example (Node):

```js
const protobuf = require('./dist/static_fin_protobuf.js');
const base64 = '<BASE64_FROM_WS_MESSAGE>';
const bytes = Buffer.from(base64, 'base64');
const PricingData = protobuf.roots.default.lookupType('quotefeeder.PricingData');
const decoded = PricingData.decode(bytes);
console.log(PricingData.toObject(decoded, { enums: String, longs: String, defaults: true }));
```

Notes
- The runtime loader (dist/static_fin_protobuf.js) requires the package `protobufjs` to be installed in your environment.
- The proto contains enums (QuoteType, MarketHours, OptionType) and messages (PricingData, StaticData, PriceUpdate, StaticUpdate).

Beautified files
- webcore/streamer.beautified.js and webcore/streamer.worker.beautified.js are formatted and annotated versions of the original bundles focusing on decoding, subscribe/unsubscribe flow, and the seed logic (XHR to v7/finance/quote using crumb). Use them to understand the runtime flow and to extract logic for a standalone client.

