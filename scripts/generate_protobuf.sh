#!/usr/bin/env bash
set -e

# Generate static protobuf JS + TypeScript declaration using protobufjs
# Requires: npm install --save-dev protobufjs

# From repository root:
# npx pbjs -t static-module -w commonjs -o dist/static_fin_protobuf.js protos/quotefeeder.proto
# npx pbts -o dist/static_fin_protobuf.d.ts dist/static_fin_protobuf.js

npx pbjs -t static-module -w commonjs -o dist/static_fin_protobuf.js protos/quotefeeder.proto
npx pbts -o dist/static_fin_protobuf.d.ts dist/static_fin_protobuf.js
