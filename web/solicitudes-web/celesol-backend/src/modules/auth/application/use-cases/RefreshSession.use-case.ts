import type { AuthSessionDto } from "../dtos/AuthSession.dto";
import type { RefreshTokenDto } from "../dtos/RefreshToken.dto";
import { InvalidSessionError } from "../../domain/auth-errors";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { RefreshTokenRepository } from "../../domain/repositories/RefreshTokenRepository";
import type { AccessTokenService } from "../../domain/services/AccessTokenService";
import type { RefreshTokenService } from "../../domain/services/RefreshTokenService";
import type { AuthUseCaseConfig } from "./AuthUseCaseConfig";
import { resolveRefreshToken } from "../resolve-refresh-token";

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

    const current = await resolveRefreshToken(
      input.refreshToken,
      this.refreshTokenRepository,
      this.refreshTokenService,
    );
    if (!current) throw new InvalidSessionError();

    const user = await this.userRepository.findActiveById(
      current.record.userId,
    );

    if (!user) {
      throw new InvalidSessionError();
    }

    if (current.recovered) {
      return this.session(user, current.value, current.record.expiresAt);
    }

    const now = new Date();
    const refreshToken = this.refreshTokenService.successor(input.refreshToken);
    const newRefreshTokenHash = this.refreshTokenService.hash(refreshToken);
    const refreshTokenExpiresAt = this.addDays(
      now,
      this.config.refreshTokenTtlDays,
    );

    let sessionRotated: boolean;
    try {
      sessionRotated = await this.refreshTokenRepository.rotate({
        currentTokenHash: current.record.tokenHash,
        expiresAt: refreshTokenExpiresAt,
        metadata: input.metadata,
        newTokenHash: newRefreshTokenHash,
        userId: user.id,
      });
    } catch (error) {
      // A failed commit acknowledgement is ambiguous: read the persisted result
      // before reporting failure. Never rotate again or extend its expiry.
      const recovered = await resolveRefreshToken(
        input.refreshToken,
        this.refreshTokenRepository,
        this.refreshTokenService,
      ).catch(() => null);
      if (recovered?.recovered) {
        return this.session(user, recovered.value, recovered.record.expiresAt);
      }
      throw error;
    }

    if (!sessionRotated) {
      const recovered = await resolveRefreshToken(
        input.refreshToken,
        this.refreshTokenRepository,
        this.refreshTokenService,
      );
      if (recovered?.recovered) {
        return this.session(user, recovered.value, recovered.record.expiresAt);
      }
      throw new InvalidSessionError();
    }

    return this.session(user, refreshToken, refreshTokenExpiresAt);
  }

  private session(
    user: AuthSessionDto["user"],
    refreshToken: string,
    refreshTokenExpiresAt: Date,
  ): AuthSessionDto {
    const now = new Date();
    return {
      tokens: {
        accessToken: this.accessTokenService.sign({ userId: user.id }),
        accessTokenExpiresAt: this.addMinutes(
          now,
          this.config.accessTokenTtlMinutes,
        ),
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
