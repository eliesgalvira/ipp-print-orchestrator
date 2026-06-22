{
  pkgs,
  bun2nix,
  src,
}:

rec {
  hp-uld-hp135a = pkgs.callPackage ./hp-uld-hp135a.nix { };

  cups-usb-backend = pkgs.callPackage ./cups-usb-backend.nix {
    inherit src;
  };

  ipp-print-orchestrator = pkgs.callPackage ./ipp-print-orchestrator.nix {
    inherit
      bun2nix
      hp-uld-hp135a
      src
      ;
  };

  default = ipp-print-orchestrator;
}
