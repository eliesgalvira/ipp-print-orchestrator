#!/usr/bin/env nu

use lib/env.nu [get-config load-dotenv]
use lib/remote.nu [remote-target run-ssh]
use lib/repo.nu repo-root
use lib/status.nu require-ready-status

const POINTS_PER_IPP_MARGIN_UNIT = 72 / 2540 # IPP media margins are hundredths of a millimetre.

# .HWMargins order: left, bottom, right, top.
def printable-margins [queue_uri: string]: nothing -> list<float> {
  let attributes = (run-external "ipptool" "-tv" $queue_uri "get-printer-attributes.test")

  [left bottom right top] | each {|side|
    $attributes
    | parse --regex ('media-' + $side + '-margin-supported \([^)]*\) = (?<values>[0-9,]+)')
    | get values.0
    | split row ","
    | into int
    | math max
    | $in * $POINTS_PER_IPP_MARGIN_UNIT
  }
}

def require-printer-ready [dotenv: record, target: record]: nothing -> nothing {
  let status_url = $"http://(get-config $dotenv IPP_ORCH_BIND_HOST '127.0.0.1'):(get-config $dotenv IPP_ORCH_BIND_PORT '4310')/v1/status"
  require-ready-status (run-ssh $target.host ["curl" "-fsS" $status_url] --key-path $target.key_path --batch | from json)
}

# The queue prints every page at 100% on A4, so content outside the printer's margins is lost.
def fit-to-printable-area [pdf: path, margins: list<float>, output: path]: nothing -> nothing {
  (run-external "gs" "-q" "-o" $output "-sDEVICE=pdfwrite" "-sPAPERSIZE=a4" "-dFIXEDMEDIA" "-dPDFFitPage" "-dAutoRotatePages=/None"
    "-c" $"<</.HWMargins [($margins | str join ' ')]>> setpagedevice" "-f" $pdf)
}

# Prints PDFs on the public IPPS queue one job at a time, waiting for CUPS to finish each job.
def main [...pdfs: path]: nothing -> nothing {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let target = (remote-target $dotenv)
  let queue_uri = $"ipps://($target.host | split row '@' | last):631/printers/(get-config $dotenv IPP_ORCH_PRINTER_NAME 'HP135a')"
  let margins = (printable-margins $queue_uri)
  let tmp_dir = (mktemp --directory)

  try {
    for pdf in $pdfs {
      let fitted = ($tmp_dir | path join ($pdf | path basename))
      fit-to-printable-area $pdf $margins $fitted
      require-printer-ready $dotenv $target
      print $"Printing ($pdf) scaled to the printable area of ($queue_uri)"
      run-external "ipptool" "-t" "-d" $"job-name=($pdf | path basename)" "-f" $fitted $queue_uri ($root_dir | path join "scripts/print-live-to-pi.test")
    }
  } catch {|err|
    rm --recursive --force $tmp_dir
    error make $err
  }

  rm --recursive --force $tmp_dir
}
