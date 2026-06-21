{
  description = "IPP print orchestrator";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems =
        f:
        lib.genAttrs systems (
          system:
          f (
            import nixpkgs {
              inherit system;
              config.allowUnfreePredicate =
                pkg:
                builtins.elem (lib.getName pkg) [
                  "hp-uld-hp135a"
                ];
            }
          )
        );
    in
    {
      packages = forAllSystems (
        pkgs:
        import ./nix/packages {
          inherit pkgs;
          src = self;
        }
      );

      checks = forAllSystems (
        pkgs:
        import ./nix/checks {
          inherit pkgs;
          src = self;
          packages = self.packages.${pkgs.stdenv.hostPlatform.system};
        }
      );

      devShells = forAllSystems (pkgs: {
        default = import ./nix/dev-shell.nix { inherit pkgs; };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
