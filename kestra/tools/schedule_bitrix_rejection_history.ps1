param(
    [Parameter(Mandatory = $true)][string]$InventoryDirectory,
    [Parameter(Mandatory = $true)][string]$CredentialsFile,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [string]$TaskName = 'RedUnisol-HistoricalRejections-20260924'
)

$ErrorActionPreference = 'Stop'
$inventory = (Resolve-Path -LiteralPath $InventoryDirectory).Path
$credentials = (Resolve-Path -LiteralPath $CredentialsFile).Path
$migrationScript = Join-Path $PSScriptRoot 'migrate_bitrix_rejection_history.py'
$pythonPath = (Get-Command python -ErrorAction Stop).Source
$pwshPath = (Get-Command pwsh -ErrorAction Stop).Source
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) { throw 'The scheduled task already exists; inspect it before changing it.' }
$validation = Get-Content -LiteralPath (Join-Path $inventory 'execution/pilot-validation.json') -Raw | ConvertFrom-Json
if (-not $validation.clean -or $validation.inventory_sha256 -ne $ExpectedSha256) {
    throw 'Pilot verification is missing or does not match the approved inventory.'
}
if ((Get-FileHash -LiteralPath (Join-Path $inventory 'candidates.json') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256) {
    throw 'Approved inventory hash differs.'
}
if ((Get-Date).ToUniversalTime().Subtract((Get-Date)).TotalHours -lt 2.9 -or
    (Get-Date).ToUniversalTime().Subtract((Get-Date)).TotalHours -gt 3.1) {
    throw 'Local timezone must be Argentina (UTC-03:00).'
}

$config = [ordered]@{
    task_name = $TaskName
    python = $pythonPath
    script = $migrationScript
    script_sha256 = (Get-FileHash -LiteralPath $migrationScript -Algorithm SHA256).Hash.ToLowerInvariant()
    inventory_directory = $inventory
    credentials_file = $credentials
    expected_sha256 = $ExpectedSha256
    scheduled_timezone = 'Argentina UTC-03:00'
    window = '22:00-06:00'
    batch_size = 25
    batch_interval_seconds = 30
    queue_max_pending = 125
}
$configPath = Join-Path $inventory 'execution/night-config.json'
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
$runnerPath = Join-Path $inventory 'execution/run-night.ps1'
$runner = @'
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'night-config.json') -Raw | ConvertFrom-Json
$logPath = Join-Path $PSScriptRoot ('night-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
try {
    if ((Get-FileHash -LiteralPath $config.script -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.script_sha256) {
        throw 'Scheduled migration script changed; revalidate before execution.'
    }
    $arguments = @(
        $config.script, 'remaining',
        '--inventory-dir', $config.inventory_directory,
        '--credentials-file', $config.credentials_file,
        '--expected-sha256', $config.expected_sha256,
        '--execute', '--night-window',
        '--batch-size', $config.batch_size,
        '--max-records', 75254,
        '--batch-interval-seconds', $config.batch_interval_seconds,
        '--queue-max-pending', $config.queue_max_pending
    )
    & $config.python @arguments >> $logPath 2>&1
    $runExit = $LASTEXITCODE
    if ($runExit -ne 0) {
        Disable-ScheduledTask -TaskName $config.task_name | Out-Null
        exit $runExit
    }
    $progress = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'progress.json') -Raw | ConvertFrom-Json
    if ($progress.remaining -eq 0) {
        Disable-ScheduledTask -TaskName $config.task_name | Out-Null
    }
} catch {
    # Avoid logging exception values that might include access data.
    ('Stopped: ' + $_.Exception.GetType().Name) | Add-Content -LiteralPath $logPath
    Disable-ScheduledTask -TaskName $config.task_name | Out-Null
    exit 1
}
'@
$runner | Set-Content -LiteralPath $runnerPath -Encoding utf8
$action = New-ScheduledTaskAction -Execute $pwshPath -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $runnerPath + '"')
$trigger = New-ScheduledTaskTrigger -Daily -At '22:00'
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 9)
$userName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $userName -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Approved historical Bitrix rejection migration. 22:00-06:00 Argentina, queue guard, no customer notices, disable on error or completion.'
Register-ScheduledTask -TaskName $TaskName -InputObject $task | Out-Null
$info = Get-ScheduledTaskInfo -TaskName $TaskName
[ordered]@{task_name=$TaskName; next_run=$info.NextRunTime.ToString('o'); state=(Get-ScheduledTask -TaskName $TaskName).State.ToString(); registered_at=(Get-Date -Format o)} | ConvertTo-Json
