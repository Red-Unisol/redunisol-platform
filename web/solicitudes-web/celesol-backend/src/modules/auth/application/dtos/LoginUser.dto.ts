import type { RequestMetadata } from "../../domain/entities/RefreshToken.entity";

export type LoginUserDto = {
  identifier: string;
  metadata: RequestMetadata;
  password: string;
};
