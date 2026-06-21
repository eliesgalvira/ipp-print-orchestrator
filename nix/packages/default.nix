{
  pkgs,
  src,
}:

{
  hp-uld-hp135a = pkgs.callPackage ./hp-uld-hp135a.nix { };

  cups-usb-backend = pkgs.callPackage ./cups-usb-backend.nix {
    inherit src;
  };

  default = pkgs.callPackage ./hp-uld-hp135a.nix { };
}
