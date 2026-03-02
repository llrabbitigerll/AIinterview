param(
    [switch]$ForceCommit
)

Write-Host "Running remove_secrets.ps1"

$repo = Resolve-Path "."
$envPath = Join-Path $repo ".env"
$exampleRoot = Join-Path $repo ".env.example"
$serverExample = Join-Path $repo "server\.env.example"
$gitignore = Join-Path $repo ".gitignore"

if (-Not (Test-Path $exampleRoot)) {
    if (Test-Path $serverExample) {
        Copy-Item -Path $serverExample -Destination $exampleRoot
        Write-Host "Created ./ .env.example by copying server/.env.example"
    } else {
        "# Example environment variables - fill with your values" | Out-File -FilePath $exampleRoot -Encoding UTF8
        "# e.g. OPENAI_API_KEY=YOUR_KEY" | Out-File -FilePath $exampleRoot -Encoding UTF8 -Append
        Write-Host "Created minimal .env.example"
    }
} else {
    Write-Host ".env.example already exists at repository root, not overwriting."
}

if (Test-Path $gitignore) { $gi = Get-Content $gitignore -Raw } else { $gi = "" }
if ($gi -notmatch "(^|\n)\.env(\r?$|\n)") {
    Add-Content $gitignore "`n# local env`n.env"
    Write-Host "Added .env to .gitignore"
} else {
    Write-Host ".env already present in .gitignore"
}

try {
    git ls-files --error-unmatch .env > $null 2>&1
    if ($LASTEXITCODE -eq 0) {
        git rm --cached .env
        if ($ForceCommit) {
            git add .gitignore
            git commit -m "Remove .env from repo and add to .gitignore"
            Write-Host "Removed .env from index and committed changes"
        } else {
            Write-Host ".env was tracked. Run this script with -ForceCommit to auto-commit the removal."
        }
    } else {
        Write-Host ".env not tracked by git"
    }
} catch {
    Write-Host "git not available or other error: $_"
}

if (Test-Path $envPath) {
    Remove-Item $envPath -Force
    Write-Host "Deleted local .env"
} else {
    Write-Host "No local .env file to delete"
}
