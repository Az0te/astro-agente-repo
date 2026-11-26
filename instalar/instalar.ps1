# Instalador de AstroPilot para Windows (PiAstroPilot, SirilAstroPilot y SetiAstroPilot) / AstroPilot installer for Windows.
# Copyright (c) 2026 Rafael Vidal. Licencia MIT / MIT licence. https://github.com/Az0te/astro-agente-repo
#
# Qué hace / What it does:
#   1. Busca PixInsight, Siril y Seti Astro Suite Pro / Finds PixInsight, Siril and Seti Astro Suite Pro.
#   2. Descarga o actualiza el repositorio en la carpeta elegida (git o ZIP) / Downloads or updates the repo (git or ZIP).
#   3. Comprueba Node.js 18+ (lo instala con winget si falta) / Checks Node.js 18+ (installs it with winget if missing).
#   4. Guía para instalar la IA: Claude, Codex, local (Ollama) o Gemini / Guides the AI install: Claude, Codex, local, Gemini.
#   5. Configura los servidores MCP (Claude Desktop, Claude Code, Codex), Siril, SASpro y PIXINSIGHT_EXE.
#   6. Crea guia/perfil.md desde perfil-ejemplo.md / Creates guia/perfil.md from the example.
# Copia de cada fichero de configuración tocado con .antes-astropilot / Backup of each config file touched: .antes-astropilot.
#
# Uso / Usage (doble clic / double click Instalar.cmd, or PowerShell):
#   instalar.ps1 [-Carpeta <ruta>] [-Simular] [-SinPreguntas] [-IA "1,3"] [-SinConfigurar] [-SoloMCP] [-SinGit] [-Idioma es|en]
#   -Simular        no cambia nada / changes nothing, only says what it would do.
#   -SinPreguntas   acepta lo de por defecto / accepts the defaults.
#   -IA "1,3"       1 Claude, 2 Codex, 3 Ollama, 4 Gemini (con / with -SinPreguntas).
#   -SinConfigurar  solo el repositorio / only the repository.
#   -SoloMCP        solo registra los MCP en Claude Desktop y Claude Code (Claude-MCP.cmd) / only registers the MCP servers in Claude.
#   -SinGit         ZIP aunque haya git / ZIP even if git is installed.
#   -Idioma         es o en; por defecto el de Windows / default: the Windows language.

[CmdletBinding()]
param(
  [string]$Carpeta = "",
  [switch]$Simular,
  [switch]$SinPreguntas,
  [switch]$SinConfigurar,
  [switch]$SoloMCP,
  [switch]$SinGit,
  [string]$IA = "",
  [string]$Idioma = ""
)

$ErrorActionPreference = "Stop"
$REPO_URL = "https://github.com/Az0te/astro-agente-repo"
$ZIP_URL  = "$REPO_URL/archive/refs/heads/main.zip"
$SUFIJO   = ".antes-astropilot"
$script:avisos = New-Object System.Collections.Generic.List[string]

if (-not $Idioma) { $Idioma = if ((Get-UICulture).TwoLetterISOLanguageName -eq "es") { "es" } else { "en" } }
$Ingles = ($Idioma.ToLower() -ne "es")
# Ojo: PowerShell no distingue mayúsculas en las variables; un $EN aquí sería el parámetro $en.
function T($es, $en) { if ($Ingles) { return $en } else { return $es } }

function Titulo($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "  [ok] $t" -ForegroundColor Green }
function Info($t)   { Write-Host "  $t" }
function Aviso($t)  { Write-Host "  [!] $t" -ForegroundColor Yellow; $script:avisos.Add($t) }
function Nota($t)   { $script:avisos.Add($t) }
function Haria($t)  { Write-Host ("  [" + (T "simulación" "dry run") + "] $t") -ForegroundColor DarkGray }

function Preguntar($texto, [bool]$porDefecto = $true) {
  if ($SinPreguntas) { return $porDefecto }
  $op = if ($porDefecto) { T "S/n" "Y/n" } else { T "s/N" "y/N" }
  $r = Read-Host "  $texto [$op]"
  if ([string]::IsNullOrWhiteSpace($r)) { return $porDefecto }
  $r = $r.Trim().ToLower()
  return ($r.StartsWith("s") -or $r.StartsWith("y"))
}

function Barras($p) { return ($p -replace '\\', '/') }

# Copia antes de tocar: .antes-astropilot la primera vez; si ya hay una, otra con fecha (no se pisa ninguna).
function Copia($f) {
  if (-not (Test-Path -LiteralPath $f)) { return }
  $c = $f + $SUFIJO
  if (Test-Path -LiteralPath $c) { $c = $f + $SUFIJO + "-" + (Get-Date -Format "yyyyMMdd-HHmmss") }
  Copy-Item -LiteralPath $f -Destination $c
}

function EscribirUtf8SinBom($f, $texto) {
  [System.IO.File]::WriteAllText($f, $texto, (New-Object System.Text.UTF8Encoding $false))
}

function Comando($nombre) {
  $c = Get-Command $nombre -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return $c.Source }
  return $null
}

function RefrescarPath {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

function Winget($id) {
  $w = Comando "winget"
  if (-not $w) { return $false }
  & $w install --id $id -e --accept-source-agreements --accept-package-agreements
  RefrescarPath
  return $true
}

# --- 1. Programas / Programs ----------------------------------------------------------------------------------------

function EntradasDesinstalar {
  $claves = @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
              "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
              "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*")
  foreach ($k in $claves) {
    Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } |
      Select-Object DisplayName, DisplayVersion, InstallLocation
  }
}

function BuscarExe($patron, [string[]]$relativos, [string[]]$porDefecto) {
  $cands = New-Object System.Collections.Generic.List[string]
  foreach ($e in (EntradasDesinstalar | Where-Object { $_.DisplayName -match $patron })) {
    if ($e.InstallLocation) { foreach ($r in $relativos) { $cands.Add((Join-Path $e.InstallLocation $r)) } }
  }
  foreach ($p in $porDefecto) { $cands.Add($p) }
  foreach ($c in $cands) { if (Test-Path -LiteralPath $c) { return (Resolve-Path -LiteralPath $c).Path } }
  return $null
}

Titulo (T "Programas" "Programs")
$PI_DEF = "C:\Program Files\PixInsight\bin\PixInsight.exe"
$piExe  = BuscarExe '^PixInsight' @("bin\PixInsight.exe") @($PI_DEF)
$sirilExe = BuscarExe '^Siril' @("bin\siril.exe") @("C:\Program Files\Siril\bin\siril.exe")
$sasExe = BuscarExe 'Seti ?Astro' @("setiastrosuitepro.exe") @("C:\Program Files\SetiAstroSuitePro\setiastrosuitepro.exe")
$sasScripts = Join-Path $env:LOCALAPPDATA "SASpro\scripts"
if (-not $sasExe -and (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA "SASpro"))) { $sasExe = (T "(sin ejecutable localizado)" "(executable not located)") }

$noEsta = T "no encontrado" "not found"
if ($piExe)    { Ok "PixInsight: $piExe" }    else { Info "PixInsight: $noEsta" }
if ($sirilExe) { Ok "Siril: $sirilExe" }      else { Info "Siril: $noEsta" }
if ($sasExe)   { Ok "Seti Astro Suite Pro: $sasExe" } else { Info "Seti Astro Suite Pro: $noEsta" }
if (-not ($piExe -or $sirilExe -or $sasExe)) {
  Aviso (T "No encuentro PixInsight, Siril ni SASpro. Se puede descargar el repositorio igualmente, pero no habrá nada que configurar." `
           "PixInsight, Siril and SASpro not found. The repository can still be downloaded, but there will be nothing to configure.")
}

# --- 2. Repositorio / Repository ------------------------------------------------------------------------------------

function EsRepo($c) { return (Test-Path -LiteralPath (Join-Path $c "guia\herramientas\manifiesto.json")) -and (Test-Path -LiteralPath (Join-Path $c "mcp")) }

function ElegirCarpeta {
  if ($Carpeta) { return $Carpeta }
  if ($PSScriptRoot) {
    $padre = Split-Path -Parent $PSScriptRoot
    if ($padre -and (EsRepo $padre)) { Info (T "Uso el repositorio en el que está este instalador: $padre" "Using the repository this installer is in: $padre"); return $padre }
  }
  $def = Join-Path $env:USERPROFILE "astro-agente-repo"
  if ($SinPreguntas) { return $def }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $d = New-Object System.Windows.Forms.FolderBrowserDialog
    $d.Description = T "Carpeta donde instalar AstroPilot (si no está vacía, se creará 'astro-agente-repo' dentro)" `
                       "Folder to install AstroPilot in (if it is not empty, 'astro-agente-repo' will be created inside)"
    $d.SelectedPath = $env:USERPROFILE
    if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      $sel = $d.SelectedPath
      if ((EsRepo $sel) -or -not (Test-Path -LiteralPath $sel) -or -not (Get-ChildItem -LiteralPath $sel -Force | Select-Object -First 1)) { return $sel }
      return (Join-Path $sel "astro-agente-repo")
    }
  } catch { }
  $r = Read-Host ("  " + (T "Carpeta de instalación" "Install folder") + " [$def]")
  if ([string]::IsNullOrWhiteSpace($r)) { return $def }
  return $r.Trim('"', ' ')
}

function DescargarZip($destino) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $tmp = Join-Path $env:TEMP ("astropilot_" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $zip = Join-Path $tmp "repo.zip"
    Info ((T "Descargando" "Downloading") + " $ZIP_URL ...")
    Invoke-WebRequest -Uri $ZIP_URL -OutFile $zip -UseBasicParsing
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $raiz = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
    if (-not $raiz) { throw (T "El ZIP no tiene la carpeta esperada." "The ZIP does not contain the expected folder.") }
    if (-not (Test-Path -LiteralPath $destino)) { New-Item -ItemType Directory -Path $destino | Out-Null }
    # Copia encima: sobrescribe los ficheros del repo y deja los tuyos (perfil.md, tmp_*...).
    Copy-Item -Path (Join-Path $raiz.FullName "*") -Destination $destino -Recurse -Force
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Titulo (T "Repositorio" "Repository")
$REPO = [System.IO.Path]::GetFullPath((ElegirCarpeta))
Info ((T "Carpeta" "Folder") + ": $REPO")
$git = if ($SinGit) { $null } else { Comando "git" }
$tal = T "Uso el repositorio tal como está." "Using the repository as it is."

if ($SoloMCP) {
  if (-not (EsRepo $REPO)) { throw (T "$REPO no es el repositorio de AstroPilot: ejecuta Claude-MCP.cmd desde su carpeta instalar, o el instalador completo." "$REPO is not the AstroPilot repository: run Claude-MCP.cmd from its instalar folder, or the full installer.") }
  Info $tal
} elseif (EsRepo $REPO) {
  if (Test-Path -LiteralPath (Join-Path $REPO ".git")) {
    if ($git -and (Preguntar (T "El repositorio ya está. ¿Actualizarlo con git pull?" "The repository is already there. Update it with git pull?") $true)) {
      if ($Simular) { Haria "git -C `"$REPO`" pull --ff-only" }
      else {
        & $git -C $REPO pull --ff-only
        if ($LASTEXITCODE -ne 0) { Aviso (T "git pull no pudo actualizar (¿cambios locales?). Sigo con lo que hay." "git pull could not update (local changes?). Carrying on with what is there.") }
        else { Ok (T "Repositorio actualizado (git pull)" "Repository updated (git pull)") }
      }
    } else { Info $tal }
  } elseif (Preguntar (T "El repositorio ya está (sin git). ¿Actualizarlo con el ZIP de GitHub?" "The repository is already there (no git). Update it with the GitHub ZIP?") $false) {
    if ($Simular) { Haria "ZIP $ZIP_URL -> $REPO" } else { DescargarZip $REPO; Ok (T "Repositorio actualizado (ZIP)" "Repository updated (ZIP)") }
  } else { Info $tal }
} else {
  if ((Test-Path -LiteralPath $REPO) -and (Get-ChildItem -LiteralPath $REPO -Force | Select-Object -First 1)) {
    throw (T "La carpeta $REPO existe, no está vacía y no es el repositorio. Elige otra." "The folder $REPO exists, is not empty and is not the repository. Choose another one.")
  }
  $bajado = T "Repositorio descargado en $REPO" "Repository downloaded to $REPO"
  if ($git) {
    if ($Simular) { Haria "git clone $REPO_URL `"$REPO`"" }
    else {
      & $git clone "$REPO_URL.git" $REPO
      if ($LASTEXITCODE -ne 0) { Aviso (T "git clone falló; pruebo con el ZIP." "git clone failed; trying the ZIP."); DescargarZip $REPO }
      Ok $bajado
    }
  } else {
    Info (T "No hay git: descargo el ZIP (para actualizar más adelante, vuelve a ejecutar este instalador)." "No git: downloading the ZIP (to update later, run this installer again).")
    if ($Simular) { Haria "ZIP $ZIP_URL -> $REPO" } else { DescargarZip $REPO; Ok $bajado }
  }
  if (-not $Simular -and -not (EsRepo $REPO)) { throw (T "Después de descargar, $REPO no parece el repositorio." "After downloading, $REPO does not look like the repository.") }
}

if ($SinConfigurar) { Titulo (T "Listo" "Done"); Info ((T "Repositorio en" "Repository in") + " $REPO (-SinConfigurar)."); return }

# --- 3. Node.js -----------------------------------------------------------------------------------------------------

Titulo "Node.js"
function VersionNode {
  $n = Comando "node"
  if (-not $n) { return 0 }
  try { $v = (& $n -v) -replace '^v', ''; return [int]($v.Split('.')[0]) } catch { return 0 }
}
$nodeMayor = VersionNode
if ($nodeMayor -ge 18) { Ok ("Node.js $nodeMayor " + (T "(vale 18 o superior)" "(18 or later is fine)")) }
else {
  if ($nodeMayor -gt 0) { Aviso (T "Node.js $nodeMayor es antiguo: los servidores MCP necesitan 18 o superior." "Node.js $nodeMayor is too old: the MCP servers need 18 or later.") }
  if ((Comando "winget") -and (Preguntar (T "Falta Node.js 18+. ¿Instalar Node.js LTS con winget?" "Node.js 18+ is missing. Install Node.js LTS with winget?") $true)) {
    if ($Simular) { Haria "winget install OpenJS.NodeJS.LTS" }
    else {
      [void](Winget "OpenJS.NodeJS.LTS")
      $nodeMayor = VersionNode
      if ($nodeMayor -ge 18) { Ok "Node.js $nodeMayor" }
      else { Aviso (T "No veo Node.js tras instalarlo: cierra y vuelve a abrir la ventana y repite el instalador." "Node.js not found after installing: close and reopen the window and run the installer again.") }
    }
  } elseif ($nodeMayor -lt 18) { Aviso (T "Instala Node.js 18 o superior desde https://nodejs.org y vuelve a ejecutar el instalador." "Install Node.js 18 or later from https://nodejs.org and run the installer again.") }
}
$node = Comando "node"

# --- 4. Inteligencia artificial / AI --------------------------------------------------------------------------------

function VramGB {
  $max = 0
  $k = "HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*"
  foreach ($e in (Get-ItemProperty $k -ErrorAction SilentlyContinue)) {
    $b = $e."HardwareInformation.qwMemorySize"
    if ($b) { $g = [math]::Round([double]$b / 1GB); if ($g -gt $max) { $max = $g } }
  }
  return $max
}

# Claude Desktop: instalación clásica (AnthropicClaude), paquete MSIX (Packages\Claude_*) o ya configurado (%APPDATA%\Claude).
function HayClaudeDesktop {
  if (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA "AnthropicClaude")) { return $true }
  if (Test-Path -LiteralPath (Join-Path $env:APPDATA "Claude")) { return $true }
  return [bool](Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA "Packages") -Directory -Filter "Claude_*" -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function IaClaude {
  Info (T "Claude (Anthropic): la mejor con la guía. Hay dos formas de usarla:" "Claude (Anthropic): the best with the guide. There are two ways to use it:")
  Info (T "  - La app Claude Desktop con una cuenta GRATIS de claude.ai: habla con PixInsight, Siril y SASpro por MCP." `
          "  - The Claude Desktop app with a FREE claude.ai account: talks to PixInsight, Siril and SASpro through MCP.")
  Info (T "    Con la cuenta gratis usa solo el modelo Sonnet. La cuota gratis es pequeña y puede agotarse a mitad de un procesado; entonces hay que esperar unas horas." `
          "    With the free account use only the Sonnet model. The free quota is small and can run out halfway through a processing session; then you have to wait a few hours.")
  Info (T "  - Claude Code (el comando claude de la terminal): NO tiene plan gratis, pide suscripción Pro/Max o clave de API." `
          "  - Claude Code (the claude command in the terminal): has NO free plan, it asks for a Pro/Max subscription or an API key.")
  Info (T "    Lo usan el Lite, el módulo y los chats de Siril y SASpro con el proveedor Claude." `
          "    The Lite, the module and the Siril and SASpro chats use it with the Claude provider.")
  $code = (Comando "claude") -or (Test-Path -LiteralPath (Join-Path $env:USERPROFILE ".local\bin\claude.exe"))
  if (HayClaudeDesktop) { Ok (T "Claude Desktop ya está instalado" "Claude Desktop is already installed") }
  elseif (Preguntar (T "¿Instalar Claude Desktop (la app; vale la cuenta gratis)?" "Install Claude Desktop (the app; a free account is enough)?") $true) {
    if ($Simular) { Haria "winget install Anthropic.Claude" }
    elseif (Winget "Anthropic.Claude") { Ok (T "Claude Desktop instalado: ábrelo e inicia sesión (o crea una cuenta gratis)." "Claude Desktop installed: open it and sign in (or create a free account).") }
    else { Aviso (T "Descarga Claude Desktop de https://claude.ai/download" "Download Claude Desktop from https://claude.ai/download"); Start-Process "https://claude.ai/download" }
  }
  if ((HayClaudeDesktop) -or $Simular) { Nota (T "Claude Desktop: inicia sesión en la app (la cuenta gratis vale) y, con la cuenta gratis, usa solo Sonnet en el selector de modelo. Para cargar la guía, en el chat pulsa + y añade SKILL.md del conector piastropilot (o sirilastropilot / setiastropilot). Si se agota la cuota gratis, sigue con Gemini (gratis con clave) o con Qwen local (Ollama)." `
          "Claude Desktop: sign in in the app (a free account is enough) and, with the free account, use only Sonnet in the model picker. To load the guide, press + in the chat and add SKILL.md from the piastropilot connector (or sirilastropilot / setiastropilot). If the free quota runs out, carry on with Gemini (free with a key) or local Qwen (Ollama).") }
  if ($code) { Ok (T "Claude Code ya está instalado" "Claude Code is already installed"); [void](ComprobarClaudeCode $false); return }
  if (-not (Preguntar (T "¿Tienes suscripción Pro/Max o clave de API de Anthropic? (sin ella Claude Code no funciona; con la cuenta gratis basta Claude Desktop)" `
                         "Do you have a Pro/Max subscription or an Anthropic API key? (without one Claude Code does not work; with a free account Claude Desktop is enough)") $false)) {
    Nota (T "Claude Code no instalado: con cuenta gratis no escribas claude en la terminal (pide suscripción); usa la app Claude Desktop." `
            "Claude Code not installed: with a free account do not type claude in the terminal (it asks for a subscription); use the Claude Desktop app.")
    return
  }
  if (Preguntar (T "¿Instalar Claude Code (lo usan el Lite, el módulo y los chats de Siril y SASpro)?" "Install Claude Code (used by the Lite, the module and the Siril and SASpro chats)?") $true) {
    if ($Simular) { Haria "irm https://claude.ai/install.ps1 | iex" }
    else {
      try { Invoke-RestMethod "https://claude.ai/install.ps1" | Invoke-Expression }
      catch { Aviso ((T "El instalador oficial de Claude Code falló:" "The official Claude Code installer failed:") + " $($_.Exception.Message)") }
      RefrescarPath
    }
    if (ComprobarClaudeCode $true) { Ok (T "Claude Code instalado." "Claude Code installed.") }
  }
}

# Carpeta del claude.exe del instalador oficial.
function CarpetaClaudeCode { return (Join-Path $env:USERPROFILE ".local\bin") }

# Añade una carpeta al PATH del usuario sin estropear las entradas con %VARIABLES%: se lee el valor sin expandir del
# registro y se escribe como REG_EXPAND_SZ (SetEnvironmentVariable lo guardaría expandido y como REG_SZ).
function AnadirAlPathUsuario($carpeta) {
  $clave = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
  try {
    $crudo = "" + $clave.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    foreach ($e in ($crudo -split ';')) {
      if ($e -and ([Environment]::ExpandEnvironmentVariables($e).TrimEnd('\') -ieq $carpeta.TrimEnd('\'))) { return $false }
    }
    $nuevo = if ($crudo.Trim().TrimEnd(';')) { $crudo.TrimEnd(';') + ";" + $carpeta } else { $carpeta }
    $clave.SetValue("Path", $nuevo, [Microsoft.Win32.RegistryValueKind]::ExpandString)
  } finally { $clave.Close() }
  # Aviso a Windows de que cambió el entorno (las terminales que se abran después ya lo ven).
  [Environment]::SetEnvironmentVariable("ASTROPILOT_TMP", "1", "User")
  [Environment]::SetEnvironmentVariable("ASTROPILOT_TMP", $null, "User")
  return $true
}

# Tras instalar Claude Code (o si ya estaba): claude --version, su carpeta en el PATH del usuario y, recién instalado,
# abrirlo en otra ventana para iniciar sesión. Devuelve $true si claude responde.
function ComprobarClaudeCode([bool]$recien) {
  $dir = CarpetaClaudeCode
  $exe = Comando "claude"
  if (-not $exe -and (Test-Path -LiteralPath (Join-Path $dir "claude.exe"))) { $exe = Join-Path $dir "claude.exe" }
  if ($Simular) {
    Haria "claude --version"
    Haria ((T "añadir al PATH del usuario, si falta:" "add to the user PATH, if missing:") + " $dir")
    if ($recien) { Haria (T "abrir claude en otra ventana para iniciar sesión" "open claude in another window to sign in") }
    return $true
  }
  if (-not $exe) {
    Aviso (T "No encuentro claude.exe tras instalar Claude Code. Repite en una terminal: irm https://claude.ai/install.ps1 | iex" `
             "claude.exe not found after installing Claude Code. Run again in a terminal: irm https://claude.ai/install.ps1 | iex")
    return $false
  }
  $ErrorActionPreference = "Continue"
  $version = (& $exe --version 2>&1 | Select-Object -First 1)
  $codigo = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($codigo -ne 0) { Aviso ((T "claude --version falló:" "claude --version failed:") + " $version"); return $false }
  Ok "claude --version: $version"
  $carpetaExe = Split-Path -Parent $exe
  if ($carpetaExe -ieq $dir.TrimEnd('\')) {
    if (AnadirAlPathUsuario $dir) { Ok ((T "Añadido al PATH del usuario:" "Added to the user PATH:") + " $dir " + (T "(vale en las terminales que abras a partir de ahora)" "(works in terminals opened from now on)")) }
    else { Info ((T "PATH del usuario: ya incluye" "User PATH: already includes") + " $dir") }
    if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $dir.TrimEnd('\') })) { $env:Path += ";" + $dir }
  }
  if ($recien) {
    Info (T "Falta iniciar sesión una vez con tu suscripción o clave de API (se abre el navegador)." "You still need to sign in once with your subscription or API key (the browser opens).")
    if (-not $SinPreguntas -and (Preguntar (T "¿Abrir Claude Code ahora en otra ventana para iniciar sesión?" "Open Claude Code now in another window to sign in?") $true)) {
      Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-NoProfile", "-Command", "& '$($exe -replace "'", "''")'")
      Ok (T "Claude Code abierto en otra ventana: sigue sus pasos para iniciar sesión y luego ciérrala." "Claude Code opened in another window: follow its steps to sign in, then close it.")
    } else {
      Nota (T "Claude Code: abre una terminal nueva, escribe claude e inicia sesión una vez con tu suscripción o clave de API." "Claude Code: open a new terminal, type claude and sign in once with your subscription or API key.")
    }
  }
  return $true
}

function IaCodex {
  Info (T "Codex (OpenAI): buena con la guía. Necesita suscripción de ChatGPT o clave de API." "Codex (OpenAI): good with the guide. Needs a ChatGPT subscription or an API key.")
  if (Comando "codex") { Ok (T "Codex ya está instalado" "Codex is already installed") }
  else {
    $npm = Comando "npm"
    if (-not $npm) { Aviso (T "Codex necesita Node.js (npm). Instala Node.js y repite." "Codex needs Node.js (npm). Install Node.js and run again."); return }
    if (Preguntar (T "¿Instalar Codex (npm install -g @openai/codex)?" "Install Codex (npm install -g @openai/codex)?") $true) {
      if ($Simular) { Haria "npm install -g @openai/codex" }
      else { & $npm install -g "@openai/codex"; RefrescarPath; Ok (T "Codex instalado." "Codex installed.") }
    } else { return }
  }
  $dir = Join-Path $env:USERPROFILE ".codex"
  if (-not $Simular -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $codex = Comando "codex"
  if ($codex -and -not $Simular -and (Preguntar (T "¿Iniciar sesión en Codex ahora (abre el navegador)?" "Sign in to Codex now (opens the browser)?") $true)) { & $codex login }
  else { Nota (T "Codex: en una terminal, codex login (una vez)." "Codex: in a terminal, codex login (once).") }
}

function IaLocal {
  $vram = VramGB
  Info (T "IA local con Ollama: gratis y sin enviar nada fuera del PC. Pide una gráfica con mucha memoria." `
          "Local AI with Ollama: free and nothing leaves your PC. Needs a graphics card with plenty of memory.")
  if ($vram -gt 0) { Info (T "Tu gráfica tiene unos $vram GB." "Your graphics card has about $vram GB.") }
  $modelo = if ($vram -ge 20) { "qwen3:32b" } elseif ($vram -ge 12) { "qwen3:14b" } else { "qwen3:8b" }
  if ($vram -lt 20) {
    Aviso (T "Con menos de 20 GB de gráfica los modelos locales van justos con la guía: $modelo servirá para probar, pero elegirá peor que Claude o uno de 32B." `
             "With less than 20 GB of graphics memory local models struggle with the guide: $modelo will do for testing, but it will choose worse than Claude or a 32B model.")
  }
  $exeOllama = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
  $ollama = Comando "ollama"
  if (-not $ollama -and (Test-Path -LiteralPath $exeOllama)) { $ollama = $exeOllama }
  if ($ollama) { Ok (T "Ollama ya está instalado" "Ollama is already installed") }
  elseif (Preguntar (T "¿Instalar Ollama?" "Install Ollama?") $true) {
    if ($Simular) { Haria "winget install Ollama.Ollama" }
    elseif (Winget "Ollama.Ollama") {
      $ollama = Comando "ollama"
      if (-not $ollama -and (Test-Path -LiteralPath $exeOllama)) { $ollama = $exeOllama }
      Ok (T "Ollama instalado." "Ollama installed.")
    } else { Aviso (T "Descarga Ollama de https://ollama.com/download" "Download Ollama from https://ollama.com/download"); Start-Process "https://ollama.com/download"; return }
  } else { return }
  if (Preguntar (T "¿Descargar ahora el modelo $modelo (varios GB)?" "Download the $modelo model now (several GB)?") $true) {
    if ($Simular -or -not $ollama) { Haria "ollama pull $modelo" }
    else {
      & $ollama pull $modelo
      if ($LASTEXITCODE -eq 0) { Ok (T "Modelo $modelo descargado" "Model $modelo downloaded") }
      else { Aviso (T "No se pudo descargar ${modelo}: abre Ollama y repite ollama pull $modelo" "Could not download ${modelo}: open Ollama and run ollama pull $modelo") }
    }
  } else { Nota (T "IA local: ollama pull $modelo cuando quieras." "Local AI: ollama pull $modelo whenever you like.") }
  Nota (T "IA local: en el Lite elige el proveedor Ollama; en los chats de Siril y SASpro tus modelos salen solos." `
          "Local AI: in the Lite choose the Ollama provider; in the Siril and SASpro chats your models appear by themselves.")
}

function IaGemini {
  Info (T "Gemini (Google): gratis con una clave, pero MENOS fiable con la guía. Sirve para probar; revisa cada paso." `
          "Gemini (Google): free with a key, but LESS reliable with the guide. Good for trying it out; check every step.")
  Info (T "En el nivel gratis Google puede usar lo que se envía (medidas y miniaturas) para mejorar sus modelos." `
          "On the free tier Google may use what is sent (measurements and thumbnails) to improve its models.")
  if ([Environment]::GetEnvironmentVariable("GEMINI_API_KEY", "User")) { Ok (T "Ya tienes la clave GEMINI_API_KEY guardada" "Your GEMINI_API_KEY is already saved"); return }
  if (-not (Preguntar (T "¿Abrir la página para sacar la clave gratis y guardarla aquí?" "Open the page to get the free key and save it here?") $true)) { return }
  if ($Simular) { Haria "https://aistudio.google.com/apikey -> GEMINI_API_KEY"; return }
  Start-Process "https://aistudio.google.com/apikey"
  $seg = Read-Host ("  " + (T "Pega la clave (no se ve al escribir; Intro vacío para saltar)" "Paste the key (hidden while typing; empty Enter to skip)")) -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg)
  try { $clave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
  if ([string]::IsNullOrWhiteSpace($clave)) { Info (T "Sin clave: se puede poner luego en el chat (botón Clave...)." "No key: you can add it later in the chat (Key... button)."); return }
  [Environment]::SetEnvironmentVariable("GEMINI_API_KEY", $clave.Trim(), "User")
  $clave = $null
  Ok (T "Clave de Gemini guardada en tu usuario (GEMINI_API_KEY). No la compartas." "Gemini key saved for your user (GEMINI_API_KEY). Do not share it.")
}

if (-not $SoloMCP) {
Titulo (T "Inteligencia artificial" "Artificial intelligence")
Info (T "¿Qué IA vas a usar? Puedes elegir varias, separadas por comas:" "Which AI will you use? You can pick several, separated by commas:")
Info (T "  1 = Claude (la mejor; app Claude Desktop con cuenta gratis, o de pago)   2 = Codex (OpenAI, de pago)" `
        "  1 = Claude (the best; Claude Desktop app with a free account, or paid)   2 = Codex (OpenAI, paid)")
Info (T "  3 = Local con Ollama (gratis, necesita gráfica potente)   4 = Gemini (gratis con clave, menos fiable)" `
        "  3 = Local with Ollama (free, needs a powerful graphics card)   4 = Gemini (free with a key, less reliable)")
Info (T "  0 o Intro = ninguna ahora" "  0 or Enter = none for now")
$eleccion = if ($SinPreguntas) { $IA } else { Read-Host ("  " + (T "Elección" "Choice")) }
foreach ($o in (("" + $eleccion) -split '[,; ]+' | Where-Object { $_ })) {
  switch ($o.Trim()) {
    "1" { Write-Host ""; IaClaude }
    "2" { Write-Host ""; IaCodex }
    "3" { Write-Host ""; IaLocal }
    "4" { Write-Host ""; IaGemini }
    "0" { }
    default { Aviso ((T "Opción desconocida" "Unknown option") + ": $o") }
  }
}
}

# --- 5. Servidores MCP / MCP servers --------------------------------------------------------------------------------

$servidores = [ordered]@{}
if ($piExe)    { $servidores["piastropilot"]    = Join-Path $REPO "mcp\dist\piastropilot-mcp.mjs" }
if ($sirilExe) { $servidores["sirilastropilot"] = Join-Path $REPO "siril\mcp\dist\sirilastropilot-mcp.mjs" }
if ($sasExe)   { $servidores["setiastropilot"]  = Join-Path $REPO "sas\mcp\dist\setiastropilot-mcp.mjs" }

function PonerVariable($nombre, $valor) {
  $actual = [Environment]::GetEnvironmentVariable($nombre, "User")
  if ($actual -eq $valor) { Info ("$nombre = $valor " + (T "(ya estaba)" "(already set)")); return }
  if ($Simular) { Haria ((T "variable de usuario" "user variable") + " $nombre = $valor"); return }
  [Environment]::SetEnvironmentVariable($nombre, $valor, "User")
  Ok ((T "Variable de usuario" "User variable") + " $nombre = $valor")
}

# Claude Desktop: claude_desktop_config.json. Se edita con node (PowerShell 5.1 no lee bien algunos JSON) y, si el
# fichero está roto (le falta una llave al final, por ejemplo), se intenta reparar; si no se puede, no se toca.
$JS_DESKTOP = @'
const fs = require("fs");
const f = process.env.AP_CFG, simular = process.env.AP_SIMULAR === "1";
const srv = JSON.parse(process.env.AP_SRV);
let txt = fs.existsSync(f) ? fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "").trim() : "{}";
if (!txt) txt = "{}";
let cfg = null, reparado = false;
for (const t of [txt, txt + "}", txt + "}}", txt + "]}", txt + "}]}"]) {
  try { cfg = JSON.parse(t); reparado = t !== txt; break; } catch (e) {}
}
if (!cfg || typeof cfg !== "object") { console.log("ROTO"); process.exit(2); }
if (reparado) console.log("REPARADO");
cfg.mcpServers = cfg.mcpServers || {};
// Nombres antiguos del proyecto cuyo servidor ya no existe en disco.
for (const viejo of ["pixinsight", "picopilot"]) {
  const s = cfg.mcpServers[viejo];
  if (s && Array.isArray(s.args) && s.args.length && !fs.existsSync(s.args[s.args.length - 1])) {
    delete cfg.mcpServers[viejo]; console.log("QUITADO " + viejo);
  }
}
for (const k of Object.keys(srv)) {
  const antes = JSON.stringify(cfg.mcpServers[k] || null);
  cfg.mcpServers[k] = Object.assign({}, cfg.mcpServers[k] || {}, srv[k]);
  console.log((antes === JSON.stringify(cfg.mcpServers[k]) ? "IGUAL " : "PUESTO ") + k);
}
if (!simular) fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + "\n", "utf8");
'@

# Carpetas donde Claude Desktop lee claude_desktop_config.json: %APPDATA%\Claude y, si existe, la copia virtualizada
# del paquete MSIX. Recién instalado y sin abrir aún no hay carpeta: se crea %APPDATA%\Claude.
function CarpetasClaudeDesktop {
  $dirs = New-Object System.Collections.Generic.List[string]
  $normal = Join-Path $env:APPDATA "Claude"
  if ((Test-Path -LiteralPath $normal) -or (HayClaudeDesktop)) { $dirs.Add($normal) }
  foreach ($p in (Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA "Packages") -Directory -Filter "Claude_*" -ErrorAction SilentlyContinue)) {
    $v = Join-Path $p.FullName "LocalCache\Roaming\Claude"
    if (Test-Path -LiteralPath $v) { $dirs.Add($v) }
  }
  return ,$dirs
}

function ConfigurarClaudeDesktop {
  $dirs = CarpetasClaudeDesktop
  if ($dirs.Count -eq 0) { Info (T "Claude Desktop: no está instalado." "Claude Desktop: not installed."); return }
  if (-not $node) { Aviso (T "Claude Desktop: sin Node.js no puedo editar su configuración." "Claude Desktop: without Node.js its settings cannot be edited."); return }
  foreach ($dir in $dirs) { ConfigurarClaudeDesktopEn $dir }
  if (-not $Simular -and (Get-Process -Name "claude" -ErrorAction SilentlyContinue)) {
    Aviso (T "Claude Desktop está abierto: ciérralo del todo (también en la bandeja) y vuelve a abrirlo para que vea los servidores." `
             "Claude Desktop is open: quit it completely (also from the tray) and reopen it so it sees the servers.")
  }
}

function ConfigurarClaudeDesktopEn($dir) {
  $msix = if ($dir -like "*\Packages\Claude_*") { " (MSIX)" } else { "" }
  if (-not (Test-Path -LiteralPath $dir)) {
    if ($Simular) { Haria ((T "crear" "create") + " $dir") } else { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  }
  $cfg = Join-Path $dir "claude_desktop_config.json"
  $srv = [ordered]@{}
  foreach ($k in $servidores.Keys) { $srv[$k] = @{ command = "node"; args = @((Barras $servidores[$k])) } }
  $js = Join-Path $env:TEMP "astropilot_desktop.js"
  EscribirUtf8SinBom $js $JS_DESKTOP
  $env:AP_CFG = $cfg; $env:AP_SRV = ($srv | ConvertTo-Json -Depth 5 -Compress)
  # Primero en seco: solo se copia y se escribe si hay algo que cambiar.
  $env:AP_SIMULAR = "1"
  $salida = & $node $js 2>&1
  $codigo = $LASTEXITCODE
  $cambia = @($salida | Where-Object { "$_" -match '^(PUESTO|QUITADO|REPARADO)' }).Count -gt 0
  if ($codigo -eq 0 -and $cambia -and -not $Simular) {
    Copia $cfg
    $env:AP_SIMULAR = "0"
    $salida = & $node $js 2>&1
    $codigo = $LASTEXITCODE
  }
  Remove-Item -LiteralPath $js -ErrorAction SilentlyContinue
  if ($codigo -ne 0) {
    Aviso (T "Claude Desktop: $cfg no es un JSON válido y no sé repararlo; no lo toco. Añade los servidores a mano (mcp\README.md)." `
             "Claude Desktop: $cfg is not valid JSON and cannot be repaired; left untouched. Add the servers by hand (mcp\README.md).")
    return
  }
  foreach ($l in $salida) {
    $l = "$l"
    if ($l -eq "REPARADO") {
      if ($Simular) { Haria (T "Claude Desktop: su configuración está rota (JSON incompleto); la repararía." "Claude Desktop: its settings are broken (incomplete JSON); would repair them.") }
      else { Aviso (T "Claude Desktop: su configuración estaba rota (JSON incompleto); la he reparado (copia en $cfg$SUFIJO)." "Claude Desktop: its settings were broken (incomplete JSON); repaired (backup in $cfg$SUFIJO).") }
    }
    elseif ($l.StartsWith("QUITADO ")) {
      $t = (T "Claude Desktop${msix}: quitado el servidor viejo" "Claude Desktop${msix}: removed the old server") + " $($l.Substring(8)) " + (T "(su fichero ya no existe)" "(its file no longer exists)")
      if ($Simular) { Haria $t } else { Ok $t }
    }
    elseif ($l.StartsWith("PUESTO ")) { $t = (T "Claude Desktop${msix}: servidor" "Claude Desktop${msix}: server") + " $($l.Substring(7))"; if ($Simular) { Haria $t } else { Ok $t } }
    elseif ($l.StartsWith("IGUAL ")) { Info ("Claude Desktop${msix}: $($l.Substring(6)) " + (T "ya estaba bien" "already correct")) }
  }
}

function ConfigurarClaudeCode {
  $claude = Comando "claude"
  if (-not $claude) {
    $p = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
    if (Test-Path -LiteralPath $p) { $claude = $p }
  }
  if (-not $claude) { Info (T "Claude Code: no está instalado." "Claude Code: not installed."); return }
  foreach ($k in $servidores.Keys) {
    $ruta = Barras $servidores[$k]
    if ($Simular) { Haria "claude mcp add --scope user $k -- node $ruta"; continue }
    $ErrorActionPreference = "Continue"
    & $claude mcp remove --scope user $k 2>&1 | Out-Null
    & $claude mcp add --scope user $k -- node $ruta 2>&1 | Out-Null
    $codigo = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($codigo -eq 0) { Ok ((T "Claude Code: servidor" "Claude Code: server") + " $k") }
    else { Aviso ((T "Claude Code: no pude registrar $k. A mano:" "Claude Code: could not register $k. By hand:") + " claude mcp add --scope user $k -- node $ruta") }
  }
}

function ConfigurarCodex {
  $dir = Join-Path $env:USERPROFILE ".codex"
  if (-not (Test-Path -LiteralPath $dir)) { Info (T "Codex: no está instalado." "Codex: not installed."); return }
  $f = Join-Path $dir "config.toml"
  $lineas = if (Test-Path -LiteralPath $f) { [System.IO.File]::ReadAllLines($f) } else { @() }
  $nuevas = New-Object System.Collections.Generic.List[string]
  $saltando = $false
  foreach ($l in $lineas) {
    if ($l -match '^\s*\[') { $saltando = $false; foreach ($k in $servidores.Keys) { if ($l -match ('^\s*\[mcp_servers\.' + [regex]::Escape($k) + '(\.|\])')) { $saltando = $true } } }
    if (-not $saltando) { $nuevas.Add($l) }
  }
  while ($nuevas.Count -and [string]::IsNullOrWhiteSpace($nuevas[$nuevas.Count - 1])) { $nuevas.RemoveAt($nuevas.Count - 1) }
  foreach ($k in $servidores.Keys) {
    $nuevas.Add(""); $nuevas.Add("[mcp_servers.$k]"); $nuevas.Add('command = "node"'); $nuevas.Add('args = ["' + (Barras $servidores[$k]) + '"]')
  }
  $t = (T "Codex: servidores" "Codex: servers") + " $($servidores.Keys -join ', ') (config.toml)"
  if ($Simular) { Haria $t; return }
  Copia $f
  EscribirUtf8SinBom $f (($nuevas -join "`r`n") + "`r`n")
  Ok $t
}

if ($servidores.Count) {
  Titulo (T "Servidores MCP" "MCP servers")
  foreach ($k in $servidores.Keys) { if (-not (Test-Path -LiteralPath $servidores[$k]) -and -not $Simular) { Aviso ((T "Falta" "Missing") + " $($servidores[$k])") } }
  ConfigurarClaudeDesktop
  ConfigurarClaudeCode
  if (-not $SoloMCP) { ConfigurarCodex }
  if ($SoloMCP -and (HayClaudeDesktop)) {
    Nota (T "Claude Desktop: con la cuenta gratis usa solo Sonnet. Para cargar la guía, en el chat pulsa + y añade SKILL.md del conector piastropilot (o sirilastropilot / setiastropilot). Si se agota la cuota gratis, sigue con Gemini (gratis con clave) o con Qwen local (Ollama)." `
            "Claude Desktop: with the free account use only Sonnet. To load the guide, press + in the chat and add SKILL.md from the piastropilot connector (or sirilastropilot / setiastropilot). If the free quota runs out, carry on with Gemini (free with a key) or local Qwen (Ollama).")
  }
} elseif ($SoloMCP) {
  Aviso (T "No encuentro PixInsight, Siril ni SASpro: no hay ningún MCP que registrar." "PixInsight, Siril and SASpro not found: there is no MCP server to register.")
}

# --- 6. Cada programa / Each program --------------------------------------------------------------------------------

if ($piExe) {
  Titulo "PixInsight"
  if ($piExe -ne $PI_DEF) { PonerVariable "PIXINSIGHT_EXE" (Barras $piExe) }
  else { Info (T "PixInsight en su ruta habitual: no hace falta PIXINSIGHT_EXE." "PixInsight in its usual place: PIXINSIGHT_EXE not needed.") }
  $lite = Join-Path $REPO "piastropilot\script"
  $t = T "PixInsight: para el Lite (opcional, sin MCP), Script > Feature Scripts... > Add > $lite > Done (no se puede hacer desde fuera de PixInsight)." `
         "PixInsight: for the Lite (optional, no MCP), Script > Feature Scripts... > Add > $lite > Done (cannot be done from outside PixInsight)."
  if (-not $SoloMCP) { Info $t; Nota $t }
}

function ConfigurarSiril {
  $dir = Join-Path $env:LOCALAPPDATA "siril"
  $ini = Get-ChildItem -LiteralPath $dir -Filter "config.*.ini" -ErrorAction SilentlyContinue |
         Sort-Object { try { [version]($_.Name -replace '^config\.', '' -replace '\.ini$', '') } catch { [version]"0.0" } } -Descending |
         Select-Object -First 1
  $puente = Join-Path $REPO "siril\puente"
  if (-not $ini) {
    Aviso (T "Siril: no encuentro su configuración (¿no se ha abierto nunca?). Ábrelo una vez y repite, o en Preferencias > Scripts añade $puente." `
             "Siril: its settings were not found (never opened?). Open it once and run again, or add $puente in Preferences > Scripts.")
    return
  }
  if (-not $Simular -and (Get-Process -Name "siril" -ErrorAction SilentlyContinue)) {
    Aviso (T "Siril está abierto y guarda su configuración al cerrarse (borraría el cambio). Ciérralo y repite el instalador, o añade $puente en Preferencias > Scripts." `
             "Siril is open and saves its settings on exit (it would undo the change). Close it and run the installer again, or add $puente in Preferences > Scripts.")
    return
  }
  $texto = [System.IO.File]::ReadAllText($ini.FullName)
  $nl = if ($texto.Contains("`r`n")) { "`r`n" } else { "`n" }
  $lineas = New-Object System.Collections.Generic.List[string]
  $lineas.AddRange([string[]]($texto -split "\r?\n"))
  $iniEsc = $puente -replace '\\', '\\'
  $enGui = $false; $idxGui = -1; $hecho = $false
  for ($i = 0; $i -lt $lineas.Count; $i++) {
    $l = $lineas[$i]
    if ($l -match '^\s*\[(.+)\]\s*$') { $enGui = ($Matches[1] -eq "gui"); if ($enGui) { $idxGui = $i }; continue }
    if ($enGui -and $l -match '^\s*script_path\s*=(.*)$') {
      $lista = @($Matches[1].Split(';') | Where-Object { $_ -ne "" })
      $ya = $lista | Where-Object { ($_ -replace '\\\\', '\').TrimEnd('\') -ieq $puente.TrimEnd('\') }
      if ($ya) { Info (T "Siril: $puente ya está en las carpetas de scripts." "Siril: $puente is already in the script folders."); return }
      # Quitar otras copias del puente que ya no existan (repo movido) / drop stale copies of the bridge folder.
      $lista = @($lista | Where-Object { $p = ($_ -replace '\\\\', '\'); -not ($p -match 'siril\\puente\\?$' -and -not (Test-Path -LiteralPath $p)) })
      $lineas[$i] = "script_path=" + (($lista + $iniEsc) -join ';') + ";"
      $hecho = $true; break
    }
  }
  if (-not $hecho) {
    if ($idxGui -lt 0) { $lineas.Add("[gui]"); $idxGui = $lineas.Count - 1 }
    $lineas.Insert($idxGui + 1, "script_path=$iniEsc;")
  }
  $t = (T "Siril: añadido $puente a las carpetas de scripts" "Siril: added $puente to the script folders") + " ($($ini.Name))"
  if ($Simular) { Haria $t; return }
  Copia $ini.FullName
  EscribirUtf8SinBom $ini.FullName ($lineas -join $nl)
  Ok $t
}
if ($sirilExe -and -not $SoloMCP) { Titulo "Siril"; ConfigurarSiril }

# Mismo contenido aunque cambien los saltos de línea (git en Windows deja CRLF; una copia anterior puede tener LF).
function MismoTexto($a, $b) {
  if (-not (Test-Path -LiteralPath $a) -or -not (Test-Path -LiteralPath $b)) { return $false }
  return (([System.IO.File]::ReadAllText($a) -replace "`r`n", "`n") -ceq ([System.IO.File]::ReadAllText($b) -replace "`r`n", "`n"))
}

function ConfigurarSas {
  PonerVariable "SETIASTROPILOT_REPO" $REPO
  foreach ($n in @("SetiAstroPilot.py", "SetiAstroPilot_Chat.py")) {
    $origen = Join-Path $REPO "sas\puente\$n"
    $destino = Join-Path $sasScripts $n
    $t = (T "SASpro: copiado $n a" "SASpro: copied $n to") + " $sasScripts"
    if (MismoTexto $destino $origen) {
      Info (T "SASpro: $n ya está al día." "SASpro: $n is up to date."); continue
    }
    if ($Simular) { Haria $t; continue }
    if (-not (Test-Path -LiteralPath $sasScripts)) { New-Item -ItemType Directory -Path $sasScripts -Force | Out-Null }
    Copia $destino
    Copy-Item -LiteralPath $origen -Destination $destino -Force
    Ok $t
  }
  Info (T "En SASpro, Flujos de trabajo > Scripts > Reload Scripts: aparece AstroPilot > SetiAstroPilot." "In SASpro, Workflows > Scripts > Reload Scripts: AstroPilot > SetiAstroPilot appears.")
}
if ($sasExe -and -not $SoloMCP) { Titulo "Seti Astro Suite Pro"; ConfigurarSas }

# --- 7. Perfil / Profile --------------------------------------------------------------------------------------------

$perfil = Join-Path $REPO "guia\perfil.md"
$ejemplo = Join-Path $REPO "guia\perfil-ejemplo.md"
if (-not $SoloMCP -and -not (Test-Path -LiteralPath $perfil) -and (Test-Path -LiteralPath $ejemplo)) {
  Titulo (T "Perfil" "Profile")
  $t = T "Creado guia\perfil.md: rellénalo con tu equipo, tu cielo y tus rutas." "Created guia\perfil.md: fill it in with your equipment, sky and paths."
  if ($Simular) { Haria $t } else { Copy-Item -LiteralPath $ejemplo -Destination $perfil; Ok $t }
}

# --- Resumen / Summary ----------------------------------------------------------------------------------------------

Titulo (T "Resumen" "Summary")
Info ((T "Repositorio" "Repository") + ": $REPO")
if ($Simular) { Info (T "Simulación: no se ha cambiado nada." "Dry run: nothing has been changed.") }
foreach ($a in $script:avisos) { Write-Host "  - $a" -ForegroundColor Yellow }
Info (T "Para actualizar más adelante, vuelve a ejecutar este instalador." "To update later, run this installer again.")
Info (T "Las copias de los ficheros de configuración tocados terminan en $SUFIJO." "Backups of the config files touched end in $SUFIJO.")
