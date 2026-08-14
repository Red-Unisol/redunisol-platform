import type { AuthSessionDto } from "../dtos/AuthSession.dto";
import type { RefreshTokenDto } from "../dtos/RefreshToken.dto";
import { InvalidSessionError } from "../../domain/auth-errors";
import { isRefreshTokenActive } from "../../domain/entities/RefreshToken.entity";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { RefreshTokenRepository } from "../../domain/repositories/RefreshTokenRepository";
import type { AccessTokenService } from "../../domain/services/AccessTokenService";
import type { RefreshTokenService } from "../../domain/services/RefreshTokenService";
import type { AuthUseCaseConfig } from "./AuthUseCaseConfig";

type RefreshSessionUseCaseDependencies = {
  accessTokenService: AccessTokenService;
  config: AuthUseCaseConfig;
  refreshTokenRepository: RefreshTokenRepository;
  refreshTokenService: RefreshTokenService;
  userRepository: AuthRepository;
};

export class RefreshSessionUseCase {
  private readonly accessTokenService: AccessTokenService;
  private readonly config: AuthUseCaseConfig;
  private readonly refreshTokenRepository: RefreshTokenRepository;
  private readonly refreshTokenService: RefreshTokenService;
  private readonly userRepository: AuthRepository;

  constructor(dependencies: RefreshSessionUseCaseDependencies) {
    this.accessTokenService = dependencies.accessTokenService;
    this.config = dependencies.config;
    this.refreshTokenRepository = dependencies.refreshTokenRepository;
    this.refreshTokenService = dependencies.refreshTokenService;
    this.userRepository = dependencies.userRepository;
  }

  async execute(input: RefreshTokenDto): Promise<AuthSessionDto> {
    if (!input.refreshToken) {
      throw new InvalidSessionError();
    }

    const currentTokenHash = this.refreshTokenService.hash(input.refreshToken);
    const currentToken =
      await this.refreshTokenRepository.findByHash(currentTokenHash);
    const now = new Date();

    if (!currentToken || !isRefreshTokenActive(currentToken, now)) {
      throw new InvalidSessionError();
    }

    const user = await this.userRepository.findActiveById(currentToken.userId);

    if (!user) {
      throw new InvalidSessionError();
    }

    const accessToken = this.accessTokenService.sign({ userId: user.id });
    const accessTokenExpiresAt = this.addMinutes(
      now,
      this.config.accessTokenTtlMinutes,
    );
    const refreshToken = this.refreshTokenService.generate();
    const newRefreshTokenHash = this.refreshTokenService.hash(refreshToken);
    const refreshTokenExpiresAt = this.addDays(
      now,
      this.config.refreshTokenTtlDays,
    );

    const sessionRotated = await this.refreshTokenRepository.rotate({
      currentTokenHash,
      expiresAt: refreshTokenExpiresAt,
      metadata: input.metadata,
      newTokenHash: newRefreshTokenHash,
      userId: user.id,
    });

    if (!sessionRotated) {
      throw new InvalidSessionError();
    }

    return {
      tokens: {
        accessToken,
        accessTokenExpiresAt,
        refreshToken,
        refreshTokenExpiresAt,
      },
      user,
    };
  }

  private addDays(date: Date, days: number) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }
}
