$ErrorActionPreference = "Stop"

$Repository = "reggie-db/vscode-mods"
$TemporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("vscode-mods-" + [guid]::NewGuid())

try {
    $Architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    switch ($Architecture) {
        "X64" { $Asset = "vscode-mods-windows-x64.zip" }
        "Arm64" { $Asset = "vscode-mods-windows-arm64.zip" }
        default { throw "unsupported Windows architecture: $Architecture" }
    }

    New-Item -ItemType Directory -Path $TemporaryDirectory -Force | Out-Null
    $ReleaseBase = "https://github.com/$Repository/releases/latest/download"
    $Archive = Join-Path $TemporaryDirectory $Asset
    $Checksums = Join-Path $TemporaryDirectory "checksums.txt"
    Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseBase/$Asset" -OutFile $Archive
    Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseBase/checksums.txt" -OutFile $Checksums

    $ExpectedLine = Get-Content $Checksums | Where-Object { $_ -match "\s$([regex]::Escape($Asset))$" } | Select-Object -First 1
    if (-not $ExpectedLine) { throw "$Asset is missing from checksums.txt" }
    $Expected = ($ExpectedLine -split "\s+")[0].ToLowerInvariant()
    $Actual = (Get-FileHash -Algorithm SHA256 $Archive).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected) { throw "checksum verification failed for $Asset" }

    $Payload = Join-Path $TemporaryDirectory "payload"
    Expand-Archive -Path $Archive -DestinationPath $Payload -Force

    $InstallRoot = if ($env:VSCODE_MODS_HOME) {
        $env:VSCODE_MODS_HOME
    } else {
        Join-Path $env:LOCALAPPDATA "Programs\vscode-mods"
    }
    $PreviousRoot = "$InstallRoot.previous"
    if (Test-Path $PreviousRoot) { Remove-Item -Recurse -Force $PreviousRoot }
    if (Test-Path $InstallRoot) { Move-Item $InstallRoot $PreviousRoot }
    try {
        Move-Item $Payload $InstallRoot
    } catch {
        if (Test-Path $PreviousRoot) { Move-Item $PreviousRoot $InstallRoot }
        throw
    }
    if (Test-Path $PreviousRoot) { Remove-Item -Recurse -Force $PreviousRoot }

    $Executable = Join-Path $InstallRoot "bin\vscode-mods.exe"
    Write-Host "[vscode-mods] installed in $InstallRoot"
    & $Executable apply
    Write-Host "[vscode-mods] reload the VS Code window to display the changes"
    Write-Host "[vscode-mods] command: $Executable"
} catch {
    Write-Error "[vscode-mods] install failed: $($_.Exception.Message)"
    exit 1
} finally {
    if (Test-Path $TemporaryDirectory) {
        Remove-Item -Recurse -Force $TemporaryDirectory -ErrorAction SilentlyContinue
    }
}

