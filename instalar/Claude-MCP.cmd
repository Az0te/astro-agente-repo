@echo off
rem AstroPilot: solo registra los servidores MCP en Claude Desktop y Claude Code (doble clic). Pasa los argumentos a instalar.ps1 (por ejemplo -Simular).
rem AstroPilot: only registers the MCP servers in Claude Desktop and Claude Code (double click).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1" -SoloMCP %*
echo.
pause
