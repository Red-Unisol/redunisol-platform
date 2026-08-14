export type LegacyUserVerification = {
  active: boolean;
  id: number;
  userName: string;
};

export type LegacyUserVerifier = {
  verifyByUserName(userName: string): Promise<LegacyUserVerification | null>;
};
