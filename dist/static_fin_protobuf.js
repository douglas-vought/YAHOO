"use strict";
const protobuf = require("protobufjs");
const path = require("path");

// Runtime loader: loads the .proto at runtime using protobufjs
// This file is intended as a runtime fallback when generated static modules
// are not available. For a fully static build, run pbjs/pbts as described in README.DEV.md

const root = protobuf.loadSync(path.join(__dirname, "..", "protos", "quotefeeder.proto"));

module.exports = { roots: { default: root } };
