import { renderSamples } from "../src/samples.ts";

console.log("FIXTURE SAMPLES — not a live Gemini call. Rendered by the same formatter the bot uses.");
console.log("");
for (const sample of renderSamples()) {
  console.log(`----- ${sample.categoryId} -----`);
  console.log(sample.text);
  console.log("");
}
