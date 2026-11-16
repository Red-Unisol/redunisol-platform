// An explicit evidence policy, never a fabricated MetaMap attempt.
export const EXTERNAL_LEGAJO_POLICY_VERSION = "external-legajo-v1";
export const MAX_EXTERNAL_FILES = 10;
export const MAX_EXTERNAL_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_EXTERNAL_TOTAL_BYTES = 32 * 1024 * 1024;

export type ExternalDocument = {
  name: string;
  contentType: string;
  size: number;
  sha256: string;
};
