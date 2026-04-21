#!/usr/bin/env nu

use lib/env.nu *
use lib/repo.nu repo-root

def main []: nothing -> any {
  let root_dir = (repo-root)
  let repo_dotenv = (load-dotenv ($root_dir | path join ".env"))
  let etc_dotenv = (load-dotenv /etc/ipp-print-orchestrator.env)
  let dotenv = ($repo_dotenv | merge $etc_dotenv)
  let printer_name = (get-config $dotenv IPP_ORCH_PRINTER_NAME "printer")

  cd $root_dir
  ^node ($root_dir | path join "scripts/debug-ipp-printer-attributes.mjs") $root_dir $printer_name
}
