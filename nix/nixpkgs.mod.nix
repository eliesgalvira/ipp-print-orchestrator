{ inputs, ... }:
{
  perSystem =
    { lib, system, ... }:
    let
      inherit (lib.strings) getName;
    in
    {
      _module.args.pkgs = import inputs.nixpkgs {
        inherit system;
        config.allowUnfreePredicate = pkg: getName pkg == "hp-uld-hp135a";
      };
    };
}
