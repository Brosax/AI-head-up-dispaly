@echo off
powershell.exe -NoProfile -File "%~dp0Start-Headroom.ps1"
if errorlevel 1 pause
