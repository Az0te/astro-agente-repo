@echo off
rem Instalador de AstroPilot: doble clic. Pasa los argumentos a instalar.ps1 (por ejemplo -Simular).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1" %*
echo.
pause
