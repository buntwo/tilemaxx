import { parentPort } from "node:worker_threads";
import { Lexicon } from "../shared/lexicon";
import { decodeProfileVocabulary } from "../shared/profile-vocabulary";
import { apiPlayerProfiles } from "./api-player-profiles";
import {
  createCandidateAnalyzer,
  type CandidateRequest,
} from "../src/candidate-analysis-jobs";

let analyze: ReturnType<typeof createCandidateAnalyzer>;
parentPort!.on("message", ({ job, dictionary }: CandidateRequest) => {
  if (dictionary) {
    const lexicon = Lexicon.fromIndex(dictionary);
    analyze = createCandidateAnalyzer(lexicon, ({ root, vocabulary, position }) =>
      apiPlayerProfiles(root, lexicon, position.template,
        vocabulary && decodeProfileVocabulary(vocabulary, [...lexicon.words()].sort())));
  }
  parentPort!.postMessage(analyze(job));
});
