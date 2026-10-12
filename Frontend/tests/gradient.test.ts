import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(selector + " {");
  assert.ok(start >= 0, `${selector} rule not found`);
  return css.slice(start, css.indexOf("\n}", start));
};

// Regression: the ambient gradient once used near-cream pastels at high alpha (light) and 7-10% alpha pools (dark), so it rendered as flat.
for (const selector of ['body::before', 'html[data-theme="dark"] body::before']) {
  test(`${selector}: has a solid multi-stop base and colour pools that are strong enough to see`, () => {
    const rule = block(selector);
    assert.match(rule, /linear-gradient\(160deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} \d\d%, #[0-9a-f]{6} 100%\)/i, "needs a 3-stop base gradient");
    const alphas = [...rule.matchAll(/radial-gradient\([^;]*?rgb\(\d+ \d+ \d+ \/ ([\d.]+)\)/g)].map((m) => Number(m[1]));
    assert.equal(alphas.length, 3, "expected three colour pools");
    for (const a of alphas) assert.ok(a >= 0.3, `pool alpha ${a} is too faint to see`);
  });
}
