import type { RefreshTokenRepository } from "../../domain/repositories/RefreshTokenRepository";
import type { RefreshTokenService } from "../../domain/services/RefreshTokenService";
import { resolveRefreshToken } from "../resolve-refresh-token";

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
    const current = await resolveRefreshToken(
      refreshToken,
      this.refreshTokenRepository,
      this.refreshTokenService,
    );
    if (current?.recovered) {
      await this.refreshTokenRepository.revoke(current.record.tokenHash);
    }
    await this.refreshTokenRepository.revoke(tokenHash);
  }
}
