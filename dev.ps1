$ErrorActionPreference='Stop'
Set-Location -Path $PSScriptRoot
Write-Host 'WorldForge dev server: http://localhost:4321'
npm run dev
