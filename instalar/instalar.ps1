# Instalador de AstroPilot para Windows (PiAstroPilot, SirilAstroPilot y SetiAstroPilot).
# Copyright (c) 2026 Rafael Vidal. Licencia MIT. https://github.com/Az0te/astro-agente-repo
#
# Qué hace:
#   1. Busca PixInsight, Siril y Seti Astro Suite Pro (registro de Windows y carpetas habituales).
#   2. Descarga el repositorio en la carpeta que elijas (git clone si hay git; si no, el ZIP de GitHub). Si ya está, lo
#      actualiza.
#   3. Comprueba Node.js (18 o superior) y, si falta, ofrece instalarlo con winget.
#   4. Configura cada programa encontrado: servidor MCP en Claude Desktop, Claude Code y Codex (los que tengas), carpeta de
#      scripts de Siril, lanzadores de SASpro y la variable PIXINSIGHT_EXE si PixInsight no está en su sitio habitual.
#   5. Guía para instalar la IA: Claude (Desktop y Code), Codex, local con Ollama (según la memoria de la gráfica) o Gemini.
#   6. Crea guia/perfil.md a partir de guia/perfil-ejemplo.md si no existe.
# Antes de tocar un fichero de configuración guarda una copia con la extensión .antes-astropilot.
#
# Uso (doble clic en Instalar.cmd, o en PowerShell):
#   powershell -ExecutionPolicy Bypass -File instalar.ps1 [-Carpeta <ruta>] [-Simular] [-SinPreguntas] [-SinConfigurar] [-SinGit]
#   -Simular        no cambia nada: dice lo que haría.
#   -SinPreguntas   acepta las opciones por defecto.
#   -SinConfigurar  solo descarga o actualiza el repositorio.
#   -SinGit         descarga el ZIP aunque haya git.
#   -IA "1,3"       IA que instalar sin preguntar (1 Claude, 2 Codex, 3 local con Ollama, 4 Gemini); con -SinPreguntas.

[CmdletBinding()]
param(
  [string]$Carpeta = "",
  [switch]$Simular,
  [switch]$SinPreguntas,
  [switch]$SinConfigurar,
  [switch]$SinGit,
  [string]$IA = ""
)

$ErrorActionPreference = "Stop"
$REPO_URL = "https://github.com/Az0te/astro-agente-repo"
$ZIP_URL  = "$REPO_URL/archive/refs/heads/main.zip"
$SUFIJO   = ".antes-astropilot"
$script:avisos = New-Object System.Collections.Generic.List[string]
$script:hecho  = New-Object System.Collections.Generic.List[string]

function Titulo($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "  [ok] $t" -ForegroundColor Green; $script:hecho.Add($t) }
function Info($t)   { Write-Host "  $t" }
function Aviso($t)  { Write-Host "  [!] $t" -ForegroundColor Yellow; $script:avisos.Add($t) }
function Haria($t)  { Write-Host "  [simulación] $t" -ForegroundColor DarkGray }

function Preguntar($texto, [bool]$porDefecto = $true) {
  if ($SinPreguntas) { return $porDefecto }
  $op = if ($porDefecto) { "S/n" } else { "s/N" }
  $r = Read-Host "  $texto [$op]"
  if ([string]::IsNullOrWhiteSpace($r)) { return $porDefecto }
  return $r.Trim().ToLower().StartsWith("s") -or $r.Trim().ToLower().StartsWith("y")
}

function Barras($p) { return ($p -replace '\\', '/') }

function Copia($f) {
  if ((Test-Path -LiteralPath $f) -and -not (Test-Path -LiteralPath ($f + $SUFIJO))) {
    Copy-Item -LiteralPath $f -Destination ($f + $SUFIJO)
  }
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

# --- 1. Programas ---------------------------------------------------------------------------------------------------

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

Titulo "Programas"
$PI_DEF = "C:\Program Files\PixInsight\bin\PixInsight.exe"
$piExe  = BuscarExe '^PixInsight' @("bin\PixInsight.exe") @($PI_DEF)
$sirilExe = BuscarExe '^Siril' @("bin\siril.exe") @("C:\Program Files\Siril\bin\siril.exe")
$sasExe = BuscarExe 'Seti ?Astro' @("setiastrosuitepro.exe") @("C:\Program Files\SetiAstroSuitePro\setiastrosuitepro.exe")
$sasScripts = Join-Path $env:LOCALAPPDATA "SASpro\scripts"
if (-not $sasExe -and (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA "SASpro"))) { $sasExe = "(sin ejecutable localizado)" }

if ($piExe)    { Ok "PixInsight: $piExe" }    else { Info "PixInsight: no encontrado" }
if ($sirilExe) { Ok "Siril: $sirilExe" }      else { Info "Siril: no encontrado" }
if ($sasExe)   { Ok "Seti Astro Suite Pro: $sasExe" } else { Info "Seti Astro Suite Pro: no encontrado" }
if (-not ($piExe -or $sirilExe -or $sasExe)) {
  Aviso "No encuentro PixInsight, Siril ni SASpro. Se puede descargar el repositorio igualmente, pero no habrá nada que configurar."
}

# --- 2. Carpeta y repositorio ---------------------------------------------------------------------------------------

function EsRepo($c) { return (Test-Path -LiteralPath (Join-Path $c "guia\herramientas\manifiesto.json")) -and (Test-Path -LiteralPath (Join-Path $c "mcp")) }

function ElegirCarpeta {
  if ($Carpeta) { return $Carpeta }
  # Lanzado desde dentro del repo (instalar\instalar.ps1): esa es la carpeta.
  if ($PSScriptRoot) {
    $padre = Split-Path -Parent $PSScriptRoot
    if ($padre -and (EsRepo $padre)) { Info "Uso el repositorio en el que está este instalador: $padre"; return $padre }
  }
  $def = Join-Path $env:USERPROFILE "astro-agente-repo"
  if ($SinPreguntas) { return $def }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $d = New-Object System.Windows.Forms.FolderBrowserDialog
    $d.Description = "Carpeta donde instalar AstroPilot (se creará 'astro-agente-repo' dentro si eliges una carpeta que no esté vacía)"
    $d.SelectedPath = $env:USERPROFILE
    if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      $sel = $d.SelectedPath
      if ((EsRepo $sel) -or -not (Test-Path -LiteralPath $sel) -or -not (Get-ChildItem -LiteralPath $sel -Force | Select-Object -First 1)) { return $sel }
      return (Join-Path $sel "astro-agente-repo")
    }
  } catch { }
  $r = Read-Host "  Carpeta de instalación [$def]"
  if ([string]::IsNullOrWhiteSpace($r)) { return $def }
  return $r.Trim('"', ' ')
}

function DescargarZip($destino) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $tmp = Join-Path $env:TEMP ("astropilot_" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $zip = Join-Path $tmp "repo.zip"
    Info "Descargando $ZIP_URL ..."
    Invoke-WebRequest -Uri $ZIP_URL -OutFile $zip -UseBasicParsing
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $raiz = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
    if (-not $raiz) { throw "El ZIP no tiene la carpeta esperada." }
    if (-not (Test-Path -LiteralPath $destino)) { New-Item -ItemType Directory -Path $destino | Out-Null }
    # Copia encima: sobrescribe los ficheros del repo y deja los tuyos (perfil.md, tmp_*...).
    Copy-Item -Path (Join-Path $raiz.FullName "*") -Destination $destino -Recurse -Force
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Titulo "Repositorio"
$REPO = ElegirCarpeta
$REPO = [System.IO.Path]::GetFullPath($REPO)
Info "Carpeta: $REPO"
$git = if ($SinGit) { $null } else { Comando "git" }

if (EsRepo $REPO) {
  if (Test-Path -LiteralPath (Join-Path $REPO ".git")) {
    if ($git -and (Preguntar "El repositorio ya está. ¿Actualizarlo con git pull?" $true)) {
      if ($Simular) { Haria "git -C `"$REPO`" pull --ff-only" }
      else {
        & $git -C $REPO pull --ff-only
        if ($LASTEXITCODE -ne 0) { Aviso "git pull no pudo actualizar (¿cambios locales?). Sigo con lo que hay." } else { Ok "Repositorio actualizado (git pull)" }
      }
    } else { Info "Uso el repositorio tal como está." }
  } elseif (Preguntar "El repositorio ya está (sin git). ¿Actualizarlo con el ZIP de GitHub?" $false) {
    if ($Simular) { Haria "descargar $ZIP_URL y copiarlo encima de $REPO" } else { DescargarZip $REPO; Ok "Repositorio actualizado (ZIP)" }
  } else { Info "Uso el repositorio tal como está." }
} else {
  if ((Test-Path -LiteralPath $REPO) -and (Get-ChildItem -LiteralPath $REPO -Force | Select-Object -First 1)) {
    throw "La carpeta $REPO existe, no está vacía y no es el repositorio. Elige otra."
  }
  if ($git) {
    if ($Simular) { Haria "git clone $REPO_URL `"$REPO`"" }
    else {
      & $git clone "$REPO_URL.git" $REPO
      if ($LASTEXITCODE -ne 0) { Aviso "git clone falló; pruebo con el ZIP."; DescargarZip $REPO }
      Ok "Repositorio descargado en $REPO"
    }
  } else {
    Info "No hay git: descargo el ZIP (para actualizar más adelante, vuelve a ejecutar este instalador)."
    if ($Simular) { Haria "descargar $ZIP_URL en $REPO" } else { DescargarZip $REPO; Ok "Repositorio descargado en $REPO" }
  }
  if (-not $Simular -and -not (EsRepo $REPO)) { throw "Después de descargar, $REPO no parece el repositorio (falta guia\herramientas\manifiesto.json)." }
}

if ($SinConfigurar) { Titulo "Listo"; Info "Repositorio en $REPO (sin configurar programas: -SinConfigurar)."; return }

# --- 3. Node.js -----------------------------------------------------------------------------------------------------

Titulo "Node.js"
function VersionNode {
  $n = Comando "node"
  if (-not $n) { return 0 }
  try { $v = (& $n -v) -replace '^v', ''; return [int]($v.Split('.')[0]) } catch { return 0 }
}
$nodeMayor = VersionNode
if ($nodeMayor -ge 18) { Ok "Node.js $nodeMayor (vale 18 o superior)" }
else {
  if ($nodeMayor -gt 0) { Aviso "Node.js $nodeMayor es antiguo: los servidores MCP necesitan 18 o superior." }
  $winget = Comando "winget"
  if ($winget -and (Preguntar "Falta Node.js 18+. ¿Instalar Node.js LTS con winget?" $true)) {
    if ($Simular) { Haria "winget install OpenJS.NodeJS.LTS" }
    else {
      & $winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
      RefrescarPath
      $nodeMayor = VersionNode
      if ($nodeMayor -ge 18) { Ok "Node.js $nodeMayor instalado" } else { Aviso "No veo Node.js tras instalarlo: cierra y vuelve a abrir la ventana y repite el instalador." }
    }
  } elseif ($nodeMayor -lt 18) { Aviso "Instala Node.js 18 o superior desde https://nodejs.org y vuelve a ejecutar el instalador." }
}
$node = Comando "node"
$nodeCmd = if ($node) { $node } else { "node" }

# --- 3b. Inteligencia artificial ------------------------------------------------------------------------------------
# Guía para instalar la IA que vaya a usar el asistente: Claude, Codex, local (Ollama) o Gemini. Se puede elegir más de una.

function VramGB {
  $max = 0
  $k = "HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*"
  foreach ($e in (Get-ItemProperty $k -ErrorAction SilentlyContinue)) {
    $b = $e."HardwareInformation.qwMemorySize"
    if ($b) { $g = [math]::Round([double]$b / 1GB); if ($g -gt $max) { $max = $g } }
  }
  return $max
}

function IaClaude {
  Info "Claude (Anthropic): la mejor con la guía. Necesita suscripción Pro/Max o clave de API de pago."
  $desk = (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA "AnthropicClaude")) -or (Test-Path -LiteralPath (Join-Path $env:APPDATA "Claude"))
  $code = (Comando "claude") -or (Test-Path -LiteralPath (Join-Path $env:USERPROFILE ".local\bin\claude.exe"))
  if ($desk) { Ok "Claude Desktop ya está instalado" }
  elseif (Preguntar "¿Instalar Claude Desktop (la app, para usar el MCP desde ella)?" $true) {
    $w = Comando "winget"
    if ($Simular) { Haria "winget install Anthropic.Claude" }
    elseif ($w) { & $w install --id Anthropic.Claude -e --accept-source-agreements --accept-package-agreements; Ok "Claude Desktop instalado: ábrelo e inicia sesión." }
    else { Aviso "Descarga Claude Desktop de https://claude.ai/download"; Start-Process "https://claude.ai/download" }
  }
  if ($code) { Ok "Claude Code ya está instalado" }
  elseif (Preguntar "¿Instalar Claude Code (lo usan el Lite, el módulo y los chats de Siril y SASpro)?" $true) {
    if ($Simular) { Haria "irm https://claude.ai/install.ps1 | iex" }
    else {
      Invoke-RestMethod "https://claude.ai/install.ps1" | Invoke-Expression
      RefrescarPath
      $env:Path += ";" + (Join-Path $env:USERPROFILE ".local\bin")
      Ok "Claude Code instalado."
    }
    $script:avisos.Add("Claude Code: abre una terminal, escribe claude e inicia sesión una vez.")
  }
}

function IaCodex {
  Info "Codex (OpenAI): buena con la guía. Necesita suscripción de ChatGPT o clave de API."
  if (Comando "codex") { Ok "Codex ya está instalado" }
  else {
    $npm = Comando "npm"
    if (-not $npm) { Aviso "Codex necesita Node.js (npm). Instala Node.js y repite."; return }
    if (Preguntar "¿Instalar Codex (npm install -g @openai/codex)?" $true) {
      if ($Simular) { Haria "npm install -g @openai/codex" }
      else { & $npm install -g "@openai/codex"; RefrescarPath; Ok "Codex instalado." }
    } else { return }
  }
  $dir = Join-Path $env:USERPROFILE ".codex"
  if (-not $Simular -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $codex = Comando "codex"
  if ($codex -and -not $Simular -and (Preguntar "¿Iniciar sesión en Codex ahora (abre el navegador)?" $true)) { & $codex login }
  else { $script:avisos.Add("Codex: en una terminal, codex login (una vez).") }
}

function IaLocal {
  $vram = VramGB
  Info "IA local con Ollama: gratis y sin enviar nada fuera del PC. Pide una gráfica con mucha memoria."
  if ($vram -gt 0) { Info "Tu gráfica tiene unos $vram GB." }
  $modelo = if ($vram -ge 20) { "qwen3:32b" } elseif ($vram -ge 12) { "qwen3:14b" } else { "qwen3:8b" }
  if ($vram -lt 20) { Aviso "Con menos de 20 GB de gráfica los modelos locales van justos con la guía: $modelo servirá para probar, pero elegirá peor que Claude o uno de 32B." }
  $ollama = Comando "ollama"
  if (-not $ollama) { $p = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"; if (Test-Path -LiteralPath $p) { $ollama = $p } }
  if ($ollama) { Ok "Ollama ya está instalado" }
  elseif (Preguntar "¿Instalar Ollama?" $true) {
    $w = Comando "winget"
    if ($Simular) { Haria "winget install Ollama.Ollama" }
    elseif ($w) {
      & $w install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements
      RefrescarPath
      $ollama = Comando "ollama"
      if (-not $ollama) { $p = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"; if (Test-Path -LiteralPath $p) { $ollama = $p } }
      Ok "Ollama instalado."
    } else { Aviso "Descarga Ollama de https://ollama.com/download"; Start-Process "https://ollama.com/download"; return }
  } else { return }
  if (Preguntar "¿Descargar ahora el modelo $modelo (varios GB)?" $true) {
    if ($Simular -or -not $ollama) { Haria "ollama pull $modelo" }
    else { & $ollama pull $modelo; if ($LASTEXITCODE -eq 0) { Ok "Modelo $modelo descargado" } else { Aviso "No se pudo descargar ${modelo}: abre Ollama y repite ollama pull $modelo" } }
  } else { $script:avisos.Add("IA local: ollama pull $modelo cuando quieras.") }
  $script:avisos.Add("IA local: en el Lite elige el proveedor Ollama; en los chats de Siril y SASpro tus modelos salen solos.")
}

function IaGemini {
  Info "Gemini (Google): gratis con una clave, pero MENOS fiable con la guía. Sirve para probar; revisa cada paso."
  Info "En el nivel gratis Google puede usar lo que se envía (medidas y miniaturas) para mejorar sus modelos."
  if ([Environment]::GetEnvironmentVariable("GEMINI_API_KEY", "User")) { Ok "Ya tienes la clave GEMINI_API_KEY guardada"; return }
  if (-not (Preguntar "¿Abrir la página para sacar la clave gratis y guardarla aquí?" $true)) { return }
  if ($Simular) { Haria "abrir https://aistudio.google.com/apikey y guardar GEMINI_API_KEY"; return }
  Start-Process "https://aistudio.google.com/apikey"
  $seg = Read-Host "  Pega la clave (no se ve al escribir; Intro vacío para saltar)" -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg)
  try { $clave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
  if ([string]::IsNullOrWhiteSpace($clave)) { Info "Sin clave: se puede poner luego en el chat (botón Clave...)."; return }
  [Environment]::SetEnvironmentVariable("GEMINI_API_KEY", $clave.Trim(), "User")
  $clave = $null
  Ok "Clave de Gemini guardada en tu usuario (GEMINI_API_KEY). No la compartas."
}

Titulo "Inteligencia artificial"
Info "¿Qué IA vas a usar? Puedes elegir varias, separadas por comas:"
Info "  1 = Claude (la mejor, de pago)   2 = Codex (OpenAI, de pago)"
Info "  3 = Local con Ollama (gratis, necesita gráfica potente)   4 = Gemini (gratis con clave, menos fiable)"
Info "  0 o Intro = ninguna ahora"
$eleccion = if ($SinPreguntas) { $IA } else { Read-Host "  Elección" }
foreach ($o in (("" + $eleccion) -split '[,; ]+' | Where-Object { $_ })) {
  switch ($o.Trim()) {
    "1" { Write-Host ""; IaClaude }
    "2" { Write-Host ""; IaCodex }
    "3" { Write-Host ""; IaLocal }
    "4" { Write-Host ""; IaGemini }
    "0" { }
    default { Aviso "Opción desconocida: $o" }
  }
}

# --- 4. Servidores MCP ----------------------------------------------------------------------------------------------

$servidores = [ordered]@{}
if ($piExe)    { $servidores["piastropilot"]    = Join-Path $REPO "mcp\dist\piastropilot-mcp.mjs" }
if ($sirilExe) { $servidores["sirilastropilot"] = Join-Path $REPO "siril\mcp\dist\sirilastropilot-mcp.mjs" }
if ($sasExe)   { $servidores["setiastropilot"]  = Join-Path $REPO "sas\mcp\dist\setiastropilot-mcp.mjs" }

function PonerVariable($nombre, $valor) {
  $actual = [Environment]::GetEnvironmentVariable($nombre, "User")
  if ($actual -eq $valor) { Info "$nombre ya vale $valor"; return }
  if ($Simular) { Haria "variable de usuario $nombre = $valor"; return }
  [Environment]::SetEnvironmentVariable($nombre, $valor, "User")
  Ok "Variable de usuario $nombre = $valor"
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

function ConfigurarClaudeDesktop {
  $dir = Join-Path $env:APPDATA "Claude"
  if (-not (Test-Path -LiteralPath $dir)) { Info "Claude Desktop: no está instalado (no hay $dir)."; return }
  if (-not $node) { Aviso "Claude Desktop: sin Node.js no puedo editar su configuración."; return }
  $cfg = Join-Path $dir "claude_desktop_config.json"
  $srv = [ordered]@{}
  foreach ($k in $servidores.Keys) { $srv[$k] = @{ command = "node"; args = @((Barras $servidores[$k])) } }
  $js = Join-Path $env:TEMP "astropilot_desktop.js"
  EscribirUtf8SinBom $js $JS_DESKTOP
  if (-not $Simular) { Copia $cfg }
  $env:AP_CFG = $cfg; $env:AP_SRV = ($srv | ConvertTo-Json -Depth 5 -Compress); $env:AP_SIMULAR = $(if ($Simular) { "1" } else { "0" })
  $salida = & $node $js 2>&1
  $codigo = $LASTEXITCODE
  Remove-Item -LiteralPath $js -ErrorAction SilentlyContinue
  if ($codigo -ne 0) { Aviso "Claude Desktop: $cfg no es un JSON válido y no sé repararlo; no lo toco. Añade los servidores a mano (mcp\README.md)."; return }
  foreach ($l in $salida) {
    $l = "$l"
    if ($l -eq "REPARADO" -and $Simular) { Haria "Claude Desktop: su configuración está rota (JSON incompleto); la repararía (con copia en $cfg$SUFIJO)." }
    elseif ($l -eq "REPARADO") { Aviso "Claude Desktop: su configuración estaba rota (JSON incompleto); la he reparado (copia en $cfg$SUFIJO)." }
    elseif ($l.StartsWith("QUITADO ")) { if ($Simular) { Haria "Claude Desktop: quitar el servidor viejo $($l.Substring(8)) (su fichero ya no existe)" } else { Ok "Claude Desktop: quitado el servidor viejo $($l.Substring(8)) (su fichero ya no existe)" } }
    elseif ($l.StartsWith("PUESTO ")) { if ($Simular) { Haria "Claude Desktop: servidor $($l.Substring(7))" } else { Ok "Claude Desktop: servidor $($l.Substring(7))" } }
    elseif ($l.StartsWith("IGUAL ")) { Info "Claude Desktop: $($l.Substring(6)) ya estaba bien" }
  }
  if (-not $Simular -and (Get-Process -Name "claude" -ErrorAction SilentlyContinue)) {
    Aviso "Claude Desktop está abierto: ciérralo del todo (también en la bandeja) y vuelve a abrirlo para que vea los servidores."
  }
}

function ConfigurarClaudeCode {
  $claude = Comando "claude"
  if (-not $claude) {
    $p = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
    if (Test-Path -LiteralPath $p) { $claude = $p }
  }
  if (-not $claude) { Info "Claude Code: no está instalado."; return }
  foreach ($k in $servidores.Keys) {
    $ruta = Barras $servidores[$k]
    if ($Simular) { Haria "claude mcp add --scope user $k -- node $ruta"; continue }
    $ErrorActionPreference = "Continue"
    & $claude mcp remove --scope user $k 2>&1 | Out-Null
    & $claude mcp add --scope user $k -- node $ruta 2>&1 | Out-Null
    $codigo = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($codigo -eq 0) { Ok "Claude Code: servidor $k (ámbito usuario)" } else { Aviso "Claude Code: no pude registrar $k. A mano: claude mcp add --scope user $k -- node $ruta" }
  }
}

function ConfigurarCodex {
  $dir = Join-Path $env:USERPROFILE ".codex"
  if (-not (Test-Path -LiteralPath $dir)) { Info "Codex: no está instalado (no hay $dir)."; return }
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
  if ($Simular) { Haria "Codex: servidores $($servidores.Keys -join ', ') en $f"; return }
  Copia $f
  EscribirUtf8SinBom $f (($nuevas -join "`r`n") + "`r`n")
  Ok "Codex: servidores $($servidores.Keys -join ', ') en config.toml"
}

if ($servidores.Count) {
  Titulo "Servidores MCP"
  foreach ($k in $servidores.Keys) { if (-not (Test-Path -LiteralPath $servidores[$k]) -and -not $Simular) { Aviso "Falta $($servidores[$k])" } }
  ConfigurarClaudeDesktop
  ConfigurarClaudeCode
  ConfigurarCodex
}

# --- 5. Cada programa -----------------------------------------------------------------------------------------------

if ($piExe) {
  Titulo "PixInsight"
  if ($piExe -ne $PI_DEF) { PonerVariable "PIXINSIGHT_EXE" (Barras $piExe) } else { Info "PixInsight en su ruta habitual: no hace falta PIXINSIGHT_EXE." }
  Info "PiAstroPilot Lite (opcional, sin MCP): en PixInsight, Script > Feature Scripts... > Add, elige"
  Info "   $(Join-Path $REPO 'piastropilot\script') y pulsa Done. Queda en Script > PiAstroPilot > PiAstroPilotLite."
  $script:avisos.Add("PixInsight: para el Lite, Script > Feature Scripts... > Add > $(Join-Path $REPO 'piastropilot\script') (no se puede hacer desde fuera de PixInsight).")
}

function ConfigurarSiril {
  $dir = Join-Path $env:LOCALAPPDATA "siril"
  $ini = Get-ChildItem -LiteralPath $dir -Filter "config.*.ini" -ErrorAction SilentlyContinue |
         Sort-Object { try { [version]($_.Name -replace '^config\.', '' -replace '\.ini$', '') } catch { [version]"0.0" } } -Descending |
         Select-Object -First 1
  $puente = Join-Path $REPO "siril\puente"
  if (-not $ini) {
    Aviso "Siril: no encuentro su configuración (¿no se ha abierto nunca?). Ábrelo una vez y repite, o en Preferencias > Scripts añade $puente."
    return
  }
  if (Get-Process -Name "siril" -ErrorAction SilentlyContinue) {
    Aviso "Siril está abierto y guarda su configuración al cerrarse (borraría el cambio). Ciérralo y repite el instalador, o añade a mano $puente en Preferencias > Scripts."
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
      if ($ya) { Info "Siril: $puente ya está en las carpetas de scripts."; return }
      # Quitar otras copias del puente de AstroPilot que ya no existan (repo movido).
      $lista = @($lista | Where-Object { $p = ($_ -replace '\\\\', '\'); -not ($p -match 'siril\\puente\\?$' -and -not (Test-Path -LiteralPath $p)) })
      $lineas[$i] = "script_path=" + (($lista + $iniEsc) -join ';') + ";"
      $hecho = $true; break
    }
  }
  if (-not $hecho) {
    if ($idxGui -lt 0) { $lineas.Add("[gui]"); $idxGui = $lineas.Count - 1 }
    $lineas.Insert($idxGui + 1, "script_path=$iniEsc;")
  }
  if ($Simular) { Haria "Siril: añadir $puente a script_path de $($ini.FullName)"; return }
  Copia $ini.FullName
  EscribirUtf8SinBom $ini.FullName ($lineas -join $nl)
  Ok "Siril: $puente añadido a las carpetas de scripts ($($ini.Name)). En Siril, Scripts debe mostrar SirilAstroPilot."
}
if ($sirilExe) { Titulo "Siril"; ConfigurarSiril }

function ConfigurarSas {
  PonerVariable "SETIASTROPILOT_REPO" $REPO
  foreach ($n in @("SetiAstroPilot.py", "SetiAstroPilot_Chat.py")) {
    $origen = Join-Path $REPO "sas\puente\$n"
    $destino = Join-Path $sasScripts $n
    if ($Simular) { Haria "SASpro: copiar $n a $sasScripts"; continue }
    if (-not (Test-Path -LiteralPath $sasScripts)) { New-Item -ItemType Directory -Path $sasScripts -Force | Out-Null }
    if ((Test-Path -LiteralPath $destino) -and ((Get-FileHash -LiteralPath $destino).Hash -eq (Get-FileHash -LiteralPath $origen).Hash)) { Info "SASpro: $n ya está al día."; continue }
    Copia $destino
    Copy-Item -LiteralPath $origen -Destination $destino -Force
    Ok "SASpro: $n copiado a $sasScripts"
  }
  Info "En SASpro, Scripts > Reload Scripts: aparece AstroPilot > SetiAstroPilot."
}
if ($sasExe) { Titulo "Seti Astro Suite Pro"; ConfigurarSas }

# --- 6. Perfil ------------------------------------------------------------------------------------------------------

$perfil = Join-Path $REPO "guia\perfil.md"
$ejemplo = Join-Path $REPO "guia\perfil-ejemplo.md"
if (-not (Test-Path -LiteralPath $perfil) -and (Test-Path -LiteralPath $ejemplo)) {
  Titulo "Perfil"
  if ($Simular) { Haria "crear guia\perfil.md desde perfil-ejemplo.md" }
  else { Copy-Item -LiteralPath $ejemplo -Destination $perfil; Ok "Creado guia\perfil.md: rellénalo con tu equipo, tu cielo y tus rutas." }
}

# --- Resumen --------------------------------------------------------------------------------------------------------

Titulo "Resumen"
Info "Repositorio: $REPO"
if ($Simular) { Info "Simulación: no se ha cambiado nada." }
foreach ($a in $script:avisos) { Write-Host "  - $a" -ForegroundColor Yellow }
Info "Para actualizar más adelante, vuelve a ejecutar este instalador."
Info "Las copias de los ficheros de configuración tocados terminan en $SUFIJO."
