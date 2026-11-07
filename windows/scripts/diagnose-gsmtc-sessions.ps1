[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Wait-NookWinRtOperation {
  param([object]$Operation, [Type]$ResultType)
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods([Reflection.BindingFlags]'Public,Static') |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  if ($null -eq $method) { throw 'PowerShell WinRT async bridge is unavailable.' }
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

Write-Output ('Windows SID: ' + [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
$vlc = @(Get-Process -Name vlc -ErrorAction SilentlyContinue)
Write-Output ('VLC processes in this user context: ' + $vlc.Count)

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
  $manager = Wait-NookWinRtOperation ($managerType::RequestAsync()) $managerType
  $sessions = @($manager.GetSessions())
  Write-Output ('GSMTC session count: ' + $sessions.Count)

  foreach ($session in $sessions) {
    $appId = '<unavailable>'
    $status = '<unavailable>'
    try { $appId = [string]$session.SourceAppUserModelId } catch { }
    try { $status = [string]$session.GetPlaybackInfo().PlaybackStatus } catch { }
    Write-Output ('Session AppUserModelId: ' + $appId + '; status: ' + $status)
  }

  $current = $manager.GetCurrentSession()
  if ($current) {
    $appId = '<unavailable>'
    $status = '<unavailable>'
    try { $appId = [string]$current.SourceAppUserModelId } catch { }
    try { $status = [string]$current.GetPlaybackInfo().PlaybackStatus } catch { }
    Write-Output ('Current AppUserModelId: ' + $appId + '; status: ' + $status)
  } else {
    Write-Output 'Current session: none'
  }
} catch {
  $errorRecord = $_.Exception
  while ($errorRecord.InnerException) { $errorRecord = $errorRecord.InnerException }
  Write-Output ('GSMTC query failed: ' + $errorRecord.GetType().FullName + '; HRESULT=0x' + $errorRecord.HResult.ToString('X8') + '; ' + $errorRecord.Message)
  exit 2
}
