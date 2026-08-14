import type { EmailVerificationRepository } from "../../domain/repositories/EmailVerificationRepository";
import type { EmailVerificationPrismaDatasource } from "../datasources/EmailVerificationPrismaDatasource";

export class EmailVerificationRepositoryImpl
  implements EmailVerificationRepository
{
  private readonly datasource: EmailVerificationPrismaDatasource;

  constructor(datasource: EmailVerificationPrismaDatasource) {
    this.datasource = datasource;
  }

  countCreatedSinceByUserId(
    input: Parameters<EmailVerificationRepository["countCreatedSinceByUserId"]>[0],
  ) {
    return this.datasource.countCreatedSinceByUserId(input);
  }

  createForUser(input: Parameters<EmailVerificationRepository["createForUser"]>[0]) {
    return this.datasource.createForUser(input);
  }

  findValidByEmailAndHash(
    input: Parameters<EmailVerificationRepository["findValidByEmailAndHash"]>[0],
  ) {
    return this.datasource.findValidByEmailAndHash(input);
  }

  markUsedAndVerifyUser(
    input: Parameters<EmailVerificationRepository["markUsedAndVerifyUser"]>[0],
  ) {
    return this.datasource.markUsedAndVerifyUser(input);
  }
}
