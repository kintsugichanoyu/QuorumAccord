// Generate both clients from the compiler-built, checked-in IDL snapshot.
// npm --prefix sdk run idl && npm --prefix sdk run build
// Output: sdk/ts/generated/ and sdk/rust/src/generated/ (ignored build products).

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor as renderJs } from "@codama/renderers-js";
import { renderVisitor as renderRust } from "@codama/renderers-rust";

const SDK = import.meta.dirname;
const IDL_PATH =
  process.env.IDL_PATH ?? resolve(SDK, "idl/quorum_allocation.json");

const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
const codama = createFromRoot(rootNodeFromAnchor(idl));

codama.accept(
  renderJs(SDK, {
    generatedFolder: "ts/generated",
    importExtension: "js",
    syncPackageJson: false,
  }),
);
codama.accept(
  renderRust(resolve(SDK, "rust"), {
    generatedFolder: "src/generated",
    anchorTraits: false,
    syncCargoToml: true,
  }),
);

const rustManifest = resolve(SDK, "rust/Cargo.toml");
writeFileSync(rustManifest, readFileSync(rustManifest, "utf8").trimEnd() + "\n");

console.log(
  "Generated TS client -> sdk/ts/generated, Rust client -> sdk/rust/src/generated",
);
