@echo off
rem Reanuda el watcher (borra el fichero 'pause').
rem Parte del proyecto de Rafael Vidal. Licencia MIT.
set B=%USERPROFILE%\.pixinsight-mcp\bridge
if exist "%B%\pause" del "%B%\pause"
echo Watcher REANUDADO.
pause
