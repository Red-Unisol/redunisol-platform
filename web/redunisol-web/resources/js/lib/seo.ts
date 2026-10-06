export function formatPageTitle(title: string, appName = 'Red Unisol'): string {
    const value = title.trim();
    if (!value) return appName;

    return value.toLocaleLowerCase().includes(appName.toLocaleLowerCase())
        ? value
        : `${value} | ${appName}`;
}
