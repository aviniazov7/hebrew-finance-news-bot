import { readFileSync } from "node:fs";

interface Metric {
  total: number;
  covered: number;
  pct: number;
}

const summary = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8")) as {
  total: Record<string, Metric>;
};

console.log("Coverage summary");
for (const key of ["lines", "statements", "functions", "branches"]) {
  const row = summary.total[key];
  if (!row) throw new Error(`missing coverage metric: ${key}`);
  console.log(`${key.padEnd(12)} ${row.pct.toFixed(2)}% (${row.covered}/${row.total})`);
}
