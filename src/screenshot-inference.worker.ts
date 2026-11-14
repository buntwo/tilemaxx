import { inferWordfeudPremiums } from "../shared/infer-premiums";

export type InferenceRequest = Parameters<typeof inferWordfeudPremiums>;

self.onmessage = ({ data }: MessageEvent<InferenceRequest>) => {
  self.postMessage(inferWordfeudPremiums(...data));
};
