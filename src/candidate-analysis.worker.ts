import { Lexicon } from "../shared/lexicon";
import {
  analyzeCandidate,
  type CandidateRequest,
} from "./candidate-analysis-jobs";

let lexicon: Lexicon;
self.onmessage = ({
  data: { job, dictionary },
}: MessageEvent<CandidateRequest>) => {
  if (dictionary) lexicon = Lexicon.fromIndex(dictionary);
  self.postMessage(analyzeCandidate(lexicon, job));
};
