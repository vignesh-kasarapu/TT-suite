// theme.md §2: components read tokens only. Fails if a raw colour appears outside tokens.css.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const bad = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(css|tsx)$/.test(name) && !name.endsWith("tokens.css")) {
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        if (/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(line) && !line.includes("xlink:href") && !/href="#/.test(line)) bad.push(`${p}:${i + 1}: ${line.trim()}`);
      });
    }
  }
};
walk("src");
if (bad.length) {
  console.error("Raw colours found (use tokens):\n" + bad.join("\n"));
  process.exit(1);
}
console.log("No raw colours outside tokens.css");
