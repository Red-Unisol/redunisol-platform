import type { RefreshTokenRepository } from "../../domain/repositories/RefreshTokenRepository";
import type { RefreshTokenPrismaDatasource } from "../datasources/RefreshTokenPrismaDatasource";

export class RefreshTokenRepositoryImpl implements RefreshTokenRepository {
  private readonly datasource: RefreshTokenPrismaDatasource;

  constructor(datasource: RefreshTokenPrismaDatasource) {
    this.datasource = datasource;
  }

  create(input: Parameters<RefreshTokenRepository["create"]>[0]) {
    return this.datasource.create(input);
  }

  findByHash(tokenHash: string) {
    return this.datasource.findByHash(tokenHash);
  }

  revoke(tokenHash: string, replacedByTokenHash?: string) {
    return this.datasource.revoke(tokenHash, replacedByTokenHash);
  }

  rotate(input: Parameters<RefreshTokenRepository["rotate"]>[0]) {
    return this.datasource.rotate(input);
  }
}
