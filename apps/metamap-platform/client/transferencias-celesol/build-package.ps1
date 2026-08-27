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
