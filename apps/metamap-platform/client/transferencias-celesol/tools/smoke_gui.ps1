[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Executable)

$ErrorActionPreference = 'Stop'
# Synthetic process-only settings: never reads local operational environments.
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('transferencias-gui-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $fixture '.transferencias-update') | Out-Null
$target = Join-Path $fixture 'transferencias-celesol.exe'
Copy-Item -LiteralPath $Executable -Destination $target
$journal = Join-Path $fixture '.transferencias-update/pending.json'
$state = @{ old_hash = 'synthetic-backup'; new_hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() }
[IO.File]::WriteAllText($journal, ($state | ConvertTo-Json -Compress))
$settings = [Diagnostics.ProcessStartInfo]::new($target)
$settings.UseShellExecute = $false
$settings.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$settings.WorkingDirectory = $fixture
$settings.ArgumentList.Add('--update-trial')
foreach ($name in @($settings.Environment.Keys)) {
    if ($name.StartsWith('TRANSFERENCIAS_', [StringComparison]::OrdinalIgnoreCase)) { $settings.Environment.Remove($name) | Out-Null }
}
$settings.Environment['TRANSFERENCIAS_SERVER_BASE_URL'] = 'http://127.0.0.1:9'
$settings.Environment['TRANSFERENCIAS_SERVER_CLIENT_ID'] = 'synthetic-smoke'
$settings.Environment['TRANSFERENCIAS_SERVER_CLIENT_SECRET'] = 'synthetic-smoke'
$settings.Environment['TRANSFERENCIAS_CORE_BASE_URL'] = 'http://127.0.0.1:9'
$settings.Environment['TRANSFERENCIAS_MARK_PAID_ENDPOINT'] = 'http://127.0.0.1:9'
$settings.Environment['TRANSFERENCIAS_REQUEST_TIMEOUT_SECONDS'] = '1'
$settings.Environment['TRANSFERENCIAS_OPERATOR_NAME'] = 'automated-smoke'
$settings.Environment['RUST_LOG'] = 'transferencias_celesol=info,transfer_audit=info'
$process = [Diagnostics.Process]::Start($settings)
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    while (Test-Path -LiteralPath $journal) {
        if ($process.HasExited) { throw 'Release executable exited before rendering its first frame' }
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Release GUI did not acknowledge startup' }
        Start-Sleep -Milliseconds 100
    }
    $log = Join-Path $fixture 'logs/transferencias.log'
    $text = Get-Content -Raw -LiteralPath $log
    if ($text -notmatch 'transfer_enabled=false\. mark_paid_enabled=false') {
        throw 'Could not verify in the log that banking services remained disabled'
    }
    Write-Output 'Release GUI rendered its first frame and acknowledged the update; banking disabled.'
    $process.Refresh()
    $process.CloseMainWindow() | Out-Null
    if (-not $process.WaitForExit(10000)) { throw 'GUI did not close cleanly' }
    if ($process.ExitCode -ne 0) { throw "GUI exited with $($process.ExitCode)" }
    Write-Output 'Release GUI closed cleanly.'
    Write-Output "Synthetic test evidence: $fixture"
}
finally {
    if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    $process.Dispose()
}
