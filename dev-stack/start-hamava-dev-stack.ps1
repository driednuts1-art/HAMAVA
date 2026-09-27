# Hamava dev stack orchestrator — starts clamd, MinIO, backend, frontend if
# they aren't already running. Idempotent (safe to run repeatedly — a
# scheduled task runs this at every logon, and it may already be up from a
# previous session). Not part of the app itself — machine-level dev
# infrastructure, gitignored.
#
# Registered as a Windows Scheduled Task ("HamavaDevStack", trigger: at
# logon of this user) so these 4 services survive Claude Code sessions
# closing/restarting and machine reboots — they used to die whenever the
# interactive session that launched them as background jobs ended, which is
# why they kept needing manual restarts (see chat history around
# 2026-09-13).

$ErrorActionPreference = "Stop"
$logDir = "C:\Users\Admin\Desktop\دیتینگ اپ پروژه\dev-stack\logs"
$backendDir = "C:\Users\Admin\Desktop\دیتینگ اپ پروژه\backend"
$frontendDir = "C:\Users\Admin\Desktop\دیتینگ اپ پروژه\frontend"

function Test-HttpOk($url) {
    try {
        Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 | Out-Null
        return $true
    } catch {
        # A real HTTP error response (404/401/etc.) still means the server
        # is alive and answering — only a connection failure means it's down.
        if ($_.Exception.Response) { return $true }
        return $false
    }
}

# 1. clamd
if (-not (Get-Process clamd -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath "C:\Program Files\ClamAV\clamd.exe" `
        -ArgumentList "--config-file=C:\ClamAV\clamd.conf" `
        -RedirectStandardOutput "$logDir\clamd_stdout.log" `
        -RedirectStandardError "$logDir\clamd_stderr.log" `
        -WindowStyle Hidden
    Write-Output "$(Get-Date -Format o) started clamd"
} else {
    Write-Output "$(Get-Date -Format o) clamd already running"
}

# 2. MinIO — root credentials read from their own existing file at runtime
# (never duplicated into this script), matching how they've been used
# throughout this project.
if (-not (Test-HttpOk "http://127.0.0.1:9010/minio/health/live")) {
    Get-Content "C:\MinIO\root-credentials.env" | ForEach-Object {
        if ($_ -match '^\s*([A-Z_]+)=(.*)$') {
            Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
        }
    }
    Start-Process -FilePath "C:\Users\Admin\AppData\Local\Microsoft\WinGet\Packages\MinIO.Server_Microsoft.Winget.Source_8wekyb3d8bbwe\minio.exe" `
        -ArgumentList "server","C:\MinIO\data","--address",":9010","--console-address",":9011" `
        -RedirectStandardOutput "$logDir\minio_stdout.log" `
        -RedirectStandardError "$logDir\minio_stderr.log" `
        -WindowStyle Hidden
    Write-Output "$(Get-Date -Format o) started MinIO"
} else {
    Write-Output "$(Get-Date -Format o) MinIO already running"
}

# 3. Backend — start:frontend-e2e (AUTH_OTP_DEBUG_ECHO=true,
# OTP_RATE_LIMIT_BYPASS=true): matches how this backend has actually been
# run throughout this project's own manual-testing and e2e sessions (real
# dev/test posture, never production — both flags stay hard-refused at
# startup if NODE_ENV=production, per ProductionSafetyService).
if (-not (Test-HttpOk "http://localhost:3000/api/health")) {
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c","cd /d ""$backendDir"" && npm run start:frontend-e2e" `
        -RedirectStandardOutput "$logDir\backend_stdout.log" `
        -RedirectStandardError "$logDir\backend_stderr.log" `
        -WindowStyle Hidden
    Write-Output "$(Get-Date -Format o) started backend"
} else {
    Write-Output "$(Get-Date -Format o) backend already running"
}

# 4. Frontend
if (-not (Test-HttpOk "http://localhost:3001")) {
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c","cd /d ""$frontendDir"" && npm run dev" `
        -RedirectStandardOutput "$logDir\frontend_stdout.log" `
        -RedirectStandardError "$logDir\frontend_stderr.log" `
        -WindowStyle Hidden
    Write-Output "$(Get-Date -Format o) started frontend"
} else {
    Write-Output "$(Get-Date -Format o) frontend already running"
}
