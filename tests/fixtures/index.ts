import type { Platform } from "@/lib/adapters/types";

import facebookFixture from "./facebook.json";
import instagramFixture from "./instagram.json";
import tiktokFixture from "./tiktok.json";
import youtubeFixture from "./youtube.json";

/**
 * Recorded platform fixtures (FSD §13): one file per platform, each entry a
 * recorded HTTP response in call order, so multi-call methods such as
 * Facebook's three-step `exchangeCode` replay correctly. Fixtures stay raw
 * data — the expected `AdapterErrorCode` for each recording lives in the
 * contract suite, not here.
 */
export interface RecordedResponse {
  status: number;
  body?: unknown;
}

export interface RecordedMethod {
  success: RecordedResponse[];
  errors: Record<string, RecordedResponse[]>;
}

export type ContractMethod = "exchangeCode" | "refresh" | "fetchProfile";

export type Recording = Record<ContractMethod, RecordedMethod>;

export const CONTRACT_METHODS: ContractMethod[] = [
  "exchangeCode",
  "refresh",
  "fetchProfile",
];

export const youtubeRecording = youtubeFixture as Recording;
export const tiktokRecording = tiktokFixture as Recording;
export const instagramRecording = instagramFixture as Recording;
export const facebookRecording = facebookFixture as Recording;

export const FIXTURES: Record<Platform, Recording> = {
  youtube: youtubeRecording,
  tiktok: tiktokRecording,
  instagram: instagramRecording,
  facebook: facebookRecording,
};

/** Reads one recorded response body, failing loudly when the recording is short. */
export function recordedBody(recording: RecordedResponse[], index: number): unknown {
  const entry = recording[index];

  if (!entry) {
    throw new Error(`Fixture recording is missing response ${index}`);
  }

  return entry.body;
}

/** Reads one recorded error sequence, failing loudly when the key is absent. */
export function errorRecording(
  recording: Recording,
  method: ContractMethod,
  key: string,
): RecordedResponse[] {
  const responses = recording[method].errors[key];

  if (!responses) {
    throw new Error(`Fixture recording is missing ${method}.${key}`);
  }

  return responses;
}
