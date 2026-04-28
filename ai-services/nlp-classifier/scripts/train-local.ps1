param(
  [string]$PythonExe = "python",
  [string]$OutDir = "model"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$train = Join-Path $root "train.py"
$data = Join-Path $root "data\train.jsonl"
$csv = Join-Path $root "data\email_training_dataset.csv"
$out = Join-Path $root $OutDir

if (!(Test-Path $out)) {
  New-Item -ItemType Directory -Force -Path $out | Out-Null
}

& $PythonExe $train --data $data --csv $csv --out-dir $out
