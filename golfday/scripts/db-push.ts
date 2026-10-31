import { mkdirSync } from "node:fs";

async function main() {
  mkdirSync("data", { recursive: true });
  await import("../src/db/push");
}

main();
