import { parentPort } from "node:worker_threads";
import { Lexicon } from "../shared/lexicon";
import {
  createCandidateAnalyzer,
  type CandidateRequest,
} from "../src/candidate-analysis-jobs";

let analyze: ReturnType<typeof createCandidateAnalyzer>;
parentPort!.on("message", ({ job, dictionary }: CandidateRequest) => {
  if (dictionary)
    analyze = createCandidateAnalyzer(Lexicon.fromIndex(dictionary));
  parentPort!.postMessage(analyze(job));
});
