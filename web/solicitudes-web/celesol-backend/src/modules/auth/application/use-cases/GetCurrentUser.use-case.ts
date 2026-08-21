import { InvalidSessionError } from "../../domain/auth-errors";
import type { AuthUser } from "../../domain/entities/User.entity";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { AccessTokenService } from "../../domain/services/AccessTokenService";

type GetCurrentUserUseCaseDependencies = {
  accessTokenService: AccessTokenService;
  userRepository: AuthRepository;
};

export class GetCurrentUserUseCase {
  private readonly accessTokenService: AccessTokenService;
  private readonly userRepository: AuthRepository;

  constructor(dependencies: GetCurrentUserUseCaseDependencies) {
    this.accessTokenService = dependencies.accessTokenService;
    this.userRepository = dependencies.userRepository;
  }

  async execute(accessToken: string | undefined): Promise<AuthUser> {
    if (!accessToken) {
      throw new InvalidSessionError();
    }

    const payload = this.accessTokenService.verify(accessToken);
    const user = await this.userRepository.findActiveById(payload.userId);

    if (!user) {
      throw new InvalidSessionError();
    }

    return user;
  }
}
