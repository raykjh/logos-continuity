$ErrorActionPreference = "Stop"

Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All -NoRestart | Out-Host
Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart | Out-Host

Write-Host "WSL2 prerequisites are enabled. Restart Windows before starting Docker Desktop." -ForegroundColor Green
