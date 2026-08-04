import type { AuthSessionDto, AuthTokens } from "../dtos/AuthSession.dto";
import type { LoginUserDto } from "../dtos/LoginUser.dto";
import {
  EmailNotVerifiedError,
  InvalidCredentialsError,
} from "../../domain/auth-errors";
import type { RequestMetadata } from "../../domain/entities/RefreshToken.entity";
import { toAuthUser } from "../../domain/entities/User.entity";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { RefreshTokenRepository } from "../../domain/repositories/RefreshTokenRepository";
import type { AccessTokenService } from "../../domain/services/AccessTokenService";
import type { PasswordHasher } from "../../domain/services/PasswordHasher";
import type { RefreshTokenService } from "../../domain/services/RefreshTokenService";
import type { AuthUseCaseConfig } from "./AuthUseCaseConfig";

type LoginUserUseCaseDependencies = {
  accessTokenService: AccessTokenService;
  config: AuthUseCaseConfig;
  passwordHasher: PasswordHasher;
  refreshTokenRepository: RefreshTokenRepository;
  refreshTokenService: RefreshTokenService;
  userRepository: AuthRepository;
};

export class LoginUserUseCase {
  private readonly accessTokenService: AccessTokenService;
  private readonly config: AuthUseCaseConfig;
  private readonly passwordHasher: PasswordHasher;
  private readonly refreshTokenRepository: RefreshTokenRepository;
  private readonly refreshTokenService: RefreshTokenService;
  private readonly userRepository: AuthRepository;

  constructor(dependencies: LoginUserUseCaseDependencies) {
    this.accessTokenService = dependencies.accessTokenService;
    this.config = dependencies.config;
    this.passwordHasher = dependencies.passwordHasher;
    this.refreshTokenRepository = dependencies.refreshTokenRepository;
    this.refreshTokenService = dependencies.refreshTokenService;
    this.userRepository = dependencies.userRepository;
  }

  async execute(input: LoginUserDto): Promise<AuthSessionDto> {
    const user = await this.userRepository.findActiveByIdentifier(
      input.identifier,
    );

    if (!user) {
      throw new InvalidCredentialsError();
    }

    const passwordMatches = await this.passwordHasher.compare(
      input.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new InvalidCredentialsError();
    }

    if (!user.emailVerified) {
      throw new EmailNotVerifiedError();
    }

    const authUser = toAuthUser(user);
    const tokens = await this.createSessionTokens(authUser.id, input.metadata);

    return {
      tokens,
      user: authUser,
    };
  }

  private async createSessionTokens(
    userId: string,
    metadata: RequestMetadata,
  ): Promise<AuthTokens> {
    const now = new Date();
    const refreshToken = this.refreshTokenService.generate();
    const refreshTokenHash = this.refreshTokenService.hash(refreshToken);
    const refreshTokenExpiresAt = this.addDays(
      now,
      this.config.refreshTokenTtlDays,
    );

    await this.refreshTokenRepository.create({
      expiresAt: refreshTokenExpiresAt,
      metadata,
      tokenHash: refreshTokenHash,
      userId,
    });

    return {
      accessToken: this.accessTokenService.sign({ userId }),
      accessTokenExpiresAt: this.addMinutes(
        now,
        this.config.accessTokenTtlMinutes,
      ),
      refreshToken,
      refreshTokenExpiresAt,
    };
  }

  private addDays(date: Date, days: number) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }
}
