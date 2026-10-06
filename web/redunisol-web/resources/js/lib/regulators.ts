export function getRegulatorDisplayName(
    shortName: string | null,
    fullName: string,
): string {
    const name = (shortName ?? fullName).trim();
    const normalizedName = name.toLocaleLowerCase('es-AR').replaceAll('_', ' ');

    if (
        normalizedName === 'fiat celesol' ||
        normalizedName === 'fiat concord'
    ) {
        return 'Fiat Concord';
    }

    return name;
}
