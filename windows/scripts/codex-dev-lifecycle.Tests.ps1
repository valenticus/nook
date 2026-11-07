$scriptUnderTest = Join-Path $PSScriptRoot 'codex-dev-lifecycle.ps1'
. $scriptUnderTest

function New-TestNookCodexProfileRoot {
  param([string]$Path, [string]$OwnerSid, [string]$MarkerSid = $OwnerSid, [string]$MarkerVersion = 'v2')
  $security = New-NookCodexDirectorySecurity $OwnerSid
  [void][IO.Directory]::CreateDirectory($Path, $security)
  Set-Content -LiteralPath (Join-Path $Path '.nook-codex-dev-owned') -Value ("nook-codex-dev-$MarkerVersion`n$MarkerSid") -Encoding ASCII
}

Describe 'Codex Dev lifecycle isolation' {
  It 'does not assign PowerShell automatic read-only variables in launcher scripts' {
    $reservedAssignment = '(?i)\$(?:HOME|PID|HOST|PSHOME)\s*='
    ('$' + 'home = "codex-home"') | Should Match $reservedAssignment
    '$scratchCodexHome = "codex-home"' | Should Not Match $reservedAssignment
    $scripts = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1' -File -Recurse)
    $findings = @($scripts | Select-String -Pattern $reservedAssignment)
    $findings.Count | Should Be 0
  }

  It 'requires the exact current SID in the Dev pipe name' {
    (Test-NookCodexPipeName '\\.\pipe\nook-dev-S-1-5-21-a' 'S-1-5-21-a') | Should Be $true
    (Test-NookCodexPipeName '\\.\pipe\nook-S-1-5-21-a' 'S-1-5-21-a') | Should Be $false
    (Test-NookCodexPipeName '\\.\pipe\nook-dev-S-1-5-21-b' 'S-1-5-21-a') | Should Be $false
  }

  It 'accepts only the Dev process path owned by the same SID' {
    (Test-NookCodexProcessIdentity 'C:\Dev\nook-dev.exe' 'C:\Dev\nook-dev.exe' 'S-1-5-21-a' 'S-1-5-21-a') | Should Be $true
    (Test-NookCodexProcessIdentity 'C:\Nook\nook.exe' 'C:\Dev\nook-dev.exe' 'S-1-5-21-a' 'S-1-5-21-a') | Should Be $false
    (Test-NookCodexProcessIdentity 'C:\Dev\nook-dev.exe' 'C:\Dev\nook-dev.exe' 'S-1-5-21-b' 'S-1-5-21-a') | Should Be $false
  }

  It 'compares Dev relay SHA-256 against the Dev build artifact' {
    $relay = Join-Path $TestDrive 'nook-hook-dev.exe'
    $built = Join-Path $TestDrive 'built-nook-hook-dev.exe'
    [IO.File]::WriteAllText($relay, 'same dev relay')
    [IO.File]::WriteAllText($built, 'same dev relay')
    (Test-NookCodexRelayPair $relay $built) | Should Be $true
    [IO.File]::WriteAllText($built, 'different')
    (Test-NookCodexRelayPair $relay $built) | Should Be $false
  }

  It 'creates exactly SessionStart and SessionEnd hooks using the quoted absolute Dev relay' {
    $relay = Join-Path $TestDrive 'with space\nook-hook-dev.exe'
    $doc = Get-NookCodexHooksDocument $relay
    $json = $doc | ConvertTo-Json -Depth 20
    (Test-NookCodexHooksDocument $json $relay) | Should Be $true
    $doc.hooks.SessionStart[0].hooks[0].command | Should Be ('"' + $relay + '" --agent codex')
    $doc.hooks.SessionEnd[0].hooks[0].command | Should Be ('"' + $relay + '" --agent codex')
    $doc.hooks.SessionStart[0].hooks[0].timeout | Should Be 10
    $doc.hooks.SessionEnd[0].hooks[0].timeout | Should Be 3
    $path = Join-Path $TestDrive 'hooks.json'
    Write-NookCodexHooksDocument $path $relay
    $bytes = [IO.File]::ReadAllBytes($path)
    ([BitConverter]::ToString($bytes[0..2])) | Should Not Be 'EF-BB-BF'
    (Test-NookCodexHooksDocument ([IO.File]::ReadAllText($path)) $relay) | Should Be $true
  }

  It 'stores any separately authorized credentials only in isolated CODEX_HOME files' {
    (Test-NookCodexConfigText (Get-NookCodexConfigText)) | Should Be $true
    (Test-NookCodexConfigText 'cli_auth_credentials_store = "keyring"') | Should Be $false
    $environment = @{ OPENAI_API_KEY = 'not-printed' }
    @(Get-NookCodexInheritedAuthOverrides $environment) | Should Be @('OPENAI_API_KEY')
  }

  It 'rejects production relays, additional events, and extra commands' {
    $relay = Join-Path $TestDrive 'nook-hook-dev.exe'
    $doc = Get-NookCodexHooksDocument $relay
    (Test-NookCodexHooksDocument ($doc | ConvertTo-Json -Depth 20) $relay) | Should Be $true
    $doc.hooks.Stop = @(@{ hooks = @(@{ type = 'command'; command = 'anything' }) })
    (Test-NookCodexHooksDocument ($doc | ConvertTo-Json -Depth 20) $relay) | Should Be $false
    $production = $doc | ConvertTo-Json -Depth 20
    (Test-NookCodexHooksDocument $production 'C:\Nook\nook-hook.exe') | Should Be $false
  }

  It 'blocks system managed hooks and unreadable managed policy sources' {
    $root = Join-Path $TestDrive 'program-data'
    $policyDir = Join-Path $root 'OpenAI\Codex'
    [void][IO.Directory]::CreateDirectory($policyDir)
    [IO.File]::WriteAllText((Join-Path $policyDir 'requirements.toml'), "[hooks]`n")
    $findings = @(Get-NookCodexManagedHookFindings $root)
    $findings.Count | Should Be 1
    (Get-NookCodexManagedHookBlockReason $findings) | Should Match 'managed Codex policy'
  }

  It 'fails closed when cloud managed hooks cannot be read without starting a Codex session' {
    (Get-NookCodexCloudManagedHookBlockReason 'Unknown') | Should Match 'no supported non-session command'
    (Get-NookCodexCloudManagedHookBlockReason 'VerifiedAbsent') | Should Be $null
    $scriptUnderTestContent = Get-Content -LiteralPath $scriptUnderTest -Raw
    $scriptUnderTestContent | Should Match "Get-NookCodexCloudManagedHookBlockReason 'Unknown'"
  }

  It 'accepts only the verified npm CLI wrapper and never the VS Code binary' {
    $root = Join-Path $TestDrive 'npm'
    $nodeModules = Join-Path $root 'node_modules\@openai\codex\bin'
    [void][IO.Directory]::CreateDirectory($nodeModules)
    $wrapper = Join-Path $root 'codex.cmd'
    [IO.File]::WriteAllText($wrapper, '"%dp0%\node_modules\@openai\codex\bin\codex.js" %*')
    (Test-NookCodexCliPath $wrapper $root) | Should Be $true
    (Test-NookCodexCliPath (Join-Path $TestDrive 'vscode\codex.exe') $root) | Should Be $false
  }

  It 'builds CODEX_HOME and workspace under an SID-specific path outside the repository' {
    $paths = Get-NookCodexScratchPaths $TestDrive 'S-1-5-21-test'
    $paths.Home | Should Match 'codex-home$'
    $paths.Workspace | Should Match 'workspace$'
    $paths.Root | Should Not Match ([regex]::Escape((Join-Path $PSScriptRoot '..\..')))
  }

  It 'claims a new scratch root before populating it and reuses it on repeated Prepare' {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $scratchParent = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
    $paths = Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForPrepare
    $paths.Parent | Should Be ([IO.Path]::GetFullPath($scratchParent))
    $security = New-NookCodexDirectorySecurity $sid
    [void][IO.Directory]::CreateDirectory($paths.Root, $security)
    Initialize-NookCodexOwnershipMarker $paths.Root $sid -RootWasCreated
    (Test-Path -LiteralPath $paths.Marker -PathType Leaf) | Should Be $true
    $relay = Join-Path $TestDrive 'nook-hook-dev.exe'
    $first = Initialize-NookCodexScratchContents $paths.Root $relay $sid
    $before = (Get-Item -LiteralPath $first.HooksPath).LastWriteTimeUtc
    $second = Initialize-NookCodexScratchContents $paths.Root $relay $sid
    $second.Root | Should Be $first.Root
    (Get-Item -LiteralPath $second.HooksPath).LastWriteTimeUtc | Should Be $before
    (Test-NookCodexHooksDocument (Get-Content -LiteralPath $second.HooksPath -Raw) $relay) | Should Be $true
    (Test-Path -LiteralPath (Join-Path $second.Home 'auth.json')) | Should Be $false
    (Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForPrepare).Root | Should Be $paths.Root
    (Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForLaunch).Root | Should Be $paths.Root
  }

  It 'resumes a marked partial scratch profile without replacing existing files' {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $scratchParent = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
    $paths = Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForPrepare
    New-TestNookCodexProfileRoot $paths.Root $sid
    [void][IO.Directory]::CreateDirectory($paths.Home)
    $relay = Join-Path $TestDrive 'nook-hook-dev.exe'
    $state = Initialize-NookCodexScratchContents $paths.Root $relay $sid
    (Test-Path -LiteralPath $state.Workspace -PathType Container) | Should Be $true
    (Test-NookCodexHooksDocument (Get-Content -LiteralPath $state.HooksPath -Raw) $relay) | Should Be $true
    (Test-NookCodexConfigText (Get-Content -LiteralPath (Join-Path $state.Home 'config.toml') -Raw)) | Should Be $true
    (Test-Path -LiteralPath (Join-Path $state.Home 'auth.json')) | Should Be $false
  }

  It 'leaves an existing unmarked collision untouched and selects a new numbered slot' {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $scratchParent = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
    $paths = Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForPrepare
    $security = New-NookCodexDirectorySecurity $sid
    [void][IO.Directory]::CreateDirectory($paths.Root, $security)
    $originalItems = @(Get-ChildItem -LiteralPath $paths.Root -Force).Count
    $next = Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForPrepare
    $next.Root | Should Be ($paths.Root + '-01')
    (Test-Path -LiteralPath $paths.Marker) | Should Be $false
    @(Get-ChildItem -LiteralPath $paths.Root -Force).Count | Should Be $originalItems
    { Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForLaunch } | Should Throw
  }

  It 'skips a marked profile with an unexpected ACL for Prepare and blocks Launch' {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $scratchParent = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
    $paths = Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForPrepare
    [void][IO.Directory]::CreateDirectory($paths.Root)
    Set-Content -LiteralPath $paths.Marker -Value "nook-codex-dev-v2`n$sid" -Encoding ASCII
    $next = Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForPrepare
    $next.Root | Should Be ($paths.Root + '-01')
    { Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForLaunch } | Should Throw
  }

  It 'does not select a profile marked for a different SID' {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $scratchParent = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
    $paths = Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForPrepare
    New-TestNookCodexProfileRoot $paths.Root $sid 'S-1-5-21-other'
    $next = Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForPrepare
    $next.Root | Should Be ($paths.Root + '-01')
    { Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForLaunch } | Should Throw
  }

  It 'rejects reparse-point directory entries and filename collisions' {
    $reparseItem = [pscustomobject]@{ PSIsContainer = $true; Attributes = [IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint }
    (Test-NookCodexScratchDirectoryEntry $reparseItem) | Should Be $false
    (Test-NookCodexScratchDirectoryEntry ([pscustomobject]@{ PSIsContainer = $true; Attributes = [IO.FileAttributes]::Directory })) | Should Be $true
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $scratchParent = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
    $paths = Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForPrepare
    [void][IO.Directory]::CreateDirectory($scratchParent)
    [IO.File]::WriteAllText($paths.Root, 'leave untouched')
    $next = Get-NookCodexScratchPaths -ScratchParent $scratchParent -UserSid $sid -ForPrepare
    $next.Root | Should Be ($paths.Root + '-01')
    [IO.File]::ReadAllText($paths.Root) | Should Be 'leave untouched'
  }

  It 'defaults the persistent scratch profile to per-user LocalAppData outside Temp' {
    $paths = Get-NookCodexScratchPaths -UserSid 'S-1-5-21-test'
    $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    $paths.Parent | Should Be (Join-Path $localAppData 'NookDev\Tests\Codex')
    $paths.Root | Should Match ([regex]::Escape((Join-Path $paths.Parent 'nook-codex-dev-')))
    (Test-NookCodexScratchLocation $paths.Root $paths.Root $localAppData ([IO.Path]::GetTempPath()) (Join-Path $PSScriptRoot '..\..') (Join-Path $env:USERPROFILE '.codex')) | Should Be $true
    (Test-NookCodexScratchLocation (Join-Path ([IO.Path]::GetTempPath()) 'nook-codex-dev-test') (Join-Path ([IO.Path]::GetTempPath()) 'nook-codex-dev-test') $localAppData ([IO.Path]::GetTempPath()) (Join-Path $PSScriptRoot '..\..') (Join-Path $env:USERPROFILE '.codex')) | Should Be $false
    (Test-NookCodexScratchLocation (Join-Path $env:USERPROFILE '.codex\nook-codex-dev-test') (Join-Path $env:USERPROFILE '.codex\nook-codex-dev-test') $localAppData ([IO.Path]::GetTempPath()) (Join-Path $PSScriptRoot '..\..') (Join-Path $env:USERPROFILE '.codex')) | Should Be $false
  }

  It 'creates and verifies a scratch root ACL restricted to the current SID and SYSTEM' {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $root = Join-Path $TestDrive 'acl-root'
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $root))
    $security = New-NookCodexDirectorySecurity $sid
    [void][IO.Directory]::CreateDirectory($root, $security)
    (Test-NookCodexDirectoryAcl $root $sid -RequireProtectedDacl) | Should Be $true
    (Test-NookCodexDirectoryAcl $root $sid) | Should Be $true
    (Test-NookCodexDirectoryAcl $root 'S-1-5-21-mismatch') | Should Be $false
    $child = Join-Path $root 'codex-home'
    [void][IO.Directory]::CreateDirectory($child)
    (Test-NookCodexDirectoryAcl $child $sid) | Should Be $true
    $acl = Get-Acl -LiteralPath $root
    $acl.AreAccessRulesProtected | Should Be $true
    @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])).Count | Should Be 2
  }

  It 'captures a Codex helper warning without treating it as a failed version preflight' {
    $fakeCodex = Join-Path $TestDrive 'codex-warning.cmd'
    [IO.File]::WriteAllText($fakeCodex, "@echo off`r`n>&2 echo WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper binaries under temporary dir`r`necho codex-cli 0.154.0`r`nexit /b 0`r`n")
    $previousPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Stop'
      $result = Invoke-NookCodexVersionCheck $fakeCodex
    } finally { $ErrorActionPreference = $previousPreference }
    $result.ExitCode | Should Be 0
    $result.Output | Should Match 'Refusing to create helper binaries under temporary dir'
    $result.Output | Should Match 'codex-cli 0\.154\.0'
  }

  It 'preserves the actual nonzero exit code from a failed Codex version check' {
    $fakeCodex = Join-Path $TestDrive 'codex-failure.cmd'
    [IO.File]::WriteAllText($fakeCodex, "@echo off`r`n>&2 echo version probe failed`r`nexit /b 9`r`n")
    $result = Invoke-NookCodexVersionCheck $fakeCodex
    $result.ExitCode | Should Be 9
    $result.Output | Should Match 'version probe failed'
  }

  It 'accepts a clean scratch workspace and rejects project config layers' {
    $workspace = Join-Path $TestDrive 'workspace'
    [void][IO.Directory]::CreateDirectory($workspace)
    (Test-NookCodexWorkspaceIsolation $workspace) | Should Be $true
    [void][IO.Directory]::CreateDirectory((Join-Path $workspace '.codex'))
    (Test-NookCodexWorkspaceIsolation $workspace) | Should Be $false
  }

  It 'does not treat the user global CODEX_HOME or credentials as fallback' {
    $isolatedHome = Join-Path $TestDrive 'isolated'
    [void][IO.Directory]::CreateDirectory($isolatedHome)
    (Test-NookCodexAuthAvailable $isolatedHome) | Should Be $false
    [IO.File]::WriteAllText((Join-Path $isolatedHome 'auth.json'), '{}')
    (Test-NookCodexAuthAvailable $isolatedHome) | Should Be $true
    $scriptUnderTestContent = Get-Content -LiteralPath $scriptUnderTest -Raw
    $scriptUnderTestContent | Should Not Match 'Copy-Item'
    $scriptUnderTestContent | Should Match 'CODEX_HOME'
  }

  It 'restores process CODEX_HOME in finally and does not terminate unrelated Codex processes' {
    $content = Get-Content -LiteralPath $scriptUnderTest -Raw
    $content | Should Match 'finally\s*\{[\s\S]*Remove-Item Env:\\CODEX_HOME'
    $content | Should Not Match 'Stop-Process'
    $content | Should Not Match 'Get-Process[^\r\n]*codex'
  }

  It 'fails closed for missing isolated authorization and nonzero CLI exit' {
    $content = Get-Content -LiteralPath $scriptUnderTest -Raw
    $content | Should Match 'no auth\.json'
    $content | Should Match 'Codex CLI exited with code'
    $content | Should Match 'Separate authorization is required'
  }
}
