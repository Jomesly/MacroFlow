param([Parameter(Mandatory=$true)][string]$ImagePath)

# Keep the original clipboard only in this process's memory. Never print it.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$original = [System.Windows.Forms.Clipboard]::GetDataObject()
$backup = New-Object System.Windows.Forms.DataObject
if ($null -ne $original) {
  foreach ($format in $original.GetFormats($false)) {
    $value = $original.GetData($format, $false)
    if ($null -ne $value) { $backup.SetData($format, $false, $value) }
  }
}
$fixture = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $ImagePath).Path)
function Image-Fingerprint($bitmap) {
  $stream = New-Object System.IO.MemoryStream
  try {
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToBase64String($sha.ComputeHash($stream.ToArray())) } finally { $sha.Dispose() }
  } finally { $stream.Dispose() }
}
$expected = Image-Fingerprint $fixture
try {
  [System.Windows.Forms.Clipboard]::SetImage($fixture)
  [Console]::WriteLine('CLIPBOARD_READY')
  [Console]::Out.Flush()
  [Console]::ReadLine() | Out-Null
} finally {
  # If the user copied something during the test, preserve their newer clipboard.
  if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
    $current = [System.Windows.Forms.Clipboard]::GetImage()
    try {
      if ((Image-Fingerprint $current) -eq $expected) {
        if ($null -eq $original) { [System.Windows.Forms.Clipboard]::Clear() }
        else { [System.Windows.Forms.Clipboard]::SetDataObject($backup, $true) }
      }
    } finally { $current.Dispose() }
  }
  $fixture.Dispose()
  [Console]::WriteLine('CLIPBOARD_FINISHED')
}
