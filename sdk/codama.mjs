// Generate the provider SDK (TypeScript + Rust clients) from the Anchor IDL.
//
//   1. anchor build              # emits target/idl/reflect_allocation.json
//   2. cd sdk && npm install && npm run generate
//
// Output:
//   sdk/ts/generated     — TypeScript client (instruction builders, account fetchers)
//   sdk/rust/generated   — Rust client
//
// These give third parties everything needed to register as an operator and submit
// into a DataFeed or AllocationConsensus (the "provider SDK" success criterion).

import { readFileSync } from "node:fs";
import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor as renderJs } from "@codama/renderers-js";
import { renderVisitor as renderRust } from "@codama/renderers-rust";

const IDL_PATH = process.env.IDL_PATH ?? "../target/idl/reflect_allocation.json";

const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
const codama = createFromRoot(rootNodeFromAnchor(idl));

codama.accept(renderJs("ts/generated"));
codama.accept(renderRust("rust/generated", { crateFolder: "rust" }));

console.log("Generated TS client -> sdk/ts/generated, Rust client -> sdk/rust/generated");
