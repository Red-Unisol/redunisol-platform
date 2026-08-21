export const USER_STATE = {
  INACTIVE: 0,
  ACTIVE: 1,
  PENDING_AREA_ASSIGNMENT: 2,
} as const;

export const LOGIN_ALLOWED_USER_STATES = [
  USER_STATE.ACTIVE,
  USER_STATE.PENDING_AREA_ASSIGNMENT,
] as const;

export type UserState = (typeof USER_STATE)[keyof typeof USER_STATE];
