import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { AuthPrismaDatasource } from "../datasources/AuthPrismaDatasource";

export class AuthRepositoryImpl implements AuthRepository {
  private readonly datasource: AuthPrismaDatasource;

  constructor(datasource: AuthPrismaDatasource) {
    this.datasource = datasource;
  }

  create(input: Parameters<AuthRepository["create"]>[0]) {
    return this.datasource.create(input);
  }

  findById(userId: string) {
    return this.datasource.findById(userId);
  }

  findByIdWithPasswordHash(userId: string) {
    return this.datasource.findByIdWithPasswordHash(userId);
  }

  updatePasswordAndRevokeSessions(
    input: Parameters<AuthRepository["updatePasswordAndRevokeSessions"]>[0],
  ) {
    return this.datasource.updatePasswordAndRevokeSessions(input);
  }

  countActiveSystemAdmins() {
    return this.datasource.countActiveSystemAdmins();
  }

  updateUser(input: Parameters<AuthRepository["updateUser"]>[0]) {
    return this.datasource.updateUser(input);
  }

  listUsers() {
    return this.datasource.listUsers();
  }

  listPendingAreaUsers() {
    return this.datasource.listPendingAreaUsers();
  }

  listActiveWorkflowOwners() {
    return this.datasource.listActiveWorkflowOwners();
  }

  assignWorkflowOwner(input: Parameters<AuthRepository["assignWorkflowOwner"]>[0]) {
    return this.datasource.assignWorkflowOwner(input);
  }

  deleteById(userId: string) {
    return this.datasource.deleteById(userId);
  }

  findActiveById(userId: string) {
    return this.datasource.findActiveById(userId);
  }

  findActiveByIdentifier(identifier: string) {
    return this.datasource.findActiveByIdentifier(identifier);
  }

  findByEmail(email: string) {
    return this.datasource.findByEmail(email);
  }

  findByLegacyUser(legacyUser: string) {
    return this.datasource.findByLegacyUser(legacyUser);
  }

  existsOtherUserWithLegacyUser(
    input: Parameters<AuthRepository["existsOtherUserWithLegacyUser"]>[0],
  ) {
    return this.datasource.existsOtherUserWithLegacyUser(input);
  }

  findActiveWorkflowOwnerById(workflowOwnerId: string) {
    return this.datasource.findActiveWorkflowOwnerById(workflowOwnerId);
  }
}
