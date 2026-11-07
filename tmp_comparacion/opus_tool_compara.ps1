# Planchas v5 frente a v2 (ambas giradas 180°). v5 = v2 + (64, 64) en coordenadas giradas.
Add-Type -AssemblyName System.Drawing
$v5 = [System.Drawing.Image]::FromFile("C:\Users\sieso\Downloads\M31_v5_rot180.jpg")
$v2 = [System.Drawing.Image]::FromFile("D:\Astronomia\Master\master\M31\M31_v2\final\M31_v2_rot180.jpg")
$dir = "D:\Astronomia\Master\master\M31\M31_v2\prev"
$font = New-Object System.Drawing.Font("Arial", 18, [System.Drawing.FontStyle]::Bold)

function Pair($name, $x, $y, $w, $h, $scale) {
  $W = [int]($w * $scale); $H = [int]($h * $scale)
  $out = New-Object System.Drawing.Bitmap((2 * $W + 10), $H)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.Clear([System.Drawing.Color]::Black)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($v5, (New-Object System.Drawing.Rectangle(0, 0, $W, $H)), (New-Object System.Drawing.Rectangle(($x + 64), ($y + 64), $w, $h)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawImage($v2, (New-Object System.Drawing.Rectangle(($W + 10), 0, $W, $H)), (New-Object System.Drawing.Rectangle($x, $y, $w, $h)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString("v5", $font, [System.Drawing.Brushes]::Yellow, 8, 6)
  $g.DrawString("v2", $font, [System.Drawing.Brushes]::Yellow, ($W + 18), 6)
  $p = "$dir\cmp_$name.jpg"
  $out.Save($p, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $g.Dispose(); $out.Dispose()
  $p
}

Pair "completa" 0 0 6056 3968 0.165
Pair "nucleo" 2814 1731 600 600 1.0
Pair "ngc206" 1289 1127 600 600 1.0
Pair "polvo" 3000 2300 900 600 0.667
Pair "brazo_ext" 300 1700 900 600 0.667
$v5.Dispose(); $v2.Dispose()
