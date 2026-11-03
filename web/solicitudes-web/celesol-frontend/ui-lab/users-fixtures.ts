import type {
  UsersAdminUser,
  WorkflowOwner,
} from "../src/modules/users-admin/services/users-admin-api";

export const USERS_WORKFLOW_OWNERS: WorkflowOwner[] = [
  { id: "demo-riesgo", code: "RIESGO", name: "Riesgo de ejemplo" },
  { id: "demo-ventas", code: "VENDEDORES", name: "Ventas de ejemplo" },
];

// Fictional users for the real administration page; mutations remain blocked.
export const USERS_FIXTURE: UsersAdminUser[] = [
  {
    firstName: "María",
    lastName: "Pérez",
    email: "maria.perez@example.invalid",
    legacyUser: "mperez.demo",
  },
  {
    firstName: "José",
    lastName: "Gómez",
    email: "jose.gomez@example.invalid",
    legacyUser: "jgomez.demo",
  },
  {
    firstName: "Lucía",
    lastName: "Fernández",
    email: "lucia.fernandez@example.invalid",
    legacyUser: "lfernandez.demo",
  },
  {
    firstName: "",
    lastName: "",
    email: "sin.nombre@example.invalid",
    legacyUser: "",
  },
].map((user, index) => ({
  ...user,
  id: `demo-user-${index + 1}`,
  emailVerified: index !== 3,
  isSystemAdmin: false,
  recibeAsignacionAutomatica: false,
  state: index === 2 ? 0 : index === 3 ? 2 : 1,
  workflowOwnerId:
    index === 3 ? null : index === 0 ? "demo-riesgo" : "demo-ventas",
}));
