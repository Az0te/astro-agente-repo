@echo off
rem Detiene el watcher (crea el fichero 'shutdown') y libera PixInsight.
rem Parte del proyecto de Rafael Vidal. Licencia MIT.
set B=%USERPROFILE%\.pixinsight-mcp\bridge
if not exist "%B%" mkdir "%B%"
echo stop> "%B%\shutdown"
echo Senal de PARADA enviada al watcher. PixInsight quedara libre en unos segundos.
pause
