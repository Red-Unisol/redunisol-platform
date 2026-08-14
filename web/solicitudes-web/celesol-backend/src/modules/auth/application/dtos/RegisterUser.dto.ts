import type { AuthUser } from "../../domain/entities/User.entity";

export type RegisterUserDto = {
  email: string;
  firstName: string;
  lastName: string;
  legacyUser: string;
  password: string;
};

export type RegisterUserResultDto = {
  user: AuthUser;
  verificationEmailSent: boolean;
};
