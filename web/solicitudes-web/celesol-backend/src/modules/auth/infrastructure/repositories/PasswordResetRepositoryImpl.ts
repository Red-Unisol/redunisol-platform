import type { PasswordResetRepository } from "../../domain/repositories/PasswordResetRepository";
import type { PasswordResetPrismaDatasource } from "../datasources/PasswordResetPrismaDatasource";

export class PasswordResetRepositoryImpl implements PasswordResetRepository {
  private readonly datasource: PasswordResetPrismaDatasource;

  constructor(datasource: PasswordResetPrismaDatasource) {
    this.datasource = datasource;
  }

  countCreatedSinceByUserId(
    input: Parameters<PasswordResetRepository["countCreatedSinceByUserId"]>[0],
  ) {
    return this.datasource.countCreatedSinceByUserId(input);
  }

  createForUser(input: Parameters<PasswordResetRepository["createForUser"]>[0]) {
    return this.datasource.createForUser(input);
  }

  findActiveUserByEmail(email: string) {
    return this.datasource.findActiveUserByEmail(email);
  }

  findValidByHash(
    input: Parameters<PasswordResetRepository["findValidByHash"]>[0],
  ) {
    return this.datasource.findValidByHash(input);
  }

  resetPasswordAndRevokeSessions(
    input: Parameters<
      PasswordResetRepository["resetPasswordAndRevokeSessions"]
    >[0],
  ) {
    return this.datasource.resetPasswordAndRevokeSessions(input);
  }
}
