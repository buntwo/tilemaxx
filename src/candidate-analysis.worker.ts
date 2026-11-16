import { Lexicon } from "../shared/lexicon";
import {
  createCandidateAnalyzer,
  type CandidateRequest,
} from "./candidate-analysis-jobs";

let analyze: ReturnType<typeof createCandidateAnalyzer>;
self.onmessage = ({
  data: { job, dictionary },
}: MessageEvent<CandidateRequest>) => {
  if (dictionary)
    analyze = createCandidateAnalyzer(Lexicon.fromIndex(dictionary));
  self.postMessage(analyze(job));
};
