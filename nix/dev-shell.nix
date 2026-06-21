{ pkgs }:

pkgs.mkShell {
  packages = [
    pkgs.bun
    pkgs.cups
    pkgs.ghostscript
    pkgs.git
    pkgs.nixfmt
    pkgs.nodejs-slim
    pkgs.nushell
    pkgs.openssh
    pkgs.openssl
    pkgs.poppler-utils
    pkgs.rsync
  ];
}
