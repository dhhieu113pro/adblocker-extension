# Creates GitHub repo dhhieu113pro/adblocker-extension (private) and pushes
# Run: .\push.ps1
$ErrorActionPreference = "Stop"

$repo = "dhhieu113pro/adblocker-extension"
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $dir

# Init git if needed
if (-not (Test-Path ".git")) {
    git init
    git branch -M main
}

# Create .gitignore if missing
if (-not (Test-Path ".gitignore")) {
    @"
node_modules/
dist/
wasm/target/
frontend/src/pkg/
*.log
.DS_Store
"@ | Set-Content .gitignore -Encoding UTF8
}

# Use the dhhieu113pro account (owner of $repo)
gh auth switch --user dhhieu113pro

# Stage & commit
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    $msg = if (git log --oneline -1 2>$null) { "Update" } else { "Initial commit: adblocker-extension" }
    git commit -m $msg
}

# Create repo if not exists, then push
$remoteUrl = git remote get-url origin 2>$null
if (-not $remoteUrl) {
    gh repo create $repo --private --source=. --remote=origin --push
} else {
    $branch = git rev-parse --abbrev-ref HEAD
    git push origin $branch
}

Pop-Location
Write-Host "Done: https://github.com/$repo"
