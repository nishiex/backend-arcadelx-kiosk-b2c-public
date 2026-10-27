$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $repoRoot 'apps\web\next-monorepo'
$scope = 'nishiexs-projects'

Write-Host 'Deploying API to Vercel...' -ForegroundColor Cyan
Push-Location $repoRoot
try {
  npx vercel deploy --prod --yes --scope $scope
  if ($LASTEXITCODE -ne 0) { throw "API deployment failed with exit code $LASTEXITCODE" }
}
finally {
  Pop-Location
}

Write-Host 'Deploying frontend to Vercel...' -ForegroundColor Cyan
Push-Location $webRoot
try {
  npx vercel deploy --prod --yes --scope $scope
  if ($LASTEXITCODE -ne 0) { throw "Frontend deployment failed with exit code $LASTEXITCODE" }
}
finally {
  Pop-Location
}

Write-Host 'API and frontend deployments completed.' -ForegroundColor Green
