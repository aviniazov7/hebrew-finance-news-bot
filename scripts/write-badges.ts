import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

interface Metric {
  total: number;
  covered: number;
  pct: number;
}

interface CoverageSummary {
  total: {
    lines: Metric;
  };
}

interface VitestReport {
  numPassedTests: number;
  numFailedTests: number;
  success: boolean;
}

const summary = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8")) as CoverageSummary;
const report = JSON.parse(readFileSync("coverage/vitest-report.json", "utf8")) as VitestReport;

if (!report.success || report.numFailedTests > 0) {
  throw new Error(`Refusing to write badges: ${report.numFailedTests} test(s) failed`);
}

const linesPct = summary.total.lines.pct;
mkdirSync("badges", { recursive: true });
writeFileSync("badges/coverage.svg", badge("coverage", `${formatPct(linesPct)}%`, coverageColor(linesPct)));
writeFileSync("badges/tests.svg", badge("tests", `${report.numPassedTests} passed`, "#4c1"));

function formatPct(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function coverageColor(pct: number): string {
  if (pct >= 80) return "#4c1";
  if (pct >= 70) return "#97CA00";
  if (pct >= 60) return "#dfb317";
  return "#e05d44";
}

function badge(label: string, value: string, color: string): string {
  const labelWidth = textWidth(label);
  const valueWidth = textWidth(value);
  const total = labelWidth + valueWidth;
  const labelX = Math.round(labelWidth / 2);
  const valueX = labelWidth + Math.round(valueWidth / 2);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escapeXml(label)}: ${escapeXml(value)}">
  <title>${escapeXml(label)}: ${escapeXml(value)}</title>
  <linearGradient id="smooth" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="round">
    <rect width="${total}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#round)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#smooth)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelX}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${labelX}" y="14">${escapeXml(label)}</text>
    <text x="${valueX}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(value)}</text>
    <text x="${valueX}" y="14">${escapeXml(value)}</text>
  </g>
</svg>
`;
}

function textWidth(text: string): number {
  return Math.ceil(text.length * 7.1) + 14;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
