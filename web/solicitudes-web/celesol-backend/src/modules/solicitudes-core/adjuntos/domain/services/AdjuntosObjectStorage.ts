export type AdjuntosObjectStorageUploadInput = {
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
};

export type AdjuntosObjectStorage = {
  deleteObject(input: { bucket: string; key: string }): Promise<void>;
  getObjectStream(
    input: { bucket: string; key: string },
  ): Promise<NodeJS.ReadableStream>;
  uploadObject(input: AdjuntosObjectStorageUploadInput): Promise<void>;
};
