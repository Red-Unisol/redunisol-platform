[CmdletBinding()]
param(
    [string]$Profile = "release"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Profile -ne "release") {
    throw "Solo se soporta Profile=release para empaquetado."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cargoTomlPath = Join-Path $scriptDir "Cargo.toml"
$packageInputDir = Join-Path $scriptDir "package-input"
$packageInputSshDir = Join-Path $packageInputDir "ssh"
$encryptedEnvPath = Join-Path $packageInputDir "transferencias.env.enc"
$distDir = Join-Path $scriptDir "dist"
$stagingDir = Join-Path $distDir "staging"
$exePath = Join-Path $scriptDir "target\\release\\transferencias-celesol.exe"
$configToolPath = Join-Path $scriptDir "target\\release\\encrypt_transferencias_env.exe"
$requiredCoreBaseUrl = "https://celesol.dyndns.org:5002"
$requiredMarkPaidEndpoint = "https://celesol.dyndns.org:35010/api/Transferencias/marcar-pagada"

function Get-PackageVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CargoTomlPath
    )

    foreach ($line in Get-Content -Path $CargoTomlPath) {
        if ($line -match '^\s*version\s*=\s*"([^"]+)"\s*$') {
            return $matches[1]
        }
    }

    throw "No se pudo resolver version desde $CargoTomlPath"
}

function Assert-FileExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Falta $Label en $Path"
    }
}

function Resolve-FirstExistingPath {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Candidates
    )

    foreach ($candidate in $Candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    return $null
}

function Assert-PackageEnvironment {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EncryptedEnvPath,

        [Parameter(Mandatory = $true)]
        [string]$ConfigToolPath,

        [Parameter(Mandatory = $true)]
        [string]$RequiredCoreBaseUrl,

        [Parameter(Mandatory = $true)]
        [string]$RequiredMarkPaidEndpoint
    )

    $temporaryEnvPath = Join-Path (
        [System.IO.Path]::GetTempPath()
    ) ("transferencias-package-validation-{0}.env" -f [guid]::NewGuid())

    try {
        & $ConfigToolPath --decrypt --input $EncryptedEnvPath --output $temporaryEnvPath
        if ($LASTEXITCODE -ne 0) {
            throw "No se pudo validar la configuracion cifrada del paquete."
        }

        $settings = @{}
        foreach ($line in Get-Content -LiteralPath $temporaryEnvPath) {
            $trimmed = $line.Trim()
            if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
                continue
            }

            $parts = $trimmed -split "=", 2
            $settings[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
        }

        $configuredCoreBaseUrl = $settings["TRANSFERENCIAS_CORE_BASE_URL"]
        if (-not $configuredCoreBaseUrl) {
            throw "La configuracion cifrada no define TRANSFERENCIAS_CORE_BASE_URL."
        }

        if ($configuredCoreBaseUrl.TrimEnd('/') -ne $RequiredCoreBaseUrl.TrimEnd('/')) {
            throw (
                "El paquete apunta a un core obsoleto: {0}. " +
                "Debe usar {1}; se cancela la construccion del ZIP."
            ) -f $configuredCoreBaseUrl, $RequiredCoreBaseUrl
        }

        $configuredMarkPaidEndpoint = $settings["TRANSFERENCIAS_MARK_PAID_ENDPOINT"]
        if (-not $configuredMarkPaidEndpoint) {
            throw "La configuracion cifrada no define TRANSFERENCIAS_MARK_PAID_ENDPOINT."
        }

        if ($configuredMarkPaidEndpoint.TrimEnd('/') -ne $RequiredMarkPaidEndpoint.TrimEnd('/')) {
            throw (
                "El paquete apunta a un endpoint incorrecto para marcar Pagada: {0}. " +
                "Debe usar {1}; se cancela la construccion del ZIP."
            ) -f $configuredMarkPaidEndpoint, $RequiredMarkPaidEndpoint
        }

        if ([string]::IsNullOrWhiteSpace($settings["TRANSFERENCIAS_MARK_PAID_AUTH_TOKEN"])) {
            throw (
                "La configuracion cifrada no define TRANSFERENCIAS_MARK_PAID_AUTH_TOKEN. " +
                "Sin ese token la app transfiere, pero no puede registrar el comprobante ni marcar Pagada."
            )
        }

        if ($settings["TRANSFERENCIAS_MARK_PAID_ALLOW_INVALID_CERTS"] -ne "true") {
            throw (
                "TRANSFERENCIAS_MARK_PAID_ALLOW_INVALID_CERTS debe ser true para el endpoint operativo actual."
            )
        }

        Write-Host (
            "Configuracion validada: Evaluate en {0}; marcado Pagada en {1}; token presente." -f
            $RequiredCoreBaseUrl,
            $RequiredMarkPaidEndpoint
        )
    }
    finally {
        if (Test-Path -LiteralPath $temporaryEnvPath) {
            Remove-Item -LiteralPath $temporaryEnvPath -Force
        }
    }
}

$version = Get-PackageVersion -CargoTomlPath $cargoTomlPath
$packageName = "transferencias-celesol-$version-windows-x86_64"
$zipPath = Join-Path $distDir "$packageName.zip"
$packageRoot = Join-Path $stagingDir $packageName
$packageSshDir = Join-Path $packageRoot "ssh"
$privateKeyPath = Resolve-FirstExistingPath -Candidates @(
    (Join-Path $packageInputSshDir "coinag_tunnel_key"),
    (Join-Path $packageInputDir "coinag_tunnel_key"),
    (Join-Path $packageInputDir "tunnelcoinag_ed25519")
)
$hostPublicKeyPath = Resolve-FirstExistingPath -Candidates @(
    (Join-Path $packageInputSshDir "vps_host_key.pub"),
    (Join-Path $packageInputDir "vps_host_key.pub"),
    (Join-Path $packageInputDir "tunnelcoinag_host_ed25519.pub")
)

Assert-FileExists -Path $cargoTomlPath -Label "Cargo.toml"
Assert-FileExists -Path $encryptedEnvPath -Label "transferencias.env.enc"
Assert-FileExists -Path $privateKeyPath -Label "la clave privada SSH"
Assert-FileExists -Path $hostPublicKeyPath -Label "la host public key SSH de la VPS"

Push-Location $scriptDir
try {
    Write-Host "Compilando transferencias-celesol $version..."
    cargo build --locked --release
    if ($LASTEXITCODE -ne 0) {
        throw "Fallo cargo build --locked --release"
    }

    Assert-FileExists -Path $exePath -Label "el ejecutable release"
    Assert-FileExists -Path $configToolPath -Label "la herramienta de configuracion cifrada"
    Assert-PackageEnvironment `
        -EncryptedEnvPath $encryptedEnvPath `
        -ConfigToolPath $configToolPath `
        -RequiredCoreBaseUrl $requiredCoreBaseUrl `
        -RequiredMarkPaidEndpoint $requiredMarkPaidEndpoint

    if (Test-Path -LiteralPath $stagingDir) {
        Remove-Item -LiteralPath $stagingDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $packageSshDir -Force | Out-Null

    Copy-Item -LiteralPath $exePath -Destination (Join-Path $packageRoot "transferencias-celesol.exe")
    Copy-Item -LiteralPath $encryptedEnvPath -Destination (Join-Path $packageRoot "transferencias.env.enc")
    Copy-Item -LiteralPath $privateKeyPath -Destination (Join-Path $packageSshDir "coinag_tunnel_key")
    Copy-Item -LiteralPath $hostPublicKeyPath -Destination (Join-Path $packageSshDir "vps_host_key.pub")

    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
    Compress-Archive -Path $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal

    Write-Host "Paquete generado en:"
    Write-Host $zipPath
}
finally {
    Pop-Location
}
