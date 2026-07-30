/**
 * Loader smoke test for LoCoMo V2 dataset.
 *
 * Runs the real loader against the V2 JSON and asserts structural invariants.
 * Does not require an API key, server, or any external service.
 */

import { loadLoCoMoDatasetFromJson } from "./src/dataset.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`✗ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

const datasetPath = "./dataset/locomo_v2.json";
console.log(`Loading ${datasetPath}...\n`);

const samples = await loadLoCoMoDatasetFromJson(datasetPath);

console.log("=== Per-sample summary ===");
const categoryTotals: Record<number, number> = {};
let grandTotal = 0;
let grandNonEmptyAnswers = 0;

for (const sample of samples) {
  const qaCount = sample.qa_pairs.length;
  const cats: Record<number, number> = {};
  let nonEmpty = 0;
  for (const qa of sample.qa_pairs) {
    cats[qa.category] = (cats[qa.category] ?? 0) + 1;
    categoryTotals[qa.category] = (categoryTotals[qa.category] ?? 0) + 1;
    if (qa.answer && qa.answer.trim().length > 0) {
      nonEmpty++;
    }
  }
  grandTotal += qaCount;
  grandNonEmptyAnswers += nonEmpty;
  console.log(
    `  ${sample.sample_id}: ${qaCount} QA, ${nonEmpty} non-empty, cats=${JSON.stringify(cats)}`,
  );
}

console.log("\n=== Totals ===");
console.log(`  samples: ${samples.length}`);
console.log(`  total QA: ${grandTotal}`);
console.log(`  non-empty answers: ${grandNonEmptyAnswers}`);
console.log(`  by category: ${JSON.stringify(categoryTotals)}`);

console.log("\n=== Assertions ===");
assert(samples.length === 10, "samples.length === 10");

for (const sample of samples) {
  assert(
    sample.qa_pairs.length >= 80 && sample.qa_pairs.length <= 250,
    `${sample.sample_id} QA count ${sample.qa_pairs.length} is between 80 and 250`,
  );

  const hasNonEmpty = sample.qa_pairs.some(
    (qa) => qa.answer && qa.answer.trim().length > 0,
  );
  assert(hasNonEmpty, `${sample.sample_id} has at least one non-empty answer`);

  for (const qa of sample.qa_pairs) {
    assert(
      qa.answer && qa.answer.trim().length > 0,
      `${sample.sample_id} QA has non-empty answer (question: "${qa.question.slice(0, 60)}...")`,
    );
    assert(
      Array.isArray(qa.evidence),
      `${sample.sample_id} QA has evidence array (loader populated with [])`,
    );
  }
}

console.log("\n✅ All smoke test assertions passed.");
