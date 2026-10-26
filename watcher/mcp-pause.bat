@echo off
rem Pausa el watcher (crea el fichero 'pause' en el bridge).
rem Parte del proyecto de Rafael Vidal. Licencia MIT.
set B=%USERPROFILE%\.pixinsight-mcp\bridge
if not exist "%B%" mkdir "%B%"
echo pause> "%B%\pause"
echo Watcher en PAUSA: no ejecutara comandos hasta que uses mcp-resume.bat
pause
