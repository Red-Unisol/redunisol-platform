import type { RefreshTokenRepository } from "../../domain/repositories/RefreshTokenRepository";
import type { RefreshTokenService } from "../../domain/services/RefreshTokenService";

type LogoutUserUseCaseDependencies = {
  refreshTokenRepository: RefreshTokenRepository;
  refreshTokenService: RefreshTokenService;
};

export class LogoutUserUseCase {
  private readonly refreshTokenRepository: RefreshTokenRepository;
  private readonly refreshTokenService: RefreshTokenService;

  constructor(dependencies: LogoutUserUseCaseDependencies) {
    this.refreshTokenRepository = dependencies.refreshTokenRepository;
    this.refreshTokenService = dependencies.refreshTokenService;
  }

  async execute(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }

    const tokenHash = this.refreshTokenService.hash(refreshToken);
    await this.refreshTokenRepository.revoke(tokenHash);
  }
}
