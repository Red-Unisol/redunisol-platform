export type SolicitudAssignmentAvailabilityInput = {
  canEditSolicitud: boolean;
  hasAssignmentOptions: boolean;
  isAssigningToSelf: boolean;
  isAssigningToUser: boolean;
  isEditing: boolean;
  isLoadingAssignableAgents: boolean;
};

export function canManageSolicitudAssignment(
  input: SolicitudAssignmentAvailabilityInput,
) {
  return (
    input.isEditing &&
    input.canEditSolicitud &&
    !input.isLoadingAssignableAgents &&
    !input.isAssigningToSelf &&
    !input.isAssigningToUser &&
    input.hasAssignmentOptions
  );
}
