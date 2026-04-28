param(
  [string]$ModelDir = "./model",
  [string]$OutFile = "./ai-services/nlp-classifier/data/train.generated.jsonl",
  [int]$MaxPerFile = 20000,
  [int]$MinTextLength = 6
)

$ErrorActionPreference = "Stop"

function Normalize-Text ([string]$t) {
  if (-not $t) { return "" }
  $x = $t -replace "\r", "" -replace "\t", " "
  $x = ($x -replace "\s+", " ").Trim()
  return $x
}

function Coalesce([object]$value, [object]$fallback) {
  if ($null -eq $value) { return $fallback }
  if ($value -is [string] -and [string]::IsNullOrWhiteSpace($value)) { return $fallback }
  return $value
}

$SecurityKeywords = @(
  "phishing","malware","ransomware","breach","hacked","unauthorized","attack","virus","suspicious","data breach","security incident"
)

function Get-Risk([string]$priority, [string]$text) {
  $p = (Coalesce $priority "").ToString().ToLowerInvariant()
  $lower = (Coalesce $text "").ToString().ToLowerInvariant()

  foreach ($kw in $SecurityKeywords) {
    if ($lower.Contains($kw)) { return "HIGH" }
  }

  if ($p -in @("high","urgent","critical")) { return "HIGH" }
  if ($p -in @("medium","med","normal")) { return "MEDIUM" }
  if ($p -in @("low")) { return "LOW" }

  return "MEDIUM"
}

function Get-Intent([string]$type, [string]$text) {
  $t = (Coalesce $type "").ToString().ToLowerInvariant()
  $lower = (Coalesce $text "").ToString().ToLowerInvariant()

  foreach ($kw in $SecurityKeywords) {
    if ($lower.Contains($kw)) { return "SECURITY_REPORT" }
  }

  if ($lower.Contains("how to") -or $lower.StartsWith("how ") -or $lower.Contains("guide") -or $lower.Contains("steps")) {
    return "HOW_TO"
  }

  if ($t -in @("incident","bug","problem","outage","disruption")) { return "INCIDENT" }
  if ($t -in @("request","service request")) { return "SERVICE_REQUEST" }

  # fallback heuristics
  if ($lower.Contains("need access") -or $lower.Contains("permission") -or $lower.Contains("request")) {
    return "SERVICE_REQUEST"
  }

  return "INCIDENT"
}

function Get-Domain([string]$text, [string[]]$tags) {
  $lower = (Coalesce $text "").ToString().ToLowerInvariant()
  $tagLower = @()
  if ($tags) {
    $tagLower = $tags | Where-Object { $_ } | ForEach-Object { $_.ToString().ToLowerInvariant() }
  }

  $has = {
    param([string[]]$words)
    foreach ($w in $words) {
      if ($lower.Contains($w)) { return $true }
      if ($tagLower -contains $w) { return $true }
    }
    return $false
  }

  if (&$has @("password","reset","login","account","unlock","access","permission","username")) { return "IDENTITY_ACCESS" }
  if (&$has @("vpn","wifi","wi-fi","network","internet","connection","dns")) { return "NETWORK_VPN_WIFI" }
  if (&$has @("email","outlook","mail","calendar","teams","meeting")) { return "EMAIL_COLLAB" }
  if (&$has @("printer","keyboard","mouse","monitor","laptop","screen","hardware","headphones")) { return "HARDWARE_PERIPHERAL" }
  if (&$has @("install","software","application","license","update","crash","driver")) { return "SOFTWARE_INSTALL_LICENSE" }
  if (&$has @("sap","oracle","crm","erp","salesforce")) { return "BUSINESS_APP_ERP_CRM" }
  if (&$has @("phishing","malware","security","virus","hack","breach","ransomware")) { return "SECURITY_INCIDENT" }
  if (&$has @("how to","guide","tutorial","documentation")) { return "KB_GENERAL" }

  # GitHub issues are often software-related; keep them in software domain if nothing else matches
  if (&$has @("bug","issue","stack trace","exception","crash")) { return "SOFTWARE_INSTALL_LICENSE" }

  return "OTHER"
}

function Write-JsonlLine($writer, [string]$text, [string]$intent, [string]$domain, [string]$risk) {
  $obj = [ordered]@{ text = $text; intent = $intent; domain = $domain; risk = $risk }
  $json = ($obj | ConvertTo-Json -Compress)
  $writer.WriteLine($json)
}

function Process-CsvWithTextFieldParser([string]$path, [scriptblock]$rowHandler, [int]$maxRows) {
  Add-Type -AssemblyName Microsoft.VisualBasic
  $parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($path)
  $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
  $parser.SetDelimiters(",")
  $parser.HasFieldsEnclosedInQuotes = $true

  try {
    if ($parser.EndOfData) { return }
    $headers = $parser.ReadFields()
    if (-not $headers) { return }

    $i = 0
    while (-not $parser.EndOfData) {
      $fields = $parser.ReadFields()
      if (-not $fields) { continue }
      $row = @{}
      for ($c = 0; $c -lt $headers.Length; $c++) {
        $h = $headers[$c]
        if (-not $h) { continue }
        $row[$h] = if ($c -lt $fields.Length) { $fields[$c] } else { $null }
      }

      & $rowHandler $row
      $i++
      if ($i -ge $maxRows) { break }
    }
  } finally {
    $parser.Close()
  }
}

function Ensure-Dir([string]$p) {
  $dir = Split-Path -Parent $p
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
}

function Expand-ZipToTemp([string]$zipPath) {
  $base = [IO.Path]::GetFileNameWithoutExtension($zipPath)
  $tempRoot = Join-Path $env:TEMP "pit-ai-datasets"
  $out = Join-Path $tempRoot $base
  if (-not (Test-Path $out)) {
    New-Item -ItemType Directory -Force -Path $out | Out-Null
    Expand-Archive -Force -Path $zipPath -DestinationPath $out
  }
  return $out
}

Ensure-Dir $OutFile

$writer = New-Object System.IO.StreamWriter($OutFile, $false, [System.Text.Encoding]::UTF8)
$seen = New-Object 'System.Collections.Generic.HashSet[string]'

try {
  $files = Get-ChildItem -Path $ModelDir -File

  foreach ($f in $files) {
    if ($f.Length -lt 100) {
      Write-Host "Skipping tiny file: $($f.Name) ($($f.Length) bytes)"
      continue
    }

    $ext = $f.Extension.ToLowerInvariant()

    if ($ext -eq ".tar.gz") {
      Write-Host "Skipping model tarball (not dataset): $($f.Name)"
      continue
    }

    $pathsToProcess = @($f.FullName)

    if ($ext -eq ".zip") {
      Write-Host "Expanding zip: $($f.Name)"
      $unzipped = Expand-ZipToTemp $f.FullName
      $pathsToProcess = Get-ChildItem -Path $unzipped -File -Recurse | Where-Object {
        $_.Extension.ToLowerInvariant() -in @(".csv", ".json")
      } | Select-Object -ExpandProperty FullName
    }

    foreach ($p in $pathsToProcess) {
      $pItem = Get-Item $p
      $pExt = $pItem.Extension.ToLowerInvariant()
      $count = 0

      if ($pExt -eq ".csv") {
        Write-Host "Processing CSV: $([IO.Path]::GetFileName($p))"

        # Map by schema
        $rowHandler = {
          param($row)

          # Dataset A: GitHub issues overview
          if ($row.ContainsKey("title") -and $row.ContainsKey("body") -and $row.ContainsKey("repo_name")) {
            $text = Normalize-Text(("$($row["title"]) $($row["body"])"))
            if ($text.Length -lt $MinTextLength) { return }

            $intent = Get-Intent "incident" $text
            $domain = Get-Domain $text @("software")
            $risk = "MEDIUM"

            $key = $text.ToLowerInvariant()
            if ($seen.Add($key)) {
              Write-JsonlLine $writer $text $intent $domain $risk
              $count++
            }
            return
          }

          # Dataset B: multi-lang tickets
          if ($row.ContainsKey("subject") -and $row.ContainsKey("body") -and $row.ContainsKey("type")) {
            $tags = @()
            foreach ($k in @("tag_1","tag_2","tag_3","tag_4","tag_5","tag_6","tag_7","tag_8")) {
              if ($row.ContainsKey($k) -and $row[$k]) { $tags += $row[$k] }
            }

            $text = Normalize-Text(("$($row["subject"]) $($row["body"])"))
            if ($text.Length -lt $MinTextLength) { 
              Write-Host "Skipping short text: $text"
              return 
            }

            $intent = Get-Intent $row["type"] $text
            $domain = Get-Domain $text $tags
            $risk = Get-Risk $row["priority"] $text

            $key = $text.ToLowerInvariant()
            if ($seen.Add($key)) {
              Write-JsonlLine $writer $text $intent $domain $risk
              $count++
            }
            return
          }

          # Generic: try common columns
          $candidate = ""
          foreach ($col in @("text","description","body","message","content","title","subject")) {
            if ($row.ContainsKey($col) -and $row[$col]) {
              $candidate = $candidate + " " + $row[$col]
            }
          }

          $text = Normalize-Text($candidate)
          if ($text.Length -lt $MinTextLength) { return }

          $intent = Get-Intent (Coalesce $row["type"] "incident") $text
          $domain = Get-Domain $text @()
          $risk = Get-Risk (Coalesce $row["priority"] "medium") $text

          $key = $text.ToLowerInvariant()
          if ($seen.Add($key)) {
            Write-JsonlLine $writer $text $intent $domain $risk
            $count++
          }
        }

        $count = 0
        Process-CsvWithTextFieldParser -path $p -rowHandler $rowHandler -maxRows $MaxPerFile
        Write-Host "  Wrote $count samples"
      }
      elseif ($pExt -eq ".json") {
        Write-Host "Processing JSON: $([IO.Path]::GetFileName($p))"

        $raw = [System.IO.File]::ReadAllText($p)
        $rawTrim = $raw.TrimStart()

        if ($rawTrim.StartsWith("[")) {
          # JSON array
          $arr = $raw | ConvertFrom-Json
          $i = 0
          foreach ($obj in $arr) {
            if ($i -ge $MaxPerFile) { break }

            $candidate = ""
            foreach ($col in @("text","description","body","message","content","title","subject","complaint","product","issue")) {
              if ($obj.PSObject.Properties.Name -contains $col) {
                $candidate = $candidate + " " + $obj.$col
              }
            }

            $text = Normalize-Text($candidate)
            if ($text.Length -lt $MinTextLength) { continue }

            $intent = Get-Intent "incident" $text
            $domain = Get-Domain $text @()
            $risk = Get-Risk "medium" $text

            $key = $text.ToLowerInvariant()
            if ($seen.Add($key)) {
              Write-JsonlLine $writer $text $intent $domain $risk
              $count++
              $i++
            }
          }
        } else {
          # Assume line-delimited JSON objects
          $lines = [System.IO.File]::ReadLines($p)
          foreach ($line in $lines) {
            if ($count -ge $MaxPerFile) { break }
            $l = $line.Trim()
            if (-not $l) { continue }

            try {
              $obj = $l | ConvertFrom-Json
            } catch {
              continue
            }

            $candidate = ""
            foreach ($col in @("text","description","body","message","content","title","subject","complaint","product","issue")) {
              if ($obj.PSObject.Properties.Name -contains $col) {
                $candidate = $candidate + " " + $obj.$col
              }
            }

            $text = Normalize-Text($candidate)
            if ($text.Length -lt $MinTextLength) { continue }

            $intent = Get-Intent "incident" $text
            $domain = Get-Domain $text @()
            $risk = Get-Risk "medium" $text

            $key = $text.ToLowerInvariant()
            if ($seen.Add($key)) {
              Write-JsonlLine $writer $text $intent $domain $risk
              $count++
            }
          }
        }

        Write-Host "  Wrote $count samples"
      }
      else {
        Write-Host "Skipping unsupported file: $([IO.Path]::GetFileName($p))"
      }
    }
  }

  Write-Host "Done. Generated: $OutFile"
} finally {
  $writer.Flush()
  $writer.Close()
}
