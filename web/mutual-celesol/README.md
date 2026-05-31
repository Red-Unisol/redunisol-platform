# Mutual Celesol

Static/PHP export for `mutualcelesol.com`.

The public site is intentionally mounted under `/celesol-web/` to preserve the current production URL shape. Apache redirects root-level paths into that prefix so legacy URLs such as `/contacto/`, `/bitrix/...`, and `/b23133187/...` continue to resolve after migration.

The deployment artifact excludes the old Grav install, zip archives, and macOS metadata from the downloaded hosting backup. The active editable areas observed in the backup are under `/celesol-web/cms/`.
