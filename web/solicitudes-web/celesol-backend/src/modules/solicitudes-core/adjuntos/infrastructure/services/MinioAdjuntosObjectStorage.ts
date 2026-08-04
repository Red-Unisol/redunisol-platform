import { Client } from "minio";

import type {
  AdjuntosObjectStorage,
  AdjuntosObjectStorageUploadInput,
} from "../../domain/services/AdjuntosObjectStorage";

type MinioAdjuntosObjectStorageDependencies = {
  accessKey: string;
  endPoint: string;
  port: number;
  secretKey: string;
  useSSL: boolean;
};

export class MinioAdjuntosObjectStorage implements AdjuntosObjectStorage {
  private readonly client: Client;

  constructor(dependencies: MinioAdjuntosObjectStorageDependencies) {
    this.client = new Client({
      accessKey: dependencies.accessKey,
      endPoint: dependencies.endPoint,
      port: dependencies.port,
      secretKey: dependencies.secretKey,
      useSSL: dependencies.useSSL,
    });
  }

  async uploadObject(input: AdjuntosObjectStorageUploadInput): Promise<void> {
    await this.client.putObject(
      input.bucket,
      input.key,
      input.body,
      input.body.length,
      {
        "Content-Type": input.contentType,
      },
    );
  }

  async getObjectStream(input: {
    bucket: string;
    key: string;
  }): Promise<NodeJS.ReadableStream> {
    return this.client.getObject(input.bucket, input.key);
  }

  async deleteObject(input: { bucket: string; key: string }): Promise<void> {
    await this.client.removeObject(input.bucket, input.key);
  }
}
