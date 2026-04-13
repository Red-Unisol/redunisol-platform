[CmdletBinding()]
param(
    [string]$Profile = "release",
    [string]$EnvPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Profile -ne "release") {
    throw "Solo se soporta Profile=release para empaquetado."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cargoTomlPath = Join-Path $scriptDir "Cargo.toml"
$packageInputDir = Join-Path $scriptDir "package-input"
$defaultEnvPath = Join-Path $scriptDir "validacion-metamap.env"
$packageInputEnvPath = Join-Path $packageInputDir "validacion-metamap.env"
$distDir = Join-Path $scriptDir "dist"
$stagingDir = Join-Path $distDir "staging"
$exePath = Join-Path $scriptDir "target\release\validacion-metamap.exe"
$readmePath = Join-Path $scriptDir "README.md"

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
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    return $null
}

$resolvedEnvPath = Resolve-FirstExistingPath -Candidates @(
    $EnvPath,
    $packageInputEnvPath,
    $defaultEnvPath
)

Assert-FileExists -Path $cargoTomlPath -Label "Cargo.toml"
Assert-FileExists -Path $readmePath -Label "README.md"

if (-not $resolvedEnvPath) {
    throw "No se encontro el entorno para empaquetar. Usa -EnvPath o crea package-input\validacion-metamap.env"
}

$version = Get-PackageVersion -CargoTomlPath $cargoTomlPath
$packageName = "validacion-metamap-$version-windows-x86_64"
$zipPath = Join-Path $distDir "$packageName.zip"
$packageRoot = Join-Path $stagingDir $packageName

Push-Location $scriptDir
try {
    Write-Host "Compilando validacion-metamap $version..."
    cargo build --locked --release
    if ($LASTEXITCODE -ne 0) {
        throw "Fallo cargo build --locked --release"
    }

    Assert-FileExists -Path $exePath -Label "el ejecutable release"

    if (Test-Path -LiteralPath $stagingDir) {
        Remove-Item -LiteralPath $stagingDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

    Copy-Item -LiteralPath $exePath -Destination (Join-Path $packageRoot "validacion-metamap.exe")
    Copy-Item -LiteralPath $resolvedEnvPath -Destination (Join-Path $packageRoot "validacion-metamap.env")
    Copy-Item -LiteralPath $readmePath -Destination (Join-Path $packageRoot "README.md")

    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
    Compress-Archive -Path $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal

    Write-Host "Carpeta lista en:"
    Write-Host $packageRoot
    Write-Host "Zip generado en:"
    Write-Host $zipPath
}
finally {
    Pop-Location
}
