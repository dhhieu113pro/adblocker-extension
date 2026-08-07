Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\hieu.dam\.gemini\antigravity\brain\cf9b5418-fd4f-49aa-a232-2fbd500352a4\adblocker_logo_1786063635415.jpg"
$img = [System.Drawing.Image]::FromFile($srcPath)

$sizes = @(16, 32, 64, 128)
foreach ($sz in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $sz, $sz
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($img, 0, 0, $sz, $sz)
    
    $destPath = "D:\Development\adblocker-extension\src\icon-$sz.png"
    $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Created icon-$sz.png"
}

$img.Dispose()
