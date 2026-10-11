export const IDENTITY_EVENT = "solicitudes-identity-changed";
export function reloadIdentity(path: string) {
  try {
    localStorage.setItem(IDENTITY_EVENT, crypto.randomUUID());
  } finally {
    // A new document drops component state and pending client-side caches.
    window.location.replace(path);
  }
}
