@echo off
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0Start-Headroom.ps1" -Toolbar
if errorlevel 1 pause
